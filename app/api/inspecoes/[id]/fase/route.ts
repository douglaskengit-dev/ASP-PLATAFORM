import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { acoesDisponiveis, AcaoFase, faseMinima, ULTIMA_FASE } from "@/lib/asp/fases";
import { ehUuid } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import {
  escolherRelatorioAvaliado, mensagemJaAvaliado, normalizarEspacos, primeiroErro, ROTULOS_REPROVACAO, temErros,
  tipoDaFase, validarReprovacao,
} from "@/lib/validacao";

import { garantirOsAberta } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

interface AcaoBody {
  acao: AcaoFase;
  /** Reprovação: descrição do ajuste (≥ 15 caracteres, com sentido). */
  motivo?: string;
  /** Reprovação: categoria (lib/validacao/aprovacao.ts CATEGORIAS_REPROVACAO;
   *  "laudo" só no relatório de execução). */
  categoria?: string;
  /** Aprovar/reprovar: o relatório em aprovação mostrado na tela. */
  relatorioId?: string;
  /** A fase que a tela mostrava ao clicar. Diferente da atual = outro
   *  clique/usuário já moveu a OS → 409 (não avança duas vezes). */
  faseDe?: number;
}

/** Nome de quem fez a última movimentação (para o 409). */
async function nomeDe(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const { data } = await getSupabaseAdmin().from("gp_profiles").select("nome_completo, email").eq("id", id).maybeSingle();
  return (data as any)?.nome_completo || (data as any)?.email || null;
}

/** 409 "Já avaliado por X em Y": pelo próprio relatório (avaliado_por/_em)
 *  ou, sem isso, pela última movimentação da OS no histórico. */
async function respostaJaAvaliado(inspecaoId: string, relatorioId?: string | null): Promise<NextResponse> {
  const admin = getSupabaseAdmin();
  const { data: insp } = await admin.from("gp_inspecoes").select("fase").eq("id", inspecaoId).maybeSingle();
  if (relatorioId) {
    const { data: rel } = await admin.from("gp_relatorios").select("*").eq("id", relatorioId).maybeSingle();
    const r: any = rel;
    if (r && (r.status === "aprovado" || r.status === "ajustar" || r.status === "assinado")) {
      const quem = r.avaliado_por || r.aprovado_por;
      const erro = mensagemJaAvaliado({
        acao: r.status === "ajustar" ? "reprovar" : "aprovar",
        nome: await nomeDe(quem), em: r.avaliado_em || null, faseAtual: (insp as any)?.fase,
      });
      return NextResponse.json({ erro, jaAvaliado: true }, { status: 409 });
    }
    if (r?.status === "substituido") {
      return NextResponse.json({ erro: "Esta versão foi substituída por outra enviada depois. Recarregue a página.", jaAvaliado: true }, { status: 409 });
    }
  }
  const { data: ult } = await admin.from("gp_fase_historico").select("acao, autor, criado_em")
    .eq("inspecao_id", inspecaoId).order("criado_em", { ascending: false }).limit(1).maybeSingle();
  const erro = mensagemJaAvaliado({
    acao: (ult as any)?.acao, nome: await nomeDe((ult as any)?.autor), em: (ult as any)?.criado_em, faseAtual: (insp as any)?.fase,
  });
  return NextResponse.json({ erro, jaAvaliado: true }, { status: 409 });
}

