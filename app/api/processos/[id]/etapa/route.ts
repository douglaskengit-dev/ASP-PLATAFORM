import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { ETAPAS_FLUXO } from "@/lib/processos/etapas";
import { hojeBrasil, podeUsarCrm } from "@/lib/validacao";

export const runtime = "nodejs";

/** Move a oportunidade para qualquer etapa comercial (Admin, Gerência e
 * Comercial). A data (dia em que a mudança aconteceu) entra no histórico e
 * mede o tempo em cada etapa. Mover uma oportunidade ganha ou perdida para
 * uma etapa a reabre. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "Só Comercial, Gerência e Administração movem oportunidades." }, { status: 403 });
  }

  const { etapa, dataAutenticacao } = (await req.json().catch(() => ({}))) as { etapa?: number; dataAutenticacao?: string };
  if (typeof etapa !== "number" || !Number.isInteger(etapa) || etapa < 0 || etapa >= ETAPAS_FLUXO.length) {
    return NextResponse.json({ erro: "Etapa inválida." }, { status: 400 });
  }
  if (!dataAutenticacao || !/^\d{4}-\d{2}-\d{2}$/.test(dataAutenticacao)) {
    return NextResponse.json({ erro: "Informe a data da mudança de etapa." }, { status: 400 });
  }
  if (dataAutenticacao > hojeBrasil()) {
    return NextResponse.json({ erro: "A data da mudança não pode ser futura." }, { status: 400 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: atual, error: erroBusca } = await supabase
    .from("gp_processos").select("*").eq("id", params.id).maybeSingle();
  if (erroBusca || !atual) {
    return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });
  }
  const fechada = atual.resultado === "ganha" || atual.resultado === "perdida";
  if (atual.etapa === etapa && !fechada) return NextResponse.json({ ok: true, etapa, nome: ETAPAS_FLUXO[etapa].nome });

  const historico = Array.isArray(atual.historico_etapas) ? atual.historico_etapas : [];
  const agora = new Date().toISOString();
  const novos: Record<string, unknown>[] = [];
  if (fechada) novos.push({ evento: "resultado", resultado: "aberta", anterior: atual.resultado, data: dataAutenticacao, alterado_em: agora, alterado_por: profile.id });
  if (atual.etapa !== etapa) {
    novos.push({ etapa, nome: ETAPAS_FLUXO[etapa].nome, data_autenticacao: dataAutenticacao, alterado_em: agora, alterado_por: profile.id });
  }
  const mudanca: Record<string, unknown> = { etapa, historico_etapas: [...historico, ...novos], updated_at: agora };
  if (fechada) Object.assign(mudanca, { resultado: "aberta", resultado_em: null, motivo_perda: null, motivo_perda_detalhe: null });

  const { data, error } = await supabase.from("gp_processos").update(mudanca).eq("id", params.id).select("id").maybeSingle();
  if (error || !data) {
    return NextResponse.json({ erro: error?.message || "Oportunidade não encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, etapa, nome: ETAPAS_FLUXO[etapa].nome, dataAutenticacao, reaberta: fechada });
}
