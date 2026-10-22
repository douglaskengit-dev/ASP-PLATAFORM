import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  chaveItemChecklist, EquipamentoCatalogo, ItemChecklist, mesclarChecklist, primeiroErro, ROTULOS_CHECKLIST, temErros,
  validarItensChecklist,
} from "@/lib/validacao";

import { garantirOsAberta, lerOS, osDe } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

const PERFIS = ["admin", "operacoes", "gerencia"];

/** Checklist de equipamentos de uma OS (um por etapa). Regras em
 *  lib/validacao/checklist.ts: item repetido bloqueia, item avulso igual a
 *  um do Catálogo vira o do Catálogo, refazer a lista mantém a conferência
 *  dos itens que ficam. O procedimento é SEMPRE o da OS. Quem conferiu e
 *  quando vêm da sessão e do relógio do servidor — não do aparelho.
 *
 *  GET ?inspecaoId=…  → devolve os dois (inspeção e execução), se existirem. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId");
  if (!inspecaoId) return NextResponse.json({ erro: "OS obrigatória." }, { status: 400 });

  const { data, error } = await getSupabaseRouteClient()
    .from("gp_checklist_equipamentos").select("*").eq("inspecao_id", inspecaoId);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  // OS encerrada: a tela fica só leitura (a gravação também recusa).
  const encerrada = !!(await lerOS(inspecaoId))?.encerrada_em;
  return NextResponse.json({
    ok: true, podeEditar: PERFIS.includes(profile.perfil) && !encerrada, encerrada, checklists: data || [],
  });
}

async function catalogoEquipamentos(): Promise<EquipamentoCatalogo[]> {
  const { data } = await getSupabaseAdmin().from("gp_equipamentos").select("slug, nome");
  return (data || []).filter((e: any) => e.slug && e.nome);
}

/** Cria ou refaz o checklist de uma etapa: { inspecaoId, tipo, itens: [{ slug?, nome }] }.
 *  Os itens que continuam mantêm conferido/por/em/obs. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Checklist é responsabilidade de Operações." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b?.inspecaoId || (b.tipo !== "inspecao" && b.tipo !== "execucao")) {
    return NextResponse.json({ erro: "OS ou etapa inválida." }, { status: 400 });
  }
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(b.inspecaoId);
  if (travada) return travada;
  const admin = getSupabaseAdmin();
  const [os, catalogo, atual] = await Promise.all([
    admin.from("gp_inspecoes").select("id, procedimento, excluido_em").eq("id", b.inspecaoId).maybeSingle(),
    catalogoEquipamentos(),
    admin.from("gp_checklist_equipamentos").select("itens").eq("inspecao_id", b.inspecaoId).eq("tipo", b.tipo).maybeSingle(),
  ]);
  if (!os.data || os.data.excluido_em) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });

  const recebidos = (Array.isArray(b.itens) ? b.itens : [])
    .filter((i: any) => i && (typeof i.nome === "string" || typeof i.slug === "string"))
    .map((i: any) => ({ slug: typeof i.slug === "string" ? i.slug : null, nome: typeof i.nome === "string" ? i.nome : "" }));
  const r = validarItensChecklist(recebidos, catalogo);
  if (temErros(r)) {
    return NextResponse.json({ erro: primeiroErro(r, ROTULOS_CHECKLIST), erros: r.erros, avisos: r.avisos }, { status: 400 });
  }
  const itens = mesclarChecklist(recebidos, (atual.data?.itens as ItemChecklist[]) || [], catalogo);

  const { data, error } = await getSupabaseRouteClient()
    .from("gp_checklist_equipamentos")
    .upsert({
      inspecao_id: b.inspecaoId, tipo: b.tipo,
      procedimento: os.data.procedimento || null,
      itens,
      criado_por: profile.id,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "inspecao_id,tipo" })
    .select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, checklist: data, avisos: r.avisos });
}

/** Um item por vez: { id, chave, conferido?: boolean, obs?: string }.
 *  O servidor junta a mudança no que está gravado AGORA (não sobrescreve o
 *  array inteiro com o que a tela tinha) e repete se outra pessoa gravou no
 *  meio (atualizado_em mudou). */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Checklist é responsabilidade de Operações." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b?.id || typeof b.chave !== "string" || !b.chave) {
    return NextResponse.json({ erro: "Checklist ou item inválido." }, { status: 400 });
  }
  const temConferido = typeof b.conferido === "boolean";
  const temObs = typeof b.obs === "string";
  if (!temConferido && !temObs) return NextResponse.json({ erro: "Nada para alterar." }, { status: 400 });

  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(await osDe("gp_checklist_equipamentos", b.id));
  if (travada) return travada;
  const supabase = getSupabaseRouteClient();
  const catalogo = await catalogoEquipamentos();
  const nome = profile.nome_completo || profile.email || "usuário";
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { data: atual, error: e1 } = await supabase
      .from("gp_checklist_equipamentos").select("id, itens, atualizado_em").eq("id", b.id).maybeSingle();
    if (e1) return NextResponse.json({ erro: e1.message }, { status: 500 });
    if (!atual) return NextResponse.json({ erro: "Checklist não encontrado." }, { status: 404 });
    const itens: ItemChecklist[] = Array.isArray(atual.itens) ? atual.itens : [];
    const i = itens.findIndex((it) => chaveItemChecklist(it, catalogo) === b.chave);
    if (i < 0) return NextResponse.json({ erro: "Este item não está mais na lista — recarregue." }, { status: 409 });

    const it = { ...itens[i] };
    if (temConferido) {
      if (b.conferido) Object.assign(it, { conferido: true, por: nome, por_id: profile.id, em: new Date().toISOString() });
      else Object.assign(it, { conferido: false, por: null, por_id: null, em: null });
    }
    if (temObs) it.obs = b.obs.replace(/\s+/g, " ").trim();
    const novos = itens.map((x, k) => (k === i ? it : x));

    const { data, error } = await supabase
      .from("gp_checklist_equipamentos")
      .update({ itens: novos, atualizado_em: new Date().toISOString() })
      .eq("id", b.id).eq("atualizado_em", atual.atualizado_em)
      .select("*");
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    if (data && data.length > 0) return NextResponse.json({ ok: true, checklist: data[0] });
    // Alguém gravou entre a leitura e a escrita: lê de novo e reaplica.
  }
  return NextResponse.json({ erro: "O checklist está sendo alterado por outra pessoa agora. Tente de novo." }, { status: 409 });
}
