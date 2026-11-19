import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { faltaMigracaoCrm, MSG_MIGRACAO_CRM } from "@/lib/processos/crm-api";
import { hojeBrasil, podeUsarCrm, validarResultado } from "@/lib/validacao";

export const runtime = "nodejs";

/** Fecha a oportunidade como ganha ou perdida (com o motivo), ou a reabre.
 * Fechar limpa a próxima ação. Body: { resultado, data, motivo?, detalhe? }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "Só Comercial, Gerência e Administração fecham oportunidades." }, { status: 403 });
  }
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const hoje = hojeBrasil();
  const v = validarResultado(corpo, hoje);
  if ("erro" in v) return NextResponse.json({ erro: v.erro }, { status: 400 });

  const supabase = getSupabaseRouteClient();
  const { data: atual, error: erroBusca } = await supabase.from("gp_processos").select("*").eq("id", params.id).maybeSingle();
  if (erroBusca || !atual) return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });
  if (atual.resultado === undefined) return NextResponse.json({ erro: MSG_MIGRACAO_CRM }, { status: 409 });
  if (atual.resultado === v.resultado && v.resultado === "aberta") return NextResponse.json({ ok: true });

  const agora = new Date().toISOString();
  const historico = Array.isArray(atual.historico_etapas) ? atual.historico_etapas : [];
  const mudanca: Record<string, unknown> = {
    resultado: v.resultado,
    resultado_em: v.data,
    motivo_perda: v.motivo,
    motivo_perda_detalhe: v.detalhe,
    historico_etapas: [...historico, {
      evento: "resultado", resultado: v.resultado, anterior: atual.resultado || "aberta",
      data: v.data || hoje, motivo: v.motivo, alterado_em: agora, alterado_por: profile.id,
    }],
    updated_at: agora,
  };
  if (v.resultado !== "aberta") Object.assign(mudanca, { proxima_acao: null, proxima_acao_em: null });

  const { error } = await supabase.from("gp_processos").update(mudanca).eq("id", params.id);
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ erro: MSG_MIGRACAO_CRM }, { status: 409 });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (v.resultado !== "aberta") await fecharPropostaAtual(supabase, params.id, v.resultado, v.data || hoje, profile.id);
  return NextResponse.json({ ok: true, resultado: v.resultado });
}

/** Ganha: a versão mais nova da proposta, se ainda "enviada" e nenhuma outra
 *  aceita, vira aceita. Perdida: a mais nova "enviada" vira recusada.
 *  Complementar: sem a migração 20261121100000 (ou sem versões), não faz nada. */
async function fecharPropostaAtual(supabase: any, processoId: string, resultado: "ganha" | "perdida", dia: string, autor: string) {
  try {
    const { data: versoes } = await supabase.from("gp_processo_propostas").select("*")
      .eq("processo_id", processoId).order("versao", { ascending: false });
    const atual = versoes?.[0];
    if (!atual || atual.situacao !== "enviada") return;
    if (resultado === "ganha" && versoes.some((x: any) => x.situacao === "aceita")) return;
    await supabase.from("gp_processo_propostas")
      .update({ situacao: resultado === "ganha" ? "aceita" : "recusada", situacao_em: dia, situacao_por: autor })
      .eq("id", atual.id);
  } catch { /* segue: a oportunidade já foi fechada */ }
}