/**
 * Movimenta a fase da OS (avançar; aprovar/reprovar nas fases 5/9).
 *
 *  · ATÔMICO: a fase só muda com `where fase = <fase lida>` e o relatório só
 *    muda com `where status = 'em_aprovacao'`. Dois cliques (ou dois
 *    gerentes) ao mesmo tempo → um vence, o outro recebe 409 "Já avaliado por
 *    X em Y". Sem histórico duplicado.
 *  · Idempotente: a Idempotency-Key (fila offline) fica no histórico; o
 *    reenvio devolve o resultado já aplicado.
 *  · ⛔ Aprovar/reprovar exige um relatório do tipo da fase em aprovação.
 *  · ⛔ Reprovar exige categoria + descrição com sentido (≥ 15 caracteres);
 *    a categoria "Laudo/Laboratório" só no relatório de execução (fase 9).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as AcaoBody;
  const chave = req.headers.get("idempotency-key");
  const chaveValida = chave && ehUuid(chave) ? chave : null;
  const supabase = getSupabaseRouteClient();
  const admin = getSupabaseAdmin();

  // Reenvio (fila offline, duplo clique com a mesma chave): já aplicado.
  if (chaveValida) {
    const { data: feito } = await admin.from("gp_fase_historico").select("fase_para, inspecao_id")
      .eq("chave_idempotencia", chaveValida).maybeSingle();
    if (feito && (feito as any).inspecao_id === params.id) {
      return NextResponse.json({ ok: true, fase: (feito as any).fase_para, repetido: true });
    }
  }

  // "*": com_inspecao sem quebrar antes da migração.
  const { data: inspecao, error: erroBusca } = await supabase
    .from("gp_inspecoes")
    .select("*")
    .eq("id", params.id)
    .single();
  if (erroBusca || !inspecao) {
    return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  }

  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(params.id);
  if (travada) return travada;
  const faseAtual: number = inspecao.fase;
  // OS sem inspeção: nenhuma ação a leva para as fases 2–5.
  const comInspecao = (inspecao as any).com_inspecao !== false;
  // A tela via outra fase: alguém (ou o 1º clique) já moveu a OS.
  if (typeof body.faseDe === "number" && body.faseDe !== faseAtual) {
    return respostaJaAvaliado(params.id, body.relatorioId);
  }
  const opcoes = acoesDisponiveis(profile.perfil, faseAtual, { comInspecao });
  const opcao = opcoes.find((o) => o.acao === body.acao);
  if (!opcao) {
    // Aprovar/reprovar fora das fases 5/9, por quem aprova: a OS já saiu da
    // fase de aprovação (outro clique) — explica quem/quando.
    const aprovaria = acoesDisponiveis(profile.perfil, tipoDaFase(faseAtual) === "inspecao" ? 5 : 9).some((o) => o.acao === body.acao);
    if ((body.acao === "aprovar" || body.acao === "reprovar") && aprovaria) return respostaJaAvaliado(params.id, body.relatorioId);
    return NextResponse.json({ erro: "Ação não permitida para o seu perfil nesta fase." }, { status: 403 });
  }

  const motivo = normalizarEspacos(body.motivo);
  const categoria = body.acao === "reprovar" ? String(body.categoria || "") : null;
  // Tipo do relatório avaliado nesta fase (5 = inspeção, 9 = execução).
  const tipo = tipoDaFase(faseAtual);
  if (opcao.exigeMotivo) {
    // "Laudo/Laboratório" só vale para o relatório de execução (fase 9).
    const v = validarReprovacao({ categoria, descricao: motivo, tipo });
    if (temErros(v)) {
      return NextResponse.json({ erro: primeiroErro(v, ROTULOS_REPROVACAO), erros: v.erros }, { status: 400 });
    }
  }

  const novaFase = Math.min(Math.max(opcao.destino, faseMinima(comInspecao)), ULTIMA_FASE);
  const agora = new Date().toISOString();
  let alvo: { id: string; versao: number } | null = null;

  // ── 1) Aprovar/reprovar: trava o RELATÓRIO (em_aprovacao → aprovado/ajustar)
  if (body.acao === "aprovar" || body.acao === "reprovar") {
    const { data: emAprovacao } = await admin
      .from("gp_relatorios").select("id, versao, status")
      .eq("inspecao_id", params.id).eq("tipo", tipo).eq("status", "em_aprovacao").is("excluido_em", null);
    const escolha = escolherRelatorioAvaliado((emAprovacao || []) as any[], body.relatorioId, tipo);
    if ("erro" in escolha) {
      if (escolha.jaAvaliado) return respostaJaAvaliado(params.id, body.relatorioId);
      // Fila vazia porque um clique de agora há pouco acabou de avaliar
      // (chamada sem relatorioId, ex.: fila offline antiga) → "Já avaliado".
      if (escolha.status === 400) {
        const { data: recente } = await admin.from("gp_relatorios").select("id, avaliado_em")
          .eq("inspecao_id", params.id).eq("tipo", tipo).in("status", ["aprovado", "ajustar"]).is("excluido_em", null)
          .order("avaliado_em", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        const em = (recente as any)?.avaliado_em;
        if (em && Date.now() - new Date(em).getTime() < 2 * 60 * 1000) return respostaJaAvaliado(params.id, (recente as any).id);
      }
      return NextResponse.json({ erro: escolha.erro }, { status: escolha.status });
    }
    alvo = escolha.alvo;
    const { data: mudou, error } = await supabase
      .from("gp_relatorios")
      .update({
        status: body.acao === "aprovar" ? "aprovado" : "ajustar",
        motivo_ajuste: body.acao === "reprovar" ? motivo : null,
        motivo_categoria: categoria,
        aprovado_por: body.acao === "aprovar" ? profile.id : null,
        avaliado_por: profile.id,
        avaliado_em: agora,
        atualizado_em: agora,
      })
      .eq("id", alvo.id)
      .eq("status", "em_aprovacao")
      .select("id").maybeSingle();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    if (!mudou) return respostaJaAvaliado(params.id, alvo.id);
  }

  // ── 2) Fase: só anda se ainda estiver onde lemos (outro clique perde) ─────
  const { data: movida, error: erroUpdate } = await supabase
    .from("gp_inspecoes")
    .update({ fase: novaFase, atualizado_em: agora })
    .eq("id", params.id)
    .eq("fase", faseAtual)
    .select("id").maybeSingle();
  if (erroUpdate || !movida) {
    // Desfaz a avaliação do relatório (só a nossa: mesmo avaliado_em).
    if (alvo) {
      await admin.from("gp_relatorios")
        .update({ status: "em_aprovacao", motivo_ajuste: null, motivo_categoria: null, aprovado_por: null, avaliado_por: null, avaliado_em: null })
        .eq("id", alvo.id).eq("avaliado_em", agora).eq("avaliado_por", profile.id);
    }
    if (erroUpdate) return NextResponse.json({ erro: erroUpdate.message }, { status: 500 });
    return respostaJaAvaliado(params.id, null);
  }

  if (alvo) {
    const colStatus = tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
    await supabase.from("gp_inspecoes").update({ [colStatus]: body.acao === "aprovar" ? "aprovado" : "ajustar" }).eq("id", params.id);
  }

  const { error: erroHist } = await supabase.from("gp_fase_historico").insert({
    inspecao_id: params.id,
    fase_de: faseAtual,
    fase_para: novaFase,
    acao: body.acao,
    motivo: body.acao === "reprovar" ? motivo : null,
    motivo_categoria: categoria,
    relatorio_id: alvo?.id || null,
    autor: profile.id,
    chave_idempotencia: chaveValida,
  });
  // Mesma chave entrou agora por outro caminho: a transição já está feita.
  if (erroHist && !ehViolacaoUnica(erroHist)) {
    return NextResponse.json({ ok: true, fase: novaFase, avisoHistorico: erroHist.message });
  }

  return NextResponse.json({ ok: true, fase: novaFase });
}
