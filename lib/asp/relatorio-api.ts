/** Lado servidor da Fase 4 (relatório da OS): lê do banco o contexto que
 *  lib/validacao/relatorio.ts precisa e concentra o que /api/relatorios,
 *  /api/relatorios/[id], /upload-url e a lixeira repetem — versão calculada
 *  no insert (com nova tentativa na colisão), substituição da versão em
 *  aprovação, conferência do arquivo no storage e limpeza das fotos de
 *  rascunho. Lê com a chave de serviço. Não é rota: só funções. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/processos/arquivos";
import { ehUuid, sha256 } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import { podeEditarRevisao, type PerfilLike } from "@/lib/asp/permissoes";
import {
  addErro, caminhoFotoValido, codigoRelatorio, examinarArquivoRelatorio, FormatoRelatorio, hojeBrasil, mesclar,
  novoResultado, pastaFotosRascunho, planejarEnvio, RelatorioRef, ResultadoValidacao, revisaoDoTipo,
  SnapshotRelatorio, validarRelatorio,
} from "@/lib/validacao";

export const PERFIS_RELATORIO = ["admin", "operacoes", "gerencia"];

export interface InfoOSRelatorio {
  id: string;
  fase: number;
  /** Valores do cadastro que o relatório mostra (só leitura no formulário). */
  cadastro: { cliente: string; endereco: string; tag: string; procedimento: string; codigoProjeto: string };
}

/** OS (existe e não está na lixeira) + o que o relatório tira do cadastro. */
export async function infoOSRelatorio(inspecaoId: string): Promise<InfoOSRelatorio | null> {
  if (!ehUuid(inspecaoId)) return null;
  const { data } = await getSupabaseAdmin().from("gp_inspecoes")
    .select("id, fase, identificacao, procedimento, excluido_em, projeto:gp_projetos(codigo_projeto, pedido_compra, endereco, cliente:gp_orgaos(razao_social))")
    .eq("id", inspecaoId).maybeSingle();
  if (!data || (data as any).excluido_em) return null;
  const p: any = (data as any).projeto || {};
  return {
    id: data.id,
    fase: Number((data as any).fase) || 2,
    cadastro: {
      cliente: p.cliente?.razao_social || "",
      endereco: p.endereco || "",
      tag: (data as any).identificacao || "",
      procedimento: (data as any).procedimento || "",
      codigoProjeto: p.codigo_projeto || p.pedido_compra || "",
    },
  };
}

export interface LinhaRelatorio {
  id: string; inspecao_id: string; tipo: string; versao: number; status: string;
  arquivo_path: string | null; arquivo_hash: string | null; dados: SnapshotRelatorio | null;
}

/** Relatórios ativos (não excluídos) da OS. */
export async function relatoriosDaOS(inspecaoId: string): Promise<LinhaRelatorio[]> {
  const { data } = await getSupabaseAdmin().from("gp_relatorios")
    .select("id, inspecao_id, tipo, versao, status, arquivo_path, arquivo_hash, dados")
    .eq("inspecao_id", inspecaoId).is("excluido_em", null);
  return (data || []) as LinhaRelatorio[];
}

export function paraRelatorioRef(r: LinhaRelatorio): RelatorioRef {
  return { id: r.id, tipo: r.tipo, versao: r.versao, status: r.status, arquivoHash: r.arquivo_hash };
}

/** Lê o arquivo JÁ ENVIADO ao storage (o navegador sobe direto, com URL
 *  assinada) e confere pelos bytes: existe, formato real, tamanho e SHA-256.
 *  É a única forma de não confiar no que o navegador diz do arquivo — a
 *  função lê o objeto inteiro (até 30 MB, ou 150 MB no gerado). */
export async function examinarNoStorage(caminho: string, max: number): Promise<{
  erro: string | null; naoExiste?: boolean; formato: FormatoRelatorio | null; hash: string | null; tamanho: number;
}> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(caminho);
  if (error || !data) return { erro: "O arquivo não chegou ao storage. Envie de novo.", naoExiste: true, formato: null, hash: null, tamanho: 0 };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const { erro, formato } = await examinarArquivoRelatorio(bytes, { tamanho: bytes.length, max });
  return { erro, formato, hash: erro ? null : sha256(bytes), tamanho: bytes.length };
}

