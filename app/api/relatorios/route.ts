import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { DOCX_MIME, removerArquivos, uploadArquivo } from "@/lib/processos/arquivos";
import { ehUuid, sha256 } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import {
  apontarSubstituto, caminhoRelatorioValido, desfazerSubstituicao, examinarNoStorage, execucaoExigeLaudo, fotosDeRascunho,
  infoOSRelatorio, inserirComVersao, limparFotosRascunho, limparLaudoAntigo, marcarSubstituidos, MSG_LAUDO_OBRIGATORIO,
  paraRelatorioRef, PERFIS_RELATORIO, relatoriosDaOS, validarSnapshotServidor, verificarLaudoPdf,
} from "@/lib/asp/relatorio-api";
import {
  arquivoRelatorioRepetido, descreverRelatorio, erroTipoNaFase, examinarArquivoRelatorio, primeiroErro,
  LaudoPdf, rascunhoDoTipo, RELATORIO_GERADO_MAX_BYTES, RELATORIO_MAX_BYTES, ROTULOS_RELATORIO, ROTULOS_RELATORIO_EXECUCAO,
  SnapshotRelatorio, temErros,
} from "@/lib/validacao";

import { garantirOsAberta } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

interface Corpo {
  id?: string;
  inspecaoId: string;
  tipo: string;
  rascunho: boolean;
  dados: SnapshotRelatorio | null;
  arquivoPath: string;
  /** Arquivo no próprio corpo (envio antigo / fila offline). */
  arquivo?: Uint8Array | null;
  /** PDF do laudo (envio de fora do relatório de execução, Fase 8). */
  laudoPdf?: LaudoPdf | null;
}

/** JSON (o normal: o arquivo já está no storage) ou multipart (legado). */
async function lerCorpo(req: Request): Promise<{ corpo?: Corpo; erro?: string }> {
  const ct = req.headers.get("content-type") || "";
  const get: Record<string, unknown> = {};
  let arquivo: Uint8Array | null = null;
  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return { erro: "Envio inválido (formulário corrompido)." }; }
    form.forEach((v, k) => { if (typeof v === "string") get[k] = v; });
    const f = form.get("arquivo");
    if (f instanceof Blob && f.size > 0) arquivo = new Uint8Array(await f.arrayBuffer());
  } else {
    try { Object.assign(get, await req.json()); } catch { return { erro: "Envio inválido (JSON corrompido)." }; }
  }
  let dados: SnapshotRelatorio | null = null;
  if (typeof get.dados === "string" && get.dados.trim()) {
    try { dados = JSON.parse(get.dados); } catch { return { erro: "Os dados do formulário chegaram corrompidos. Gere o rascunho de novo." }; }
  } else if (get.dados && typeof get.dados === "object") dados = get.dados as SnapshotRelatorio;
  let laudoPdf: LaudoPdf | null = null;
  if (typeof get.laudoPdf === "string" && get.laudoPdf.trim()) {
    try { laudoPdf = JSON.parse(get.laudoPdf); } catch { return { erro: "O laudo chegou corrompido. Anexe de novo." }; }
  } else if (get.laudoPdf && typeof get.laudoPdf === "object") laudoPdf = get.laudoPdf as LaudoPdf;
  return {
    corpo: {
      id: typeof get.id === "string" ? get.id : req.headers.get("idempotency-key") || undefined,
      inspecaoId: String(get.inspecaoId || ""),
      tipo: String(get.tipo || ""),
      rascunho: get.rascunho === true || get.rascunho === "1",
      dados,
      arquivoPath: String(get.arquivoPath || ""),
      arquivo,
      laudoPdf,
    },
  };
}

