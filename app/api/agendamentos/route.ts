import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import {
  contextoAgendamento, limparDados, marcarSubstituidos, notificarADefinir, notificarDesmarcacao, notificarEquipe,
  PERFIS_AGENDA, resolverAvisoADefinir,
} from "@/lib/asp/agendamento-api";
import {
  agendamentosSubstituidos, nomeDoCatalogo, primeiroErro, ROTULOS_AGENDAMENTO, temErros,
  validarAgendamento,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Lista agendamentos ATIVOS (não substituídos por uma remarcação) — para o
 * calendário do Dashboard e o pré-preenchimento do RDO. Filtros opcionais:
 * ?inspecaoId= (uma OS) e ?aDefinir=1 (pendentes "data a definir", para os
 * avisos do Dashboard; OS ou projeto na lixeira ficam de fora). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId");
  const aDefinir = req.nextUrl.searchParams.get("aDefinir") === "1";
  const supabase = getSupabaseRouteClient();
  let query = supabase
    .from("gp_agendamentos")
    .select("id, tipo, data_visita, data_execucao, hora, equipe, equipamentos, checklist, a_definir, lembrar_em, criado_em, inspecao:gp_inspecoes(id, identificacao, excluido_em, projeto:gp_projetos(id, codigo_projeto, pedido_compra, excluido_em, cliente:gp_orgaos(razao_social)))")
    .is("substituido_em", null)
    .order("data_visita", { ascending: true });
  if (inspecaoId) query = query.eq("inspecao_id", inspecaoId);
  if (aDefinir) query = query.eq("a_definir", true).order("lembrar_em", { ascending: true, nullsFirst: false });
  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const agendamentos = aDefinir
    ? (data || []).filter((a: any) => a.inspecao && !a.inspecao.excluido_em && !a.inspecao.projeto?.excluido_em)
    : data || [];
  return NextResponse.json({ ok: true, agendamentos });
}

/** Cria um agendamento. As regras de lib/validacao/agendamento.ts são
 * repetidas aqui (a tela não é confiável). Remarcação SUBSTITUI: o
 * agendamento ativo do mesmo tipo desta OS sai de cena (fica no histórico).
 * Com data: notifica a equipe (in-app + push + e-mail com .ics), como
 * remarcação se substituiu uma data. "Data a definir": aviso in-app para
 * Comercial/Gerência/Admin (e o Dashboard lista o pendente). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_AGENDA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Agendamento é responsabilidade do Comercial." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body?.inspecaoId) {
    return NextResponse.json({ erro: "OS obrigatória." }, { status: 400 });
  }
  const dados = limparDados(body);

  const { ctx, info } = await contextoAgendamento({ inspecaoId: body.inspecaoId, dataVisita: dados.dataVisita });
  if (!info) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  dados.equipamentos = (dados.equipamentos || []).map((e) => nomeDoCatalogo(e, ctx.catalogo));
  const resultado = validarAgendamento(dados, ctx);
  if (temErros(resultado)) {
    const conflito = (ctx.daOS || []).find((a) => a.tipo === dados.tipo && !!dados.dataVisita && a.data_visita === dados.dataVisita) || null;
    return NextResponse.json(
      { erro: primeiroErro(resultado, ROTULOS_AGENDAMENTO), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }
  const substituidos = agendamentosSubstituidos(dados, ctx);

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_agendamentos")
    .insert({
      inspecao_id: body.inspecaoId,
      tipo: dados.tipo,
      data_visita: dados.aDefinir ? null : dados.dataVisita,
      a_definir: !!dados.aDefinir,
      lembrar_em: dados.aDefinir ? dados.lembrarEm || null : null,
      data_execucao: dados.dataExecucao || null,
      hora: dados.aDefinir ? null : dados.hora || null,
      equipe: dados.equipe,
      equipamentos: dados.equipamentos,
      checklist: dados.checklist,
      criado_por: profile.id,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const erroSub = await marcarSubstituidos(supabase, substituidos.map((a) => a.id), data.id);
  if (erroSub) return NextResponse.json({ erro: `Agendamento criado, mas o anterior não foi substituído: ${erroSub}` }, { status: 500 });

  // A data anterior (a mais recente substituída) define o texto de remarcação.
  const anterior = [...substituidos].filter((a) => a.data_visita).sort((a, b) => b.data_visita!.localeCompare(a.data_visita!))[0];
  let email: Record<string, unknown> = { destinatarios: 0, ignorado: true, motivo: "data a definir" };
  if (data.a_definir) {
    await notificarADefinir({ ag: data, info, autorId: profile.id });
    for (const a of substituidos) await notificarDesmarcacao({ anterior: a, info, autorId: profile.id });
  } else {
    if (substituidos.some((a) => a.a_definir)) await resolverAvisoADefinir(body.inspecaoId);
    email = await notificarEquipe({ ag: data, info, autorId: profile.id, remarcadoDe: anterior?.data_visita });
  }

  return NextResponse.json({
    ok: true, agendamento: data, avisos: resultado.avisos, email,
    // Quem foi substituído, para a tela dizer "remarcado de … para …".
    substituidos: substituidos.map((a) => ({ id: a.id, data_visita: a.data_visita })),
  });
}
