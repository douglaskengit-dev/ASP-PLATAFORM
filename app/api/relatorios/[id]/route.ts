import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  desfazerSubstituicao, fotosDeRascunho, infoOSRelatorio, limparFotosRascunho, marcarSubstituidos, paraRelatorioRef,
  PERFIS_RELATORIO, relatoriosDaOS, validarSnapshotServidor,
} from "@/lib/asp/relatorio-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import {
  erroTipoNaFase, MSG_LAUDO_DEPOIS_OBRIGATORIO, MSG_LAUDO_OBRIGATORIO, planejarEnvio, primeiroErro, ROTULOS_RELATORIO, ROTULOS_RELATORIO_EXECUCAO, temErros,
} from "@/lib/validacao";

import { garantirOsAberta } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** Envia um relatório em rascunho para aprovação: PATCH { enviar: true }.
 *  Separa a geração do documento (que só anexa o arquivo ao card) do ato de
 *  submetê-lo à Gerência, que é o que move a inspeção de fase.
 *
 *  O rascunho é conferido de novo (tipo x fase, revisão, cadastro, medição):
 *  algo pode ter mudado desde que foi gerado. Fica com a versão dele se ela
 *  ainda for a maior do tipo; senão vai para o fim. A versão que estava em
 *  aprovação vira 'substituido'. As fotos do rascunho saem do storage. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_RELATORIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Envio de relatório é responsabilidade de Operações." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body?.enviar) return NextResponse.json({ ok: true });

  const admin = getSupabaseAdmin();
  const { data: rel } = await admin
    .from("gp_relatorios").select("id, tipo, status, versao, inspecao_id, arquivo_path, dados, excluido_em")
    .eq("id", params.id).maybeSingle();
  if (!rel || rel.excluido_em) return NextResponse.json({ erro: "Relatório não encontrado." }, { status: 404 });
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(rel.inspecao_id);
  if (travada) return travada;
  if (rel.status === "em_aprovacao") return NextResponse.json({ ok: true, repetido: true });
  if (rel.status !== "rascunho") {
    return NextResponse.json({ erro: "Só rascunhos podem ser enviados para aprovação." }, { status: 400 });
  }
  if (!rel.arquivo_path) return NextResponse.json({ erro: "Rascunho sem arquivo — gere de novo." }, { status: 400 });

  const info = await infoOSRelatorio(rel.inspecao_id);
  if (!info) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });
  const erroTipo = erroTipoNaFase(rel.tipo, info.fase, info.comInspecao);
  if (erroTipo) return NextResponse.json({ erro: erroTipo }, { status: 400 });

  if (rel.dados) {
    const refs = (await relatoriosDaOS(rel.inspecao_id)).map(paraRelatorioRef);
    const r = await validarSnapshotServidor(rel.dados, { info, rels: refs, tipo: rel.tipo, profile, anterior: rel.dados, enviar: true });
    if (temErros(r)) {
      // Fase 8: sem o PDF do laudo, a mensagem diz o que fazer.
      const semLaudo = (r.erros.laudoPdf || []).includes(MSG_LAUDO_OBRIGATORIO)
        ? MSG_LAUDO_OBRIGATORIO
        : (r.erros.laudoPdfDepois || []).includes(MSG_LAUDO_DEPOIS_OBRIGATORIO) ? MSG_LAUDO_DEPOIS_OBRIGATORIO : null;
      return NextResponse.json({
        erro: semLaudo
          ? `${semLaudo} Clique em Editar, anexe o PDF no bloco do laudo e salve o rascunho de novo.`
          : `O rascunho está desatualizado — clique em Editar, confira e salve de novo. (${primeiroErro(r, { ...ROTULOS_RELATORIO, ...ROTULOS_RELATORIO_EXECUCAO })})`,
        erros: r.erros,
      }, { status: 400 });
    }
  }

  const supabase = getSupabaseRouteClient();
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const refs = (await relatoriosDaOS(rel.inspecao_id)).map(paraRelatorioRef);
    const { versao } = planejarEnvio(refs, rel.tipo, rel.id);
    const substituidos = await marcarSubstituidos(rel.inspecao_id, rel.tipo, rel.id, rel.id);
    const { data, error } = await supabase
      .from("gp_relatorios")
      .update({ status: "em_aprovacao", versao, enviado_em: new Date().toISOString(), enviado_por: profile.id, atualizado_em: new Date().toISOString() })
      .eq("id", params.id).eq("status", "rascunho").select("*").maybeSingle();
    if (error || !data) {
      await desfazerSubstituicao(substituidos);
      if (error && ehViolacaoUnica(error) && /versao/i.test(error.message || "")) continue;
      if (!error) return NextResponse.json({ erro: "O rascunho mudou enquanto enviava. Recarregue a página." }, { status: 409 });
      if (ehViolacaoUnica(error)) return NextResponse.json({ erro: "Outro envio deste relatório acabou de entrar. Recarregue a página." }, { status: 409 });
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }
    const colStatus = rel.tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
    await supabase.from("gp_inspecoes").update({ [colStatus]: "em_aprovacao" }).eq("id", rel.inspecao_id);
    await limparFotosRascunho(rel.inspecao_id, fotosDeRascunho(rel.dados, rel.inspecao_id), rel.id);
    return NextResponse.json({ ok: true, relatorio: data, substituidos });
  }
  return NextResponse.json({ erro: "Não foi possível reservar a versão. Tente de novo." }, { status: 409 });
}

/** Exclui um relatório em RASCUNHO (vai para a lixeira). Só rascunhos: uma
 *  versão já enviada faz parte do histórico de aprovação e não se apaga. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_RELATORIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Ação restrita a Operações." }, { status: 403 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: rel } = await supabase
    .from("gp_relatorios").select("id, status, arquivo_path, inspecao_id, dados").eq("id", params.id).single();
  if (!rel) return NextResponse.json({ erro: "Relatório não encontrado." }, { status: 404 });
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(rel.inspecao_id);
  if (travada) return travada;
  if (rel.status !== "rascunho") {
    return NextResponse.json({ erro: "Só rascunhos podem ser excluídos." }, { status: 400 });
  }

  // Vai para a lixeira (recuperável por 30 dias) em vez de sumir na hora —
  // o arquivo do relatório só é apagado na exclusão definitiva. As fotos
  // soltas do rascunho saem já (o .docx gerado continua com elas).
  const { error } = await supabase.from("gp_relatorios")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  await limparFotosRascunho(rel.inspecao_id, fotosDeRascunho(rel.dados, rel.inspecao_id), rel.id);
  return NextResponse.json({ ok: true, lixeira: true });
}