/** Registra um relatório da OS (Fase 4) — rascunho gerado no sistema ou
 *  arquivo enviado de fora, que já entra em aprovação.
 *
 *   · A VERSÃO é calculada aqui, no insert (maior + 1; o índice único
 *     recusa colisão e o cálculo é refeito) — nunca no navegador.
 *   · Um rascunho por OS/tipo: gerar de novo ATUALIZA o rascunho existente.
 *   · Envio com outra versão em aprovação: a anterior vira 'substituido'.
 *   · O tipo segue a fase da OS; o arquivo é conferido NO STORAGE (existe,
 *     é desta OS, PDF/DOCX de verdade, tamanho) e o mesmo arquivo (SHA-256)
 *     não entra duas vezes na OS.
 *   · Idempotente: o `id` (ou Idempotency-Key) da fila offline/duplo clique
 *     devolve o registro já criado em vez de duplicar. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_RELATORIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Envio de relatório é responsabilidade de Operações." }, { status: 403 });
  }

  const { corpo, erro } = await lerCorpo(req);
  if (!corpo) return NextResponse.json({ erro }, { status: 400 });
  const { inspecaoId, rascunho: ehRascunho, dados } = corpo;
  if (!inspecaoId) return NextResponse.json({ erro: "OS obrigatória." }, { status: 400 });
  if (corpo.id && !ehUuid(corpo.id)) return NextResponse.json({ erro: "Identificador do envio inválido." }, { status: 400 });
  const id = corpo.id || randomUUID();

  const admin = getSupabaseAdmin();
  // Reenvio (fila offline, duplo clique): já registrado → devolve o mesmo.
  const { data: existente } = await admin.from("gp_relatorios").select("*").eq("id", id).maybeSingle();
  if (existente) {
    if (existente.inspecao_id !== inspecaoId) return NextResponse.json({ erro: "Identificador já usado em outra OS." }, { status: 409 });
    return NextResponse.json({ ok: true, relatorio: existente, repetido: true });
  }

  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(inspecaoId);
  if (travada) return travada;
  const info = await infoOSRelatorio(inspecaoId);
  if (!info) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });
  const tipo = corpo.tipo;
  const erroTipo = erroTipoNaFase(tipo, info.fase, info.comInspecao);
  if (erroTipo) return NextResponse.json({ erro: erroTipo }, { status: 400 });
  if (ehRascunho && !dados) return NextResponse.json({ erro: "Rascunho sem os dados do formulário." }, { status: 400 });

  // Arquivo: conferido pelos bytes, no storage (ou no corpo, no legado).
  const max = dados ? RELATORIO_GERADO_MAX_BYTES : RELATORIO_MAX_BYTES;
  let caminho = corpo.arquivoPath;
  let hash: string | null;
  let formato: "pdf" | "docx" | null;
  let enviadoAgora = false;   // subimos aqui: apagar se o registro falhar
  if (corpo.arquivo) {
    const ex = await examinarArquivoRelatorio(corpo.arquivo, { max });
    if (ex.erro) return NextResponse.json({ erro: ex.erro, erros: { arquivo: [ex.erro] } }, { status: 400 });
    formato = ex.formato;
    hash = sha256(corpo.arquivo);
    caminho = `relatorios/${inspecaoId}/${tipo}-${randomUUID()}.${formato}`;
  } else {
    if (!caminho) return NextResponse.json({ erro: "Envie o arquivo do relatório." }, { status: 400 });
    if (!caminhoRelatorioValido(caminho, inspecaoId)) {
      return NextResponse.json({ erro: "Caminho do arquivo inválido para esta OS." }, { status: 400 });
    }
    const ex = await examinarNoStorage(caminho, max);
    if (ex.erro) {
      if (!ex.naoExiste) await removerArquivos([caminho]);
      return NextResponse.json({ erro: ex.erro, erros: { arquivo: [ex.erro] } }, { status: 400 });
    }
    hash = ex.hash; formato = ex.formato;
    if (!caminho.toLowerCase().endsWith(`.${formato}`)) {
      await removerArquivos([caminho]);
      const e = `O conteúdo é ${formato?.toUpperCase()}, mas o nome diz outra coisa. Renomeie o arquivo com a extensão certa.`;
      return NextResponse.json({ erro: e, erros: { arquivo: [e] } }, { status: 400 });
    }
  }
  const descartar = async () => { if (corpo.arquivo ? enviadoAgora : true) await removerArquivos([caminho]); };

  const linhas = await relatoriosDaOS(inspecaoId);
  const refs = linhas.map(paraRelatorioRef);
  const rascunhoAtual = ehRascunho ? rascunhoDoTipo(refs, tipo) : null;
  const anterior = rascunhoAtual ? linhas.find((l) => l.id === rascunhoAtual.id) || null : null;

  const igual = arquivoRelatorioRepetido(hash, refs, rascunhoAtual?.id);
  if (igual) {
    await descartar();
    const e = `Este mesmo arquivo já foi enviado nesta OS (${descreverRelatorio(igual)}).`;
    return NextResponse.json({ erro: e, erros: { arquivo: [e] } }, { status: 409 });
  }

  if (dados) {
    const r = await validarSnapshotServidor(dados, { info, rels: refs, tipo, profile, anterior: anterior?.dados });
    if (temErros(r)) {
      await descartar();
      return NextResponse.json({ erro: primeiroErro(r, { ...ROTULOS_RELATORIO, ...ROTULOS_RELATORIO_EXECUCAO }), erros: r.erros, avisos: r.avisos }, { status: 400 });
    }
    dados.versaoSnapshot = 2;
  }

  // Envio de fora do relatório de execução com laudo (Fase 8): o PDF do
  // laudo é obrigatório e conferido no storage, como o próprio relatório.
  let dadosExterno: Record<string, unknown> | null = null;
  if (!ehRascunho && !dados && tipo === "execucao" && (corpo.laudoPdf || await execucaoExigeLaudo(info, tipo))) {
    const lv = await verificarLaudoPdf(corpo.laudoPdf, { inspecaoId, rels: refs, profileId: profile.id });
    const e = lv.erro || (lv.laudo ? null : MSG_LAUDO_OBRIGATORIO);
    if (e) {
      await descartar();
      return NextResponse.json({ erro: e, erros: { laudoPdf: [e] } }, { status: 400 });
    }
    dadosExterno = { externo: true, laudoPdf: lv.laudo };
  }

  if (corpo.arquivo) {
    try {
      await uploadArquivo(caminho, corpo.arquivo, formato === "pdf" ? "application/pdf" : DOCX_MIME);
      enviadoAgora = true;
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o arquivo." }, { status: 500 });
    }
  }

  const supabase = getSupabaseRouteClient();

  // ── Rascunho: um por OS/tipo — atualiza o existente ───────────────────────
  if (ehRascunho) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const alvo = tentativa === 0 ? anterior
        : (await relatoriosDaOS(inspecaoId)).find((l) => l.tipo === tipo && l.status === "rascunho") || null;
      if (alvo) {
        const { data, error } = await supabase.from("gp_relatorios")
          .update({ arquivo_path: caminho, arquivo_hash: hash, dados, atualizado_em: new Date().toISOString() })
          .eq("id", alvo.id).eq("status", "rascunho").select("*").maybeSingle();
        if (error) { await descartar(); return NextResponse.json({ erro: error.message }, { status: 500 }); }
        if (!data) continue;   // foi enviado/excluído no meio do caminho
        if (alvo.arquivo_path && alvo.arquivo_path !== caminho) await removerArquivos([alvo.arquivo_path]);
        // laudos trocados no rascunho (antes e após)
        const novosLaudos = new Set([dados?.laudoPdf?.caminho, dados?.laudoPdfDepois?.caminho].filter(Boolean));
        for (const c of [alvo.dados?.laudoPdf?.caminho, alvo.dados?.laudoPdfDepois?.caminho]) {
          if (c && !novosLaudos.has(c)) await limparLaudoAntigo(inspecaoId, c);
        }
        const novas = new Set(fotosDeRascunho(dados, inspecaoId));
        await limparFotosRascunho(inspecaoId, fotosDeRascunho(alvo.dados, inspecaoId).filter((c) => !novas.has(c)));
        return NextResponse.json({ ok: true, relatorio: data, atualizado: true });
      }
      const { data, error } = await inserirComVersao(supabase, {
        id, inspecao_id: inspecaoId, tipo, arquivo_path: caminho, arquivo_hash: hash, status: "rascunho", dados,
        enviado_por: profile.id, enviado_em: null,
      });
      if (!error) return NextResponse.json({ ok: true, relatorio: data });
      // Corrida: outro rascunho do tipo nasceu agora → atualiza ele.
      if (ehViolacaoUnica(error) && /rascunho/i.test(error.message || "")) continue;
      await descartar();
      if (ehViolacaoUnica(error)) return NextResponse.json({ erro: "Este arquivo acabou de ser enviado nesta OS por outro envio. Recarregue a página." }, { status: 409 });
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }
    await descartar();
    return NextResponse.json({ erro: "O rascunho mudou enquanto salvava. Recarregue a página e tente de novo." }, { status: 409 });
  }

  // ── Envio direto (arquivo de fora): nova versão, já em aprovação ─────────
  const substituidos = await marcarSubstituidos(inspecaoId, tipo, null);
  const { data, error } = await inserirComVersao(supabase, {
    id, inspecao_id: inspecaoId, tipo, arquivo_path: caminho, arquivo_hash: hash, status: "em_aprovacao",
    enviado_por: profile.id, enviado_em: new Date().toISOString(),
    ...(dadosExterno ? { dados: dadosExterno } : {}),
  });
  if (error) {
    await desfazerSubstituicao(substituidos);
    await descartar();
    if (ehViolacaoUnica(error)) return NextResponse.json({ erro: "Outro envio deste relatório acabou de entrar. Recarregue a página." }, { status: 409 });
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  await apontarSubstituto(substituidos, data.id);
  const colStatus = tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
  await supabase.from("gp_inspecoes").update({ [colStatus]: "em_aprovacao" }).eq("id", inspecaoId);

  return NextResponse.json({ ok: true, relatorio: data, substituidos });
}