/** Caminho de upload aceito para o relatório desta OS. */
export function caminhoRelatorioValido(caminho: string, inspecaoId: string): boolean {
  return caminho.startsWith(`relatorios/${inspecaoId}/`) && !caminho.includes("..")
    && !caminho.startsWith(pastaFotosRascunho(inspecaoId)) && /\.(pdf|docx)$/i.test(caminho);
}

const violouVersao = (e: any) => ehViolacaoUnica(e) && /versao/i.test(e?.message || "");

/** Insere com a versão calculada AQUI (maior versão ativa do tipo + 1). Se
 *  outro envio pegou o mesmo número no meio do caminho, o índice único
 *  recusa e calcula de novo. */
export async function inserirComVersao(
  supabase: any, linha: Record<string, any> & { inspecao_id: string; tipo: string }
): Promise<{ data: any; error: any }> {
  let ultimo: any = null;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const rels = (await relatoriosDaOS(linha.inspecao_id)).map(paraRelatorioRef);
    const { versao } = planejarEnvio(rels, linha.tipo);
    const r = await supabase.from("gp_relatorios").insert({ ...linha, versao }).select("*").single();
    if (!r.error || !violouVersao(r.error)) return r;
    ultimo = r;
  }
  return ultimo;
}

/** Tira da fila da Gerência a(s) versão(ões) em aprovação do tipo (menos
 *  `exceto`): viram 'substituido'. Devolve os ids, para desfazer. */
export async function marcarSubstituidos(inspecaoId: string, tipo: string, novoId: string | null, exceto?: string): Promise<string[]> {
  const admin = getSupabaseAdmin();
  let q = admin.from("gp_relatorios").select("id")
    .eq("inspecao_id", inspecaoId).eq("tipo", tipo).eq("status", "em_aprovacao").is("excluido_em", null);
  if (exceto) q = q.neq("id", exceto);
  const { data } = await q;
  const ids = (data || []).map((r: any) => r.id);
  if (!ids.length) return [];
  await admin.from("gp_relatorios")
    .update({ status: "substituido", substituido_em: new Date().toISOString(), substituido_por: novoId, atualizado_em: new Date().toISOString() })
    .in("id", ids);
  return ids;
}

export async function apontarSubstituto(ids: string[], novoId: string): Promise<void> {
  if (ids.length) await getSupabaseAdmin().from("gp_relatorios").update({ substituido_por: novoId }).in("id", ids);
}

/** Desfaz marcarSubstituidos (o envio novo falhou). */
export async function desfazerSubstituicao(ids: string[]): Promise<void> {
  if (ids.length) {
    await getSupabaseAdmin().from("gp_relatorios")
      .update({ status: "em_aprovacao", substituido_em: null, substituido_por: null }).in("id", ids);
  }
}

/** Fotos de rascunho (rascunho-fotos/…) que um snapshot usa. */
export function fotosDeRascunho(s: SnapshotRelatorio | null | undefined, inspecaoId: string): string[] {
  const p = pastaFotosRascunho(inspecaoId);
  return (s?.fotos || []).map((f) => f.caminho || "").filter((c) => c.startsWith(p));
}

/** Apaga fotos de rascunho que nenhum rascunho ATIVO desta OS usa mais
 *  (melhor esforço: falha aqui não desfaz o envio/exclusão). */
export async function limparFotosRascunho(inspecaoId: string, candidatas: string[], ignorarId?: string): Promise<void> {
  if (!candidatas.length) return;
  try {
    const usadas = new Set<string>();
    for (const r of await relatoriosDaOS(inspecaoId)) {
      if (r.status !== "rascunho" || r.id === ignorarId) continue;
      fotosDeRascunho(r.dados, inspecaoId).forEach((c) => usadas.add(c));
    }
    const apagar = Array.from(new Set(candidatas)).filter((c) => !usadas.has(c));
    if (apagar.length) await getSupabaseAdmin().storage.from(BUCKET).remove(apagar);
  } catch { /* melhor esforço */ }
}

