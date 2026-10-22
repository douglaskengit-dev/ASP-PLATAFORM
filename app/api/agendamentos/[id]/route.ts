import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  contextoAgendamento, erroGravacao, ligarSubstituidos, limparDados, notificarADefinir, notificarDesmarcacao, notificarEquipe,
  PERFIS_AGENDA, resolverAvisoADefinir, tirarDeCena, voltarACena,
} from "@/lib/asp/agendamento-api";
import { periodoMudou, primeiroErro, ROTULOS_AGENDAMENTO, temErros, validarAgendamento } from "@/lib/validacao";

export const runtime = "nodejs";

/** Edita um agendamento ativo. Campos ausentes no corpo ficam como estão.
 *  Mesmas regras da criação (lib/validacao/agendamento.ts); a data só é
 *  checada contra "hoje" se mudou — registro antigo com data passada pode ter
 *  os outros campos corrigidos.
 *
 *  Mudar a data de uma visita já marcada é REMARCAÇÃO, com a mesma semântica
 *  do POST: nasce uma linha nova (a atual) e esta fica substituída, no
 *  histórico ("Remarcado de … para …"); a equipe recebe o aviso de
 *  remarcação. Dar data a um "a definir" não é remarcação: a linha vira
 *  agendamento normal e o aviso pendente é resolvido.
 *
 *  Fase 6: mudar o INÍCIO ou o FIM do período da execução também é
 *  remarcação (a equipe precisa saber dos dias novos). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!PERFIS_AGENDA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Agendamento é responsabilidade do Comercial." }, { status: 403 });
  }

  const { data: atual } = await getSupabaseAdmin().from("gp_agendamentos").select("*").eq("id", params.id).maybeSingle();
  if (!atual) return NextResponse.json({ erro: "Agendamento não encontrado." }, { status: 404 });
  if (atual.substituido_em) {
    return NextResponse.json({ erro: "Este agendamento já foi remarcado — edite o agendamento atual." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const de = (campo: string, valor: unknown) => (campo in body ? body[campo] : valor);
  const dados = limparDados({
    tipo: atual.tipo,
    aDefinir: de("aDefinir", atual.a_definir),
    dataVisita: de("dataVisita", atual.data_visita),
    dataFim: de("dataFim", atual.data_fim),
    hora: de("hora", atual.hora),
    dataExecucao: de("dataExecucao", atual.data_execucao),
    lembrarEm: de("lembrarEm", atual.lembrar_em),
    equipe: de("equipe", atual.equipe),
    equipamentos: de("equipamentos", atual.equipamentos),
    checklist: de("checklist", atual.checklist),
  });

  const { ctx, info } = await contextoAgendamento({
    inspecaoId: atual.inspecao_id, dataVisita: dados.dataVisita, dataFim: dados.dataFim,
    original: { id: atual.id, data_visita: atual.data_visita, data_fim: atual.data_fim || null },
  });
  if (!info) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  dados.equipamentos = limparDados({ equipamentos: dados.equipamentos }, ctx.catalogo).equipamentos;
  const resultado = validarAgendamento(dados, ctx);
  if (temErros(resultado)) {
    const conflito = (ctx.daOS || []).find((a) => a.id !== atual.id && a.tipo === dados.tipo && !!dados.dataVisita && a.data_visita === dados.dataVisita) || null;
    return NextResponse.json(
      { erro: primeiroErro(resultado, ROTULOS_AGENDAMENTO), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }

  const campos = {
    data_visita: dados.aDefinir ? null : dados.dataVisita,
    data_fim: dados.aDefinir || atual.tipo !== "execucao" ? null : dados.dataFim || null,
    a_definir: !!dados.aDefinir,
    lembrar_em: dados.aDefinir ? dados.lembrarEm || null : null,
    data_execucao: dados.dataExecucao || null,
    hora: dados.aDefinir ? null : dados.hora || null,
    equipe: dados.equipe,
    equipamentos: dados.equipamentos,
    checklist: dados.checklist,
  };
  const supabase = getSupabaseRouteClient();
  const remarcacao = periodoMudou(atual, campos);

  if (remarcacao) {
    // A atual sai de cena antes (uma execução ativa por OS); se o insert
    // falhar, volta.
    const tirados = await tirarDeCena(supabase, [atual.id]);
    if (tirados.erro) return NextResponse.json({ erro: `A data anterior não pôde sair de cena: ${tirados.erro}` }, { status: 500 });
    if (tirados.ids.length === 0) {
      return NextResponse.json({ erro: "Este agendamento acabou de ser remarcado por outra pessoa — recarregue a página." }, { status: 409 });
    }
    const { data: novo, error } = await supabase
      .from("gp_agendamentos")
      .insert({ ...campos, inspecao_id: atual.inspecao_id, tipo: atual.tipo, criado_por: profile.id })
      .select("*")
      .single();
    if (error) {
      await voltarACena(supabase, tirados.ids);
      const e = erroGravacao(error);
      return NextResponse.json({ erro: e.erro }, { status: e.status });
    }
    const erroSub = await ligarSubstituidos(supabase, tirados.ids, novo.id);
    if (erroSub) return NextResponse.json({ erro: `Remarcado, mas o histórico não foi ligado: ${erroSub}` }, { status: 500 });
    let email: Record<string, unknown> = { destinatarios: 0, ignorado: true, motivo: "data a definir" };
    if (novo.a_definir) {
      await notificarADefinir({ ag: novo, info, autorId: profile.id });
      await notificarDesmarcacao({ anterior: atual, info, autorId: profile.id });
    } else {
      email = await notificarEquipe({ ag: novo, info, autorId: profile.id, remarcadoDe: atual });
    }
    return NextResponse.json({
      ok: true, agendamento: novo, avisos: resultado.avisos, email,
      substituidos: [{ id: atual.id, data_visita: atual.data_visita, data_fim: atual.data_fim || null }],
    });
  }

  const { data, error } = await supabase
    .from("gp_agendamentos")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) {
    const e = erroGravacao(error);
    return NextResponse.json({ erro: e.erro }, { status: e.status });
  }

  // "A definir" ganhou data: vira agendamento normal — resolve o aviso e
  // avisa a equipe como num agendamento novo.
  let email: Record<string, unknown> | undefined;
  if (atual.a_definir && !data.a_definir) {
    await resolverAvisoADefinir(atual.inspecao_id);
    email = await notificarEquipe({ ag: data, info, autorId: profile.id });
  }
  return NextResponse.json({ ok: true, agendamento: data, avisos: resultado.avisos, email });
}

/** Remove um agendamento (o ativo ou uma linha do histórico). Se era um
 *  "data a definir", o aviso pendente deixa de valer. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!PERFIS_AGENDA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Agendamento é responsabilidade do Comercial." }, { status: 403 });
  }
  const supabase = getSupabaseRouteClient();
  const { data: atual } = await supabase.from("gp_agendamentos").select("inspecao_id, a_definir, substituido_em").eq("id", params.id).maybeSingle();
  const { error } = await supabase.from("gp_agendamentos").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (atual?.a_definir && !atual.substituido_em) await resolverAvisoADefinir(atual.inspecao_id);
  return NextResponse.json({ ok: true });
}
