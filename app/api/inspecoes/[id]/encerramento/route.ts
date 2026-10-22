import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ULTIMA_FASE } from "@/lib/asp/fases";
import { ehUuid } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import { contextoEncerramento, lerOS, nomeUsuario, recalcularConclusaoProjeto } from "@/lib/asp/os-encerrada";
import {
  dataBrCompleta, mensagemJaEncerrada, normalizarEspacos, podeEncerrar, podeEncerrarManual, podeReabrir, primeiroErro,
  ROTULOS_ENCERRAMENTO, ROTULOS_REABERTURA, temErros, validarEncerramento, validarReabertura,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Situação do encerramento (fase 10): quem/quando encerrou, pendências
 *  (calculadas aqui — a tela mostra estas), última atividade da OS e se há
 *  entrega registrada. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const os = await lerOS(params.id);
  if (!os || os.excluido_em) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  const ctx = await contextoEncerramento(os);
  return NextResponse.json({
    ok: true,
    hoje: ctx.hoje,
    pendencias: ctx.pendencias,
    ultima: ctx.ultima,
    entregas: ctx.entregas,
    encerramento: os.encerrada_em ? {
      em: os.encerrada_em, por: os.encerrada_por, porNome: await nomeUsuario(os.encerrada_por),
      manual: os.encerramento_manual, justificativa: os.encerramento_justificativa, pendenciasIgnoradas: os.encerramento_pendencias || [],
    } : null,
    permissoes: { encerrar: podeEncerrar(profile.perfil), manual: podeEncerrarManual(profile.perfil), reabrir: podeReabrir(profile.perfil) },
  });
}

interface Body {
  acao: "encerrar" | "reabrir";
  /** Encerrar: data (AAAA-MM-DD, Brasília). */
  data?: string;
  /** Encerrar ignorando pendências (Admin/Gerência) + justificativa. */
  manual?: boolean;
  justificativa?: string;
  /** Reabrir: motivo. */
  motivo?: string;
}

/** 409 "Já encerrada por X em DD/MM". */
async function respostaJaEncerrada(id: string) {
  const os = await lerOS(id);
  return NextResponse.json({
    erro: mensagemJaEncerrada(await nomeUsuario(os?.encerrada_por), os?.encerrada_em), jaEncerrada: true,
  }, { status: 409 });
}