/** Valida no servidor o snapshot do formulário (relatório gerado): datas,
 *  revisão/código, cadastro, pessoas e fotos. `anterior` = o rascunho que
 *  está sendo atualizado (uma revisão digitada por quem pode continua valendo
 *  quando outro perfil salva de novo sem mexer nela). */
export async function validarSnapshotServidor(
  s: SnapshotRelatorio, opcoes: {
    info: InfoOSRelatorio; rels: RelatorioRef[]; tipo: string; profile: PerfilLike;
    anterior?: SnapshotRelatorio | null;
  }
): Promise<ResultadoValidacao> {
  const { info, rels, tipo, profile, anterior } = opcoes;
  const r = novoResultado();
  if (!s || typeof s !== "object" || !s.d || typeof s.d !== "object") {
    addErro(r, "dados", "Os dados do formulário chegaram em formato inválido.");
    return r;
  }
  const revisaoEsperada = revisaoDoTipo(rels, tipo);
  const manualAnterior = !!anterior?.revisaoManual
    && String(anterior.d?.revisao ?? "") === String(s.d.revisao ?? "")
    && (anterior.d?.relatorioCodigo || "") === (s.d.relatorioCodigo || "");
  let dataColeta: string | null = null;
  if (s.coletaId) {
    const { data: c } = ehUuid(s.coletaId)
      ? await getSupabaseAdmin().from("gp_coletas").select("data_coleta")
        .eq("id", s.coletaId).eq("inspecao_id", info.id).is("excluido_em", null).maybeSingle()
      : { data: null };
    if (!c) addErro(r, "coletaId", "A medição escolhida não existe mais nesta OS — reabra o formulário.");
    dataColeta = (c as any)?.data_coleta || null;
  }
  (s.fotos || []).forEach((f, i) => {
    if (!caminhoFotoValido(f?.caminho, info.id)) addErro(r, `fotos.${i}`, "Foto sem arquivo salvo nesta OS — gere o rascunho de novo.");
  });
  const v = validarRelatorio(s, {
    hoje: hojeBrasil(),
    dataColeta,
    revisaoEsperada,
    codigoEsperado: codigoRelatorio(info.cadastro.codigoProjeto, revisaoEsperada),
    podeEditarRevisao: podeEditarRevisao(profile) || manualAnterior,
    cadastro: info.cadastro,
  });
  return mesclar(r, v);
}

/** Restaurar um relatório da lixeira não pode criar ambiguidade: segundo
 *  rascunho do tipo, ou o mesmo arquivo de outro relatório ativo → erro.
 *  Versão já tomada por outro → volta com a próxima livre. */
export async function prepararRestauracaoRelatorio(id: string): Promise<{ erro?: string; versao?: number }> {
  const { data: rel } = await getSupabaseAdmin().from("gp_relatorios")
    .select("id, inspecao_id, tipo, versao, status, arquivo_hash").eq("id", id).maybeSingle();
  if (!rel) return {};
  if (!(await infoOSRelatorio(rel.inspecao_id))) return { erro: "A OS deste relatório está na lixeira (ou não existe). Restaure a OS antes." };
  const refs = (await relatoriosDaOS(rel.inspecao_id)).map(paraRelatorioRef).filter((r) => r.id !== id);
  const tipo = rel.tipo === "execucao" ? "execução" : "inspeção";
  if (rel.status === "rascunho" && refs.some((r) => r.tipo === rel.tipo && r.status === "rascunho")) {
    return { erro: `Já existe um rascunho do relatório de ${tipo} nesta OS. Exclua-o (ou envie-o) antes de restaurar este.` };
  }
  if (rel.arquivo_hash && refs.some((r) => r.arquivoHash === rel.arquivo_hash)) {
    return { erro: "Outro relatório ativo desta OS tem o mesmo arquivo. Restaurar criaria uma duplicata." };
  }
  if (refs.some((r) => r.tipo === rel.tipo && r.versao === rel.versao)) {
    return { versao: planejarEnvio(refs, rel.tipo).versao };
  }
  return {};
}
