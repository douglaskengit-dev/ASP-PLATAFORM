import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { planejarTrocaInspecao } from "@/lib/asp/fases";
import { garantirOsAberta } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** Quem troca "Haverá inspeção?" de uma OS: os mesmos que criam OS. */
const PERFIS_TROCA = ["admin", "comercial", "gerencia"];

/** A execução já começou a ser preparada? (agendamento de execução ativo,
 *  relatório de execução ou RDO cobrindo a OS) — decide se Não → Sim na
 *  fase 6 ainda pode voltar para a fase 2. */
async function nadaFeitoNaExecucao(inspecaoId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const [ags, rels, rdos] = await Promise.all([
    admin.from("gp_agendamentos").select("id").eq("inspecao_id", inspecaoId).eq("tipo", "execucao").is("substituido_em", null).limit(1),
    admin.from("gp_relatorios").select("id").eq("inspecao_id", inspecaoId).eq("tipo", "execucao").is("excluido_em", null).limit(1),
    admin.from("gp_rdos").select("id").contains("inspecoes", [inspecaoId]).is("excluido_em", null).limit(1),
  ]);
  return !(ags.data || []).length && !(rels.data || []).length && !(rdos.data || []).length;
}

/** GET: o que a troca faria agora (a tela mostra o aviso antes de confirmar). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const { data: os } = await getSupabaseRouteClient().from("gp_inspecoes").select("*").eq("id", params.id).maybeSingle();
  if (!os) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  const atual = (os as any).com_inspecao !== false;
  const plano = planejarTrocaInspecao({
    fase: Number((os as any).fase) || 2, comInspecaoAtual: atual, novo: !atual,
    nadaFeitoNaExecucao: await nadaFeitoNaExecucao(params.id),
  });
  return NextResponse.json({ ok: true, comInspecao: atual, fase: (os as any).fase, plano });
}

/**
 * Troca "Haverá inspeção?" de uma OS aberta: { comInspecao, voltarParaInspecao?, faseDe }.
 *  · Regras em planejarTrocaInspecao (lib/asp/fases.ts): Sim → Não nas
 *    fases 2–5 pula para a 6; Não → Sim na 6 sem nada da execução pode
 *    voltar à 2; nos demais casos a fase não muda.
 *  · ATÔMICO: grava só se a fase e o valor ainda são os lidos (outro clique
 *    → 409). Registra em gp_fase_historico (acao 'alterar_inspecao', quem,
 *    quando, fase de → para; "Sim → Não" no motivo).
 *  · ⛔ OS encerrada: só consulta (garantirOsAberta).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!PERFIS_TROCA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para alterar “Haverá inspeção?” (Comercial/Gerência/Admin)." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body?.comInspecao !== "boolean") {
    return NextResponse.json({ erro: "Informe se haverá inspeção (Sim/Não)." }, { status: 400 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: os } = await supabase.from("gp_inspecoes").select("*").eq("id", params.id).maybeSingle();
  if (!os || (os as any).excluido_em) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  if (!("com_inspecao" in (os as any))) {
    return NextResponse.json({ erro: "O banco ainda não tem a coluna com_inspecao — rode a migração 20261103100000." }, { status: 500 });
  }
  const travada = await garantirOsAberta(params.id);
  if (travada) return travada;

  const fase = Number((os as any).fase) || 2;
  const atual = (os as any).com_inspecao !== false;
  if (typeof body.faseDe === "number" && body.faseDe !== fase) {
    return NextResponse.json({ erro: "A OS mudou de fase enquanto você decidia — recarregue a página.", jaMudou: true }, { status: 409 });
  }
  const plano = planejarTrocaInspecao({
    fase, comInspecaoAtual: atual, novo: body.comInspecao,
    nadaFeitoNaExecucao: body.comInspecao ? await nadaFeitoNaExecucao(params.id) : false,
    voltarParaInspecao: !!body.voltarParaInspecao,
  });
  if (!plano.muda) return NextResponse.json({ ok: true, fase, comInspecao: atual, repetido: true });
  if (body.voltarParaInspecao && !plano.podeVoltarParaInspecao) {
    return NextResponse.json({ erro: "Não dá para voltar à fase 2: a execução já começou a ser preparada (agendamento, relatório ou RDO)." }, { status: 409 });
  }

  const agora = new Date().toISOString();
  const { data: mudou, error } = await supabase
    .from("gp_inspecoes")
    .update({ com_inspecao: body.comInspecao, fase: plano.faseNova, atualizado_em: agora })
    .eq("id", params.id).eq("fase", fase).eq("com_inspecao", atual)
    .select("id").maybeSingle();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!mudou) return NextResponse.json({ erro: "Outra pessoa alterou esta OS agora há pouco — recarregue a página.", jaMudou: true }, { status: 409 });

  const { error: erroHist } = await supabase.from("gp_fase_historico").insert({
    inspecao_id: params.id,
    fase_de: fase,
    fase_para: plano.faseNova,
    acao: "alterar_inspecao",
    motivo: `Haverá inspeção? ${atual ? "Sim" : "Não"} → ${body.comInspecao ? "Sim" : "Não"}. ${plano.aviso}`,
    autor: profile.id,
  });
  return NextResponse.json({
    ok: true, fase: plano.faseNova, comInspecao: body.comInspecao, aviso: plano.aviso,
    ...(erroHist ? { avisoHistorico: erroHist.message } : {}),
  });
}