/** Encerrar ({ acao: "encerrar", data, manual?, justificativa? }) ou reabrir
 *  ({ acao: "reabrir", motivo }) a OS.
 *
 *  · ATÔMICO: encerra só `where fase = 10 and encerrada_em is null`; reabre
 *    só `where encerrada_em is not null`. Duplo clique / dois usuários → um
 *    vence, o outro recebe 409 "Já encerrada por X em DD/MM".
 *  · Idempotente: a Idempotency-Key (fila offline) fica no histórico; o
 *    reenvio devolve o resultado já aplicado.
 *  · ⛔ pendências (recalculadas aqui) bloqueiam o encerramento normal; o
 *    manual (Admin/Gerência) exige justificativa e grava as pendências
 *    ignoradas. ⛔ data no futuro ou antes da última atividade. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Body;
  const chave = req.headers.get("idempotency-key");
  const chaveValida = chave && ehUuid(chave) ? chave : null;
  const admin = getSupabaseAdmin();

  if (body.acao !== "encerrar" && body.acao !== "reabrir") {
    return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
  }

  // Reenvio com a mesma chave: já aplicado.
  const jaFeito = async () => {
    if (!chaveValida) return null;
    const { data } = await admin.from("gp_fase_historico").select("inspecao_id, acao").eq("chave_idempotencia", chaveValida).maybeSingle();
    return data && (data as any).inspecao_id === params.id && (data as any).acao === body.acao
      ? NextResponse.json({ ok: true, repetido: true }) : null;
  };
  const repetido = await jaFeito();
  if (repetido) return repetido;

  const os = await lerOS(params.id);
  if (!os || os.excluido_em) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });

  // ── Reabrir ──────────────────────────────────────────────────────────────
  if (body.acao === "reabrir") {
    const motivo = normalizarEspacos(body.motivo);
    const v = validarReabertura({ motivo }, profile.perfil);
    if (temErros(v)) {
      return NextResponse.json({ erro: primeiroErro(v, ROTULOS_REABERTURA), erros: v.erros }, { status: v.erros.perfil ? 403 : 400 });
    }
    if (!os.encerrada_em) {
      const { data: ult } = await admin.from("gp_fase_historico").select("autor, criado_em")
        .eq("inspecao_id", params.id).eq("acao", "reabrir").order("criado_em", { ascending: false }).limit(1).maybeSingle();
      const quem = await nomeUsuario((ult as any)?.autor);
      return NextResponse.json({
        erro: ult ? `Esta OS já foi reaberta${quem ? ` por ${quem}` : ""} em ${dataBrCompleta((ult as any).criado_em).slice(0, 5)}. Recarregue a página.` : "Esta OS não está encerrada.",
        jaReaberta: true,
      }, { status: 409 });
    }
    const { data: aberta, error } = await admin.from("gp_inspecoes")
      .update({
        encerrada_em: null, encerrada_por: null, encerramento_manual: false, encerramento_justificativa: null,
        encerramento_pendencias: null, atualizado_em: new Date().toISOString(),
      })
      .eq("id", params.id).not("encerrada_em", "is", null)
      .select("id").maybeSingle();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    if (!aberta) {
      const r = await jaFeito();
      return r || NextResponse.json({ erro: "Esta OS acabou de ser reaberta por outra pessoa. Recarregue a página.", jaReaberta: true }, { status: 409 });
    }
    const { error: eh } = await admin.from("gp_fase_historico").insert({
      inspecao_id: params.id, fase_de: os.fase, fase_para: os.fase, acao: "reabrir",
      motivo: `${motivo} (estava encerrada em ${dataBrCompleta(os.encerrada_em)})`,
      autor: profile.id, chave_idempotencia: chaveValida,
    });
    await recalcularConclusaoProjeto(os.projeto_id);
    if (eh && !ehViolacaoUnica(eh)) return NextResponse.json({ ok: true, avisoHistorico: eh.message });
    return NextResponse.json({ ok: true });
  }

  // ── Encerrar ─────────────────────────────────────────────────────────────
  if (!podeEncerrar(profile.perfil)) {
    return NextResponse.json({ erro: "Só Admin, Gerência e Comercial encerram a OS." }, { status: 403 });
  }
  if (os.encerrada_em) return respostaJaEncerrada(params.id);
  if (os.fase !== ULTIMA_FASE) {
    return NextResponse.json({ erro: `A OS está na fase ${os.fase} — só pode ser encerrada na fase ${ULTIMA_FASE} (Encerramento).` }, { status: 409 });
  }
  const manual = body.manual === true;
  const justificativa = normalizarEspacos(body.justificativa);
  const data = String(body.data || "").trim();
  const ctx = await contextoEncerramento(os);
  const v = validarEncerramento({ data, manual, justificativa }, {
    perfil: profile.perfil, hoje: ctx.hoje, ultima: ctx.ultima, pendencias: ctx.pendencias,
    entregas: ctx.entregas < 0 ? undefined : ctx.entregas,
  });
  if (temErros(v)) {
    return NextResponse.json({
      erro: primeiroErro(v, ROTULOS_ENCERRAMENTO), erros: v.erros, avisos: v.avisos, pendencias: ctx.pendencias,
    }, { status: v.erros.perfil ? 403 : 400 });
  }
  const ignoradas = manual ? ctx.pendencias.map((p) => p.texto) : [];

  const { data: fechada, error } = await admin.from("gp_inspecoes")
    .update({
      encerrada_em: data, encerrada_por: profile.id, encerramento_manual: manual,
      encerramento_justificativa: manual ? justificativa : null,
      encerramento_pendencias: manual && ignoradas.length ? ignoradas : null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", params.id).eq("fase", ULTIMA_FASE).is("encerrada_em", null)
    .select("id").maybeSingle();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!fechada) return (await jaFeito()) || respostaJaEncerrada(params.id);

  const motivo = manual
    ? `Encerramento manual em ${dataBrCompleta(data)} — justificativa: ${justificativa}${ignoradas.length ? ` · Pendências ignoradas: ${ignoradas.join(" | ")}` : " · Sem pendências"}`
    : `Data de encerramento: ${dataBrCompleta(data)}`;
  const { error: eh } = await admin.from("gp_fase_historico").insert({
    inspecao_id: params.id, fase_de: ULTIMA_FASE, fase_para: ULTIMA_FASE, acao: "encerrar",
    motivo, autor: profile.id, chave_idempotencia: chaveValida,
  });
  await recalcularConclusaoProjeto(os.projeto_id);
  if (eh && !ehViolacaoUnica(eh)) return NextResponse.json({ ok: true, avisos: v.avisos, avisoHistorico: eh.message });
  return NextResponse.json({ ok: true, avisos: v.avisos });
}
