import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { removerArquivos, uploadArquivo } from "@/lib/processos/arquivos";
import {
  contextoColeta, ehUuid, examinarPdf, hashMedicao, lerCorpoColeta, validarColetaServidor,
} from "@/lib/asp/coleta-api";
import { podeRegistrarMedicao } from "@/lib/asp/permissoes";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import {
  DadosColeta, medicaoPreenchida, normalizarEspacos, primeiroErro, ROTULOS_COLETA, temErros, TipoColeta,
} from "@/lib/validacao";

import { garantirOsAberta } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** Salva uma coleta da OS. Aceita JSON (só dados) ou multipart/form-data
 * (campos + PDF). Persistir os dados permite reabrir/editar depois, não só o
 * PDF (COWORK-ASP §2.5).
 *
 *   tipo 'sedimento' — medição do medidor (dados), PDF do relatório opcional
 *   tipo 'anexo'     — só um PDF, com descrição obrigatória
 *
 * Regras em lib/validacao/coleta.ts + medicao.ts (a tela faz as mesmas).
 * Idempotente: o cliente manda o `id` da coleta (uuid gerado no clique, que
 * a fila offline reenvia igual). Repetir o envio devolve a coleta já criada
 * em vez de duplicar. O PDF sobe ANTES do registro: não sobra coleta
 * apontando para arquivo que não existe. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  // Perfil (Admin/Gerência/Operações) OU função com "Registrar medições".
  if (!podeRegistrarMedicao(profile)) {
    return NextResponse.json({ erro: "Registrar medição é com Operações, Gerência, Admin ou uma função com a permissão “Registrar medições / batimetria”." }, { status: 403 });
  }

  const { corpo, erro } = await lerCorpoColeta(req);
  if (!corpo) return NextResponse.json({ erro }, { status: 400 });

  const inspecaoId = corpo.inspecaoId || "";
  if (!inspecaoId) return NextResponse.json({ erro: "OS obrigatória." }, { status: 400 });
  if (corpo.id && !ehUuid(corpo.id)) return NextResponse.json({ erro: "Identificador da coleta inválido." }, { status: 400 });
  const id = corpo.id || randomUUID();

  const admin = getSupabaseAdmin();
  // Reenvio (fila offline, duplo clique): a coleta já existe → devolve ela.
  const { data: existente } = await admin.from("gp_coletas").select("*").eq("id", id).maybeSingle();
  if (existente) {
    if (existente.inspecao_id !== inspecaoId) {
      return NextResponse.json({ erro: "Identificador da coleta já usado em outra OS." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, coleta: existente, repetido: true });
  }

  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(inspecaoId);
  if (travada) return travada;

  const cx = await contextoColeta(inspecaoId);
  if (!cx) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });

  const pdf = examinarPdf(corpo.arquivo);
  const dadosRecebidos = corpo.dados || {};
  // PDF sem medição é anexo (inclusive de tela antiga que mandava 'sedimento').
  const tipo: TipoColeta = corpo.tipo === "anexo" || (!medicaoPreenchida(dadosRecebidos) && !!corpo.arquivo) ? "anexo" : "sedimento";
  const d: DadosColeta = {
    tipo,
    dataColeta: corpo.dataColeta,
    responsavelId: tipo === "sedimento" ? corpo.responsavelId : null,
    descricao: tipo === "anexo" ? corpo.descricao : null,
    dados: tipo === "sedimento" ? dadosRecebidos : {},
    arquivoHash: pdf.hash,
    erroArquivo: pdf.erro,
    exigirArquivo: tipo === "anexo",
  };
  const r = validarColetaServidor(d, cx.ctx);
  if (temErros(r.resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(r.resultado, ROTULOS_COLETA), erros: r.resultado.erros, avisos: r.resultado.avisos },
      { status: r.duplicada ? 409 : 400 }
    );
  }

  // Cabeçalho do relatório do medidor sempre igual ao registro.
  const nomeResp = cx.usuarios.find((u) => u.id === d.responsavelId)?.nome || null;
  const dados = tipo === "sedimento"
    ? { ...dadosRecebidos, reportDate: d.dataColeta, reportResponsavel: nomeResp || "" }
    : {};

  let pdfPath: string | null = null;
  if (corpo.arquivo) {
    pdfPath = `coletas/${inspecaoId}/${id}.pdf`;
    try {
      await uploadArquivo(pdfPath, corpo.arquivo.bytes, "application/pdf");
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o PDF." }, { status: 500 });
    }
  }

  const { data, error } = await getSupabaseRouteClient()
    .from("gp_coletas")
    .insert({
      id,
      inspecao_id: inspecaoId,
      tipo,
      dados,
      pdf_path: pdfPath,
      criado_por: profile.id,
      data_coleta: d.dataColeta,
      responsavel_id: tipo === "sedimento" ? d.responsavelId : null,
      descricao: tipo === "anexo" ? normalizarEspacos(d.descricao) : null,
      dados_hash: tipo === "sedimento" ? hashMedicao(dados) : null,
      arquivo_hash: pdf.hash,
    })
    .select("*")
    .single();

  if (error) {
    if (ehViolacaoUnica(error)) {
      // Corrida com o mesmo envio (mesmo id): vale o que entrou primeiro.
      const { data: ganhou } = await admin.from("gp_coletas").select("*").eq("id", id).maybeSingle();
      if (ganhou && ganhou.inspecao_id === inspecaoId) return NextResponse.json({ ok: true, coleta: ganhou, repetido: true });
      if (pdfPath) await removerArquivos([pdfPath]);
      return NextResponse.json({ erro: "Esta medição (ou este arquivo) acabou de ser salva nesta OS por outro envio. Recarregue a página." }, { status: 409 });
    }
    if (pdfPath) await removerArquivos([pdfPath]);
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, coleta: data, avisos: r.resultado.avisos });
}
