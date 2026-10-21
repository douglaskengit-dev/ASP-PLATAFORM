import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { removerArquivos } from "@/lib/processos/arquivos";
import { dataIsoValida } from "@/lib/asp/rdo";
import { CAMPOS_RDO as CAMPOS, PERFIS_RDO as PERFIS, UUID, MSG_DIA_DUPLICADO, erroDasInspecoes, erroDeDuplicidade, erroDosDados } from "@/lib/asp/rdo-api";

export const runtime = "nodejs";

// RDO — Registro Diário de Operação (gp_rdos). Um por projeto por dia.
// Operações (com admin e Gerência) grava; todos leem — mesmos perfis do
// checklist e da coleta de fotos. O .docx é gerado no navegador e chega
// depois em /api/rdos/[id]/arquivo.

/** GET ?projetoId=… (todos do projeto) ou ?inspecaoId=… (os que a cobrem). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const projetoId = req.nextUrl.searchParams.get("projetoId");
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId");
  if (!projetoId && !inspecaoId) return NextResponse.json({ erro: "Informe o projeto ou a inspeção." }, { status: 400 });
  const supabase = getSupabaseRouteClient();

  // Purga preguiçosa da lixeira: RDO excluído há mais de 30 dias sai de vez.
  if (PERFIS.includes(profile.perfil)) {
    const corte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: velhos } = await supabase.from("gp_rdos").select("id, arquivo_path").lt("excluido_em", corte);
    if (velhos && velhos.length > 0) {
      await supabase.from("gp_rdos").delete().in("id", velhos.map((r: any) => r.id));
      await removerArquivos(velhos.map((r: any) => r.arquivo_path).filter(Boolean));
    }
  }

  let q = supabase.from("gp_rdos").select(CAMPOS).is("excluido_em", null).order("data", { ascending: false });
  if (projetoId) q = q.eq("projeto_id", projetoId);
  if (inspecaoId) q = q.contains("inspecoes", [inspecaoId]);
  const { data, error } = await q;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, podeEditar: PERFIS.includes(profile.perfil), rdos: data || [] });
}

/** Cria o RDO do dia: { id?, projetoId, data, inspecoes, dados }.
 *  `id` vem do aparelho — assim o envio do .docx, que pode ir para a fila
 *  offline logo atrás, já sabe a quem pertence. Reenvio do mesmo id (fila
 *  sincronizando de novo) devolve o registro existente. O número é
 *  calculado aqui, nunca no aparelho. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "RDO é responsabilidade de Operações." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const projetoId = String(b?.projetoId || "");
  const id = b?.id ? String(b.id) : null;
  if (!UUID.test(projetoId)) return NextResponse.json({ erro: "Projeto obrigatório." }, { status: 400 });
  if (id && !UUID.test(id)) return NextResponse.json({ erro: "Identificador inválido." }, { status: 400 });
  if (!dataIsoValida(b?.data)) return NextResponse.json({ erro: "Informe a data do RDO." }, { status: 400 });
  const erroDados = erroDosDados(b?.dados);
  if (erroDados) return NextResponse.json({ erro: erroDados }, { status: 400 });

  const supabase = getSupabaseRouteClient();
  if (id) {
    const { data: existente } = await supabase.from("gp_rdos").select(CAMPOS).eq("id", id).maybeSingle();
    if (existente) return NextResponse.json({ ok: true, rdo: existente, existente: true });
  }
  const erroInsp = await erroDasInspecoes(supabase, projetoId, b?.inspecoes);
  if (erroInsp) return NextResponse.json({ erro: erroInsp }, { status: 400 });

  // Dia já ocupado: responde antes de gastar um número.
  const { data: doDia } = await supabase.from("gp_rdos").select("id, numero")
    .eq("projeto_id", projetoId).eq("data", b.data).is("excluido_em", null).maybeSingle();
  if (doDia) return NextResponse.json({ erro: MSG_DIA_DUPLICADO, rdoId: doDia.id }, { status: 409 });

  // Próximo número do projeto (excluídos contam: número não se reusa). Duas
  // criações simultâneas batem no índice único do número — tenta de novo.
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { data: ultimo } = await supabase.from("gp_rdos").select("numero")
      .eq("projeto_id", projetoId).order("numero", { ascending: false }).limit(1).maybeSingle();
    const numero = (ultimo?.numero || 0) + 1;
    const { data, error } = await supabase.from("gp_rdos").insert({
      ...(id ? { id } : {}),
      projeto_id: projetoId, data: b.data, numero,
      inspecoes: Array.from(new Set(b.inspecoes as string[])),
      dados: b.dados, criado_por: profile.id,
    }).select(CAMPOS).single();
    if (!error) return NextResponse.json({ ok: true, rdo: data });
    if (erroDeDuplicidade(error)) return NextResponse.json({ erro: MSG_DIA_DUPLICADO }, { status: 409 });
    const numeroRepetido = error.code === "23505" && (error.message || "").includes("uq_gp_rdos_projeto_numero");
    if (!numeroRepetido) return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ erro: "Não foi possível numerar o RDO. Tente de novo." }, { status: 500 });
}
