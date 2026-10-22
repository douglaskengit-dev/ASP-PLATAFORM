import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { removerArquivos } from "@/lib/processos/arquivos";
import { ehUuid } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import { examinarNoStorage, infoOSRelatorio, paraRelatorioRef, relatoriosDaOS } from "@/lib/asp/relatorio-api";
import {
  caminhoAssinadoValido, descreverRelatorio, erroEnvioAssinado, RELATORIO_MAX_BYTES, ROTULO_TIPO, type TipoRelatorio,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Registra a VERSÃO ASSINADA de um relatório aprovado (Fase 5/9 em diante).
 *  O navegador já subiu o PDF (URL assinada de /api/relatorios/upload-url
 *  com { assinado }); aqui ele é conferido no storage, pelos bytes:
 *
 *   ⛔ PDF de verdade, até 30 MB, caminho desta OS/tipo
 *   ⛔ o mesmo arquivo (SHA-256) já está na OS — inclusive o próprio arquivo
 *      enviado para aprovação (sem assinatura)
 *   ⛔ só relatório 'aprovado' (status muda para 'assinado' com
 *      `where status = 'aprovado'`); trocar a assinada: Gerência/Admin
 *   · Idempotente: o mesmo caminho (ou a mesma Idempotency-Key) devolve o
 *     registro já feito. A assinada anterior (troca) sai do storage.
 *   · Histórico: ação 'assinar'. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!ehUuid(params.id)) return NextResponse.json({ erro: "Relatório inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const caminho = String(body?.caminho || "");
  const substituir = !!body?.substituir;
  const chave = req.headers.get("idempotency-key");
  const chaveValida = chave && ehUuid(chave) ? chave : null;
  const admin = getSupabaseAdmin();

  const { data: relRaw } = await admin.from("gp_relatorios").select("*").eq("id", params.id).maybeSingle();
  const rel: any = relRaw;
  if (!rel || rel.excluido_em) return NextResponse.json({ erro: "Relatório não encontrado." }, { status: 404 });

  // Reenvio (duplo clique, fila): já registrado.
  if (rel.assinado_path && rel.assinado_path === caminho) return NextResponse.json({ ok: true, relatorio: rel, repetido: true });
  if (chaveValida) {
    const { data: feito } = await admin.from("gp_fase_historico").select("id").eq("chave_idempotencia", chaveValida).maybeSingle();
    if (feito) return NextResponse.json({ ok: true, relatorio: rel, repetido: true });
  }

  const info = await infoOSRelatorio(rel.inspecao_id);
  if (!info) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });
  const caminhoOk = caminhoAssinadoValido(caminho, info.id, rel.tipo);
  const descartar = async () => { if (caminhoOk) await removerArquivos([caminho]).catch(() => {}); };

  const erroPerm = erroEnvioAssinado({ perfil: profile.perfil, status: rel.status, tipo: rel.tipo, fase: info.fase, substituir });
  if (erroPerm) { await descartar(); return NextResponse.json({ erro: erroPerm }, { status: 403 }); }
  if (!caminhoOk) return NextResponse.json({ erro: "Caminho do arquivo inválido para este relatório." }, { status: 400 });

  const ex = await examinarNoStorage(caminho, RELATORIO_MAX_BYTES);
  if (ex.erro) {
    if (!ex.naoExiste) await descartar();
    return NextResponse.json({ erro: ex.erro, erros: { arquivo: [ex.erro] } }, { status: 400 });
  }
  if (ex.formato !== "pdf") {
    await descartar();
    const e = "A versão assinada tem de ser PDF (o arquivo enviado é um DOCX). Exporte/imprima em PDF depois de assinar.";
    return NextResponse.json({ erro: e, erros: { arquivo: [e] } }, { status: 400 });
  }

  // Mesmo arquivo já na OS (o enviado de qualquer versão ou outra assinada).
  const refs = (await relatoriosDaOS(info.id)).map(paraRelatorioRef);
  const igual = refs.find((r) => r.arquivoHash === ex.hash || r.assinadoHash === ex.hash);
  if (igual) {
    await descartar();
    const e = igual.id === rel.id && igual.arquivoHash === ex.hash
      ? "É o mesmo arquivo da versão enviada para aprovação, sem assinatura. Envie o documento assinado."
      : igual.id === rel.id
        ? "Esta mesma versão assinada já foi enviada."
        : `Este mesmo arquivo já está nesta OS (${descreverRelatorio(igual)}).`;
    return NextResponse.json({ erro: e, erros: { arquivo: [e] } }, { status: 409 });
  }

  const agora = new Date().toISOString();
  let q = admin.from("gp_relatorios")
    .update({ status: "assinado", assinado_path: caminho, assinado_hash: ex.hash, assinado_por: profile.id, assinado_em: agora, atualizado_em: agora })
    .eq("id", rel.id).eq("status", rel.status);
  q = rel.assinado_hash ? q.eq("assinado_hash", rel.assinado_hash) : q.is("assinado_hash", null);
  const { data, error } = await q.select("*").maybeSingle();
  if (error || !data) {
    await descartar();
    if (error && ehViolacaoUnica(error)) return NextResponse.json({ erro: "Este mesmo arquivo acabou de ser enviado nesta OS." }, { status: 409 });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ erro: "O relatório mudou enquanto enviava (outra versão assinada acabou de entrar?). Recarregue a página." }, { status: 409 });
  }

  const trocou = rel.status === "assinado" && rel.assinado_path;
  if (trocou) await removerArquivos([rel.assinado_path]).catch(() => {});
  const colStatus = rel.tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
  await admin.from("gp_inspecoes").update({ [colStatus]: "assinado" }).eq("id", info.id);
  const rotulo = `relatório de ${ROTULO_TIPO[rel.tipo as TipoRelatorio] || rel.tipo} v${rel.versao}`;
  await admin.from("gp_fase_historico").insert({
    inspecao_id: info.id, fase_de: info.fase, fase_para: info.fase, acao: "assinar",
    motivo: trocou ? `Trocou a versão assinada do ${rotulo} (a anterior foi apagada).` : `Versão assinada do ${rotulo}.`,
    relatorio_id: rel.id, autor: profile.id, chave_idempotencia: chaveValida,
  });
  return NextResponse.json({ ok: true, relatorio: data, trocou: !!trocou });
}
