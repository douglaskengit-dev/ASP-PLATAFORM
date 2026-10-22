import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ULTIMA_FASE } from "@/lib/asp/fases";
import { ehUuid } from "@/lib/asp/coleta-api";
import { arquivosParaEntrega, lerOS } from "@/lib/asp/os-encerrada";
import {
  hojeBrasil, normalizarEspacos, podeRegistrarEntrega, primeiroErro, ROTULOS_ENTREGA, temErros, validarEntrega,
  type EntregaRegistrada,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Entregas ao cliente (fase 10). Os documentos são enviados FORA do
 *  sistema (e-mail, impresso, pendrive…); aqui só fica o registro: data,
 *  contato que recebeu, arquivos e meio. É a única escrita permitida na OS
 *  encerrada (além de reabrir). */

async function contextoOS(inspecaoId: string) {
  const os = await lerOS(inspecaoId);
  if (!os || os.excluido_em) return null;
  const admin = getSupabaseAdmin();
  const { data: proj } = await admin.from("gp_projetos").select("cliente_id").eq("id", os.projeto_id).maybeSingle();
  const clienteId = (proj as any)?.cliente_id || null;
  const [contatos, entregas, disponiveis] = await Promise.all([
    clienteId
      ? admin.from("gp_orgaos_contatos").select("id, nome_completo, cargo, email, telefone").eq("orgao_id", clienteId).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    admin.from("gp_entregas").select("*").eq("inspecao_id", inspecaoId).is("excluido_em", null).order("data", { ascending: false }),
    arquivosParaEntrega(inspecaoId),
  ]);
  return {
    os, clienteId,
    contatos: (contatos.data || []) as any[],
    entregas: (entregas.data || []) as any[],
    tabelaOk: !(entregas as any).error,
    disponiveis,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const ctx = await contextoOS(params.id);
  if (!ctx) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  const ids = Array.from(new Set(ctx.entregas.map((e) => e.criado_por).filter(Boolean)));
  const { data: pessoas } = ids.length
    ? await getSupabaseAdmin().from("gp_profiles").select("id, nome_completo, email").in("id", ids)
    : { data: [] as any[] };
  const nomes: Record<string, string> = {};
  for (const p of (pessoas || []) as any[]) nomes[p.id] = p.nome_completo || p.email || "usuário";
  return NextResponse.json({
    ok: true,
    clienteId: ctx.clienteId,
    contatos: ctx.contatos,
    entregas: ctx.entregas.map((e) => ({ ...e, criado_por_nome: nomes[e.criado_por] || null })),
    disponiveis: ctx.disponiveis,
    podeRegistrar: podeRegistrarEntrega(profile.perfil) && ctx.os.fase === ULTIMA_FASE,
    tabelaOk: ctx.tabelaOk,
    hoje: hojeBrasil(),
  });
}

/** Registra a entrega: { id?, data, contatoId, arquivos: [chave], meio,
 *  meioOutro?, observacao? }. `id` vem do aparelho — reenvio (duplo clique,
 *  fila offline) devolve o registro existente. Os dados dos arquivos (nome,
 *  caminho, hash) saem do servidor, nunca do navegador. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeRegistrarEntrega(profile.perfil)) {
    return NextResponse.json({ erro: "Só Admin, Gerência e Comercial registram entregas." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const id = b?.id ? String(b.id) : null;
  if (id && !ehUuid(id)) return NextResponse.json({ erro: "Identificador inválido." }, { status: 400 });
  const admin = getSupabaseAdmin();
  if (id) {
    const { data: existente } = await admin.from("gp_entregas").select("*").eq("id", id).maybeSingle();
    if (existente) {
      if ((existente as any).inspecao_id !== params.id) return NextResponse.json({ erro: "Identificador já usado em outra OS." }, { status: 409 });
      return NextResponse.json({ ok: true, entrega: existente, repetido: true });
    }
  }
  const ctx = await contextoOS(params.id);
  if (!ctx) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  if (ctx.os.fase !== ULTIMA_FASE) {
    return NextResponse.json({ erro: `A entrega ao cliente é registrada na fase ${ULTIMA_FASE} (Encerramento) — a OS está na fase ${ctx.os.fase}.` }, { status: 409 });
  }
  const arquivos: string[] = Array.isArray(b?.arquivos) ? b.arquivos.filter((x: unknown) => typeof x === "string") : [];
  const dados = {
    data: String(b?.data || ""), contatoId: b?.contatoId ? String(b.contatoId) : null, arquivos,
    meio: b?.meio ? String(b.meio) : null, meioOutro: normalizarEspacos(b?.meioOutro), observacao: normalizarEspacos(b?.observacao),
  };
  const v = validarEntrega(dados, {
    perfil: profile.perfil, hoje: hojeBrasil(), contatos: ctx.contatos, disponiveis: ctx.disponiveis,
    anteriores: ctx.entregas as EntregaRegistrada[],
  });
  if (temErros(v)) {
    return NextResponse.json({ erro: primeiroErro(v, ROTULOS_ENTREGA), erros: v.erros, avisos: v.avisos }, { status: 400 });
  }
  const contato = ctx.contatos.find((c) => c.id === dados.contatoId);
  const escolhidos = ctx.disponiveis.filter((a) => arquivos.includes(a.chave))
    .map(({ chave, tipo, id: aid, caminho, nome, hash, data }) => ({ chave, tipo, id: aid, caminho, nome, hash, data }));
  const { data, error } = await getSupabaseRouteClient().from("gp_entregas").insert({
    ...(id ? { id } : {}),
    inspecao_id: params.id, data: dados.data, contato_id: dados.contatoId,
    contato_nome: contato?.nome_completo || null,
    meio: dados.meio, meio_outro: dados.meio === "outro" ? dados.meioOutro : null,
    arquivos: escolhidos, observacao: dados.observacao || null, criado_por: profile.id,
  }).select("*").single();
  if (error) {
    if (error.code === "23505" && id) {
      const { data: ganhou } = await admin.from("gp_entregas").select("*").eq("id", id).maybeSingle();
      if (ganhou) return NextResponse.json({ ok: true, entrega: ganhou, repetido: true });
    }
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entrega: data, avisos: v.avisos });
}

/** Retira um registro de entrega (soft delete): DELETE ?entregaId=… */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeRegistrarEntrega(profile.perfil)) {
    return NextResponse.json({ erro: "Só Admin, Gerência e Comercial alteram entregas." }, { status: 403 });
  }
  const entregaId = req.nextUrl.searchParams.get("entregaId") || "";
  if (!ehUuid(entregaId)) return NextResponse.json({ erro: "Entrega inválida." }, { status: 400 });
  const { data, error } = await getSupabaseRouteClient().from("gp_entregas")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", entregaId).eq("inspecao_id", params.id).is("excluido_em", null)
    .select("id").maybeSingle();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ erro: "Entrega não encontrada (ou já retirada)." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
