import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeAprovarColeta } from "@/lib/asp/permissoes";
import { removerArquivos, uploadArquivo } from "@/lib/processos/arquivos";
import {
  conflitoAoRestaurarColeta, contextoColeta, examinarPdf, hashMedicao, lerCorpoColeta, PERFIS_COLETA,
  validarColetaServidor,
} from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import {
  chaveMedicao, DadosColeta, motivoNaoAprovavel, normalizarEspacos, primeiroErro, ROTULOS_COLETA, temErros, TipoColeta,
} from "@/lib/validacao";

import { garantirOsAberta, osDe } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** PATCH de uma coleta:
 *   { aprovar: true|false }  — a medição que vale para o relatório (uma por OS)
 *   { restaurar: true }      — volta da lixeira (sem a aprovação)
 *   edição (JSON ou multipart com PDF): dados, dataColeta, responsavelId,
 *   descricao. Mesmas regras da criação. Mudar a MEDIÇÃO de uma coleta
 *   aprovada retira a aprovação (aprovacao_retirada_em). Mandar um PDF
 *   anexa/substitui o PDF da própria coleta — não cria outra. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const { corpo, erro } = await lerCorpoColeta(req);
  if (!corpo) return NextResponse.json({ erro }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: coleta } = await admin.from("gp_coletas").select("*").eq("id", params.id).maybeSingle();
  if (!coleta) return NextResponse.json({ erro: "Coleta não encontrada." }, { status: 404 });
  // ⛔ OS encerrada: nem editar, nem aprovar, nem restaurar.
  const travada = await garantirOsAberta(coleta.inspecao_id);
  if (travada) return travada;

  // A aprovação tem regra PRÓPRIA (Gerência/Admin/função com "Aprovar medição") e é avaliada
  // antes da permissão de coleta — quem tem a função de outra área pode validar
  // a medição sem poder editá-la.
  if (corpo.aprovar === true || corpo.aprovar === false) {
    if (!podeAprovarColeta(profile)) {
      return NextResponse.json({ erro: "Só Gerência, Admin ou uma função com a permissão “Aprovar medição” podem aprovar a medição." }, { status: 403 });
    }
    if (coleta.excluido_em) return NextResponse.json({ erro: "A coleta está na lixeira." }, { status: 400 });
    if (!corpo.aprovar) {
      const { error } = await admin.from("gp_coletas").update({ aprovada_em: null, aprovada_por: null }).eq("id", params.id);
      if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, aprovada: false });
    }
    const motivo = motivoNaoAprovavel(coleta);
    if (motivo) return NextResponse.json({ erro: motivo }, { status: 400 });
    // Exclusiva por OS: tira a marca das outras ATIVAS e marca esta. O índice
    // único (uma aprovada por OS) fecha a corrida entre dois aprovadores.
    const { error: e1 } = await admin.from("gp_coletas")
      .update({ aprovada_em: null, aprovada_por: null })
      .eq("inspecao_id", coleta.inspecao_id).is("excluido_em", null).neq("id", params.id)
      .not("aprovada_em", "is", null);
    if (e1) return NextResponse.json({ erro: e1.message }, { status: 500 });
    const { error } = await admin.from("gp_coletas")
      .update({ aprovada_em: new Date().toISOString(), aprovada_por: profile.id, aprovacao_retirada_em: null, aprovacao_retirada_por: null })
      .eq("id", params.id);
    if (ehViolacaoUnica(error)) {
      return NextResponse.json({ erro: "Outra medição desta OS foi aprovada ao mesmo tempo. Recarregue a página e confira." }, { status: 409 });
    }
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, aprovada: true });
  }

  if (!PERFIS_COLETA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta é responsabilidade de Operações." }, { status: 403 });
  }

  // Restaurar da lixeira (dentro dos 30 dias) — sem trazer a aprovação.
  if (corpo.restaurar === true) {
    const conflito = await conflitoAoRestaurarColeta(params.id);
    if (conflito) return NextResponse.json({ erro: conflito }, { status: 409 });
    const { data, error } = await admin.from("gp_coletas")
      .update({ excluido_em: null, excluido_por: null, aprovada_em: null, aprovada_por: null, atualizado_em: new Date().toISOString() })
      .eq("id", params.id).select("*").single();
    if (ehViolacaoUnica(error)) return NextResponse.json({ erro: "Já existe coleta ativa igual nesta OS." }, { status: 409 });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, coleta: data });
  }

  if (coleta.excluido_em) return NextResponse.json({ erro: "A coleta está na lixeira — restaure antes de editar." }, { status: 400 });
  const cx = await contextoColeta(coleta.inspecao_id);
  if (!cx) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });

  const tipo = (coleta.tipo === "anexo" ? "anexo" : "sedimento") as TipoColeta;
  const pdf = examinarPdf(corpo.arquivo);
  const p = corpo.presentes;
  const d: DadosColeta = {
    id: coleta.id,
    tipo,
    dataColeta: p.has("dataColeta") ? corpo.dataColeta : coleta.data_coleta,
    responsavelId: tipo === "sedimento" ? (p.has("responsavelId") ? corpo.responsavelId : coleta.responsavel_id) : null,
    descricao: tipo === "anexo" ? (p.has("descricao") ? corpo.descricao : coleta.descricao) : null,
    dados: tipo === "sedimento" ? (p.has("dados") ? corpo.dados : coleta.dados) : {},
    arquivoHash: pdf.hash,
    erroArquivo: pdf.erro,
  };
  const r = validarColetaServidor(d, cx.ctx);
  if (temErros(r.resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(r.resultado, ROTULOS_COLETA), erros: r.resultado.erros, avisos: r.resultado.avisos },
      { status: r.duplicada ? 409 : 400 }
    );
  }

  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { atualizado_em: agora, data_coleta: d.dataColeta };
  if (tipo === "sedimento") {
    const nomeResp = cx.usuarios.find((u) => u.id === d.responsavelId)?.nome || "";
    const dados = { ...(d.dados || {}), reportDate: d.dataColeta, reportResponsavel: nomeResp };
    patch.dados = dados;
    patch.responsavel_id = d.responsavelId;
    patch.dados_hash = hashMedicao(dados);
    // Mudou a medição de uma coleta aprovada: a aprovação não vale mais.
    if (coleta.aprovada_em && chaveMedicao(dados) !== chaveMedicao(coleta.dados)) {
      Object.assign(patch, { aprovada_em: null, aprovada_por: null, aprovacao_retirada_em: agora, aprovacao_retirada_por: profile.id });
    }
  } else {
    patch.descricao = normalizarEspacos(d.descricao);
  }

  // PDF novo: sobe num caminho novo e só troca o registro depois — a coleta
  // nunca aponta para um arquivo pela metade. O antigo sai no fim.
  let novoPath: string | null = null;
  if (corpo.arquivo) {
    novoPath = `coletas/${coleta.inspecao_id}/${coleta.id}-${Date.now()}.pdf`;
    try {
      await uploadArquivo(novoPath, corpo.arquivo.bytes, "application/pdf");
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o PDF." }, { status: 500 });
    }
    patch.pdf_path = novoPath;
    patch.arquivo_hash = pdf.hash;
  }

  const { data, error } = await getSupabaseRouteClient().from("gp_coletas").update(patch).eq("id", params.id).select("*").single();
  if (error) {
    if (novoPath) await removerArquivos([novoPath]);
    if (ehViolacaoUnica(error)) return NextResponse.json({ erro: "Já existe coleta igual nesta OS." }, { status: 409 });
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  if (novoPath && coleta.pdf_path && coleta.pdf_path !== novoPath) await removerArquivos([coleta.pdf_path]);
  return NextResponse.json({
    ok: true, coleta: data, avisos: r.resultado.avisos,
    aprovacaoRetirada: !!patch.aprovacao_retirada_em,
  });
}

/** Exclui a coleta. Padrão do sistema: vai para a lixeira (recuperável por
 * 30 dias) e PERDE a aprovação — restaurar não a devolve. Com ?definitivo=1,
 * apaga de vez. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_COLETA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta é responsabilidade de Operações." }, { status: 403 });
  }

  const travada = await garantirOsAberta(await osDe("gp_coletas", params.id));
  if (travada) return travada;

  const supabase = getSupabaseRouteClient();
  if (req.nextUrl.searchParams.get("definitivo") === "1") {
    const { error } = await supabase.from("gp_coletas").delete().eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, definitivo: true });
  }

  const { error } = await supabase
    .from("gp_coletas")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id, aprovada_em: null, aprovada_por: null })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}
