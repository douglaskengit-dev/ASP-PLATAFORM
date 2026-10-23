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
import { cloroDoProcedimento } from "@/lib/asp/fotos-execucao";
import {
  addErro, caminhoFotoValido, caminhoLaudoValido, codigoRelatorio, examinarArquivoRelatorio, FormatoRelatorio, hojeBrasil,
  LaudoPdf, mesclar, MSG_LAUDO_OBRIGATORIO, novoResultado, pastaFotosRascunho, planejarEnvio, procedimentoUsaLaudo,
  RELATORIO_MAX_BYTES, RelatorioRef, ResultadoValidacao, revisaoDoTipo, SnapshotRelatorio, validarRelatorio,
  validarRelatorioExecucao,
} from "@/lib/validacao";

export const PERFIS_RELATORIO = ["admin", "operacoes", "gerencia"];

export interface InfoOSRelatorio {
  id: string;
  fase: number;
  /** false = OS sem inspeção (recusa relatório de inspeção). */
  comInspecao: boolean;
  /** Valores do cadastro que o relatório mostra (só leitura no formulário). */
  cadastro: { cliente: string; endereco: string; tag: string; procedimento: string; codigoProjeto: string };
}

/** OS (existe e não está na lixeira) + o que o relatório tira do cadastro. */
export async function infoOSRelatorio(inspecaoId: string): Promise<InfoOSRelatorio | null> {
  if (!ehUuid(inspecaoId)) return null;
  const { data } = await getSupabaseAdmin().from("gp_inspecoes")
    // "*": com_inspecao sem quebrar antes da migração.
    .select("*, projeto:gp_projetos(codigo_projeto, pedido_compra, endereco, cliente:gp_orgaos(razao_social))")
    .eq("id", inspecaoId).maybeSingle();
  if (!data || (data as any).excluido_em) return null;
  const p: any = (data as any).projeto || {};
  return {
    id: data.id,
    fase: Number((data as any).fase) || 2,
    comInspecao: (data as any).com_inspecao !== false,
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
  assinado_hash?: string | null;
}

/** Relatórios ativos (não excluídos) da OS. */
export async function relatoriosDaOS(inspecaoId: string): Promise<LinhaRelatorio[]> {
  const { data } = await getSupabaseAdmin().from("gp_relatorios")
    .select("id, inspecao_id, tipo, versao, status, arquivo_path, arquivo_hash, assinado_hash, dados")
    .eq("inspecao_id", inspecaoId).is("excluido_em", null);
  return (data || []) as LinhaRelatorio[];
}

export function paraRelatorioRef(r: LinhaRelatorio): RelatorioRef {
  return { id: r.id, tipo: r.tipo, versao: r.versao, status: r.status, arquivoHash: r.arquivo_hash, assinadoHash: r.assinado_hash || null };
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
    && !caminho.startsWith(pastaFotosRascunho(inspecaoId)) && !caminho.startsWith(`relatorios/${inspecaoId}/laudo-`)
    && /\.(pdf|docx)$/i.test(caminho);
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

// ── Fase 8: relatório de execução ─────────────────────────────────────────────

/** Linha do procedimento da OS no Catálogo (todas as colunas: as da Fase 7/8
 *  podem não existir num banco sem a migration — aí valem os padrões). */
export async function procedimentoDaOS(codigo: string): Promise<Record<string, any> | null> {
  if (!codigo) return null;
  const { data } = await getSupabaseAdmin().from("gp_procedimentos").select("*").eq("codigo", codigo).limit(1).maybeSingle();
  return (data as any) || null;
}

/** O relatório de execução desta OS exige o PDF do laudo? */
export async function execucaoExigeLaudo(info: InfoOSRelatorio, tipo: string): Promise<boolean> {
  return tipo === "execucao" && procedimentoUsaLaudo(await procedimentoDaOS(info.cadastro.procedimento));
}

/** Arquivos desta OS que o laudo não pode repetir (SHA-256): relatórios
 *  enviados, versões assinadas e PDFs anexados nas coletas. */
async function arquivosDaOS(inspecaoId: string, rels: RelatorioRef[]): Promise<{ hash: string; rotulo: string }[]> {
  const out: { hash: string; rotulo: string }[] = [];
  for (const r of rels) {
    const tipo = r.tipo === "execucao" ? "execução" : "inspeção";
    if (r.arquivoHash) out.push({ hash: r.arquivoHash, rotulo: `o arquivo do relatório de ${tipo} v${r.versao}` });
    if (r.assinadoHash) out.push({ hash: r.assinadoHash, rotulo: `a versão assinada do relatório de ${tipo} v${r.versao}` });
  }
  const { data } = await getSupabaseAdmin().from("gp_coletas").select("arquivo_hash, tipo")
    .eq("inspecao_id", inspecaoId).is("excluido_em", null).not("arquivo_hash", "is", null);
  for (const c of (data || []) as any[]) out.push({ hash: c.arquivo_hash, rotulo: c.tipo === "anexo" ? "um anexo das coletas" : "o PDF de uma medição" });
  return out;
}

/** Confere o PDF do laudo NO STORAGE (como o arquivo do relatório): caminho
 *  desta OS, existe, é PDF de verdade, até 30 MB, o SHA-256 bate com o
 *  informado e não repete outro arquivo da OS. Devolve o laudo com hash,
 *  tamanho e autoria conferidos. */
export async function verificarLaudoPdf(
  laudo: LaudoPdf | null | undefined, opcoes: { inspecaoId: string; rels: RelatorioRef[]; profileId: string | null; anterior?: LaudoPdf | null }
): Promise<{ erro: string | null; laudo: LaudoPdf | null }> {
  if (!laudo || typeof laudo !== "object" || !laudo.caminho) return { erro: null, laudo: null };
  if (!caminhoLaudoValido(laudo.caminho, opcoes.inspecaoId)) return { erro: "PDF do laudo com caminho inválido para esta OS — anexe de novo.", laudo: null };
  const ex = await examinarNoStorage(laudo.caminho, RELATORIO_MAX_BYTES);
  if (ex.erro) return { erro: ex.naoExiste ? "O PDF do laudo não está no storage — anexe de novo." : `PDF do laudo: ${ex.erro}`, laudo: null };
  if (ex.formato !== "pdf") return { erro: "O laudo tem de ser um PDF (o arquivo enviado não é).", laudo: null };
  if (laudo.hash && laudo.hash.toLowerCase() !== ex.hash) return { erro: "O PDF do laudo no storage não confere com o anexado — anexe de novo.", laudo: null };
  const igual = (await arquivosDaOS(opcoes.inspecaoId, opcoes.rels)).find((a) => a.hash === ex.hash);
  if (igual) return { erro: `O PDF do laudo é o mesmo arquivo que ${igual.rotulo} desta OS.`, laudo: null };
  const mesmo = opcoes.anterior?.caminho === laudo.caminho ? opcoes.anterior : null;
  return {
    erro: null,
    laudo: {
      caminho: laudo.caminho, hash: ex.hash as string, tamanho: ex.tamanho,
      nome: String(laudo.nome || "laudo.pdf").slice(0, 200),
      enviado_em: mesmo?.enviado_em || new Date().toISOString(),
      enviado_por: mesmo?.enviado_por || opcoes.profileId,
    },
  };
}

/** Apaga um PDF de laudo trocado no rascunho, se nenhum relatório ATIVO da
 *  OS (rascunho, enviado ou de fora) ainda o usa. Melhor esforço. */
export async function limparLaudoAntigo(inspecaoId: string, caminho: string): Promise<void> {
  if (!caminhoLaudoValido(caminho, inspecaoId)) return;
  try {
    const usado = (await relatoriosDaOS(inspecaoId)).some((r) => (r.dados as any)?.laudoPdf?.caminho === caminho);
    if (!usado) await getSupabaseAdmin().storage.from(BUCKET).remove([caminho]);
  } catch { /* melhor esforço */ }
}

/** Hash (do original) de cada foto da coleta de fotos da execução da OS,
 *  por caminho — a API não confia no hash que o navegador mandou. */
async function hashesColetaFotos(inspecaoId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const { data } = await getSupabaseAdmin().from("gp_fotos_execucao").select("itens").eq("inspecao_id", inspecaoId).maybeSingle();
  for (const v of Object.values(((data as any)?.itens || {}) as Record<string, any>)) {
    for (const f of Array.isArray(v) ? v : [v]) if (f?.caminho && f?.hash) m.set(f.caminho, f.hash);
  }
  return m;
}

/** Valida no servidor o snapshot do formulário (relatório gerado): datas,
 *  revisão/código, cadastro, pessoas e fotos. `anterior` = o rascunho que
 *  está sendo atualizado (uma revisão digitada por quem pode continua valendo
 *  quando outro perfil salva de novo sem mexer nela). */
export async function validarSnapshotServidor(
  s: SnapshotRelatorio, opcoes: {
    info: InfoOSRelatorio; rels: RelatorioRef[]; tipo: string; profile: PerfilLike & { id?: string | null };
    anterior?: SnapshotRelatorio | null;
    /** Envio para aprovação (Fase 8: sem o PDF do laudo é ⛔). */
    enviar?: boolean;
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
  // Fase 8 — relatório de execução: pH/cloro, laudo, PDF do laudo e as fotos
  // da coleta (o hash do original vem do banco, não do navegador).
  let rExec = novoResultado();
  if (tipo === "execucao") {
    const hashes = await hashesColetaFotos(info.id);
    (s.fotos || []).forEach((f) => {
      if (f && f.caminho?.startsWith(`fotos-execucao/${info.id}/`)) f.hashColeta = hashes.get(f.caminho) || undefined;
    });
    const proc = await procedimentoDaOS(info.cadastro.procedimento);
    const cloro = cloroDoProcedimento(proc);
    if (s.laudoPdf) {
      const lv = await verificarLaudoPdf(s.laudoPdf, { inspecaoId: info.id, rels, profileId: profile.id || null, anterior: anterior?.laudoPdf });
      if (lv.erro) addErro(r, "laudoPdf", lv.erro);
      else s.laudoPdf = lv.laudo;
    }
    rExec = validarRelatorioExecucao(s, {
      inspecaoId: info.id, hoje: hojeBrasil(), unidadeCloro: cloro.unidade, limiteCloro: cloro.limite,
      usaLaudo: procedimentoUsaLaudo(proc), exigirLaudoPdf: !!opcoes.enviar,
    });
  } else if (s.laudoPdf) {
    s.laudoPdf = null;   // laudo é só do relatório de execução
  }
  const v = validarRelatorio(s, {
    hoje: hojeBrasil(),
    dataColeta,
    revisaoEsperada,
    codigoEsperado: codigoRelatorio(info.cadastro.codigoProjeto, revisaoEsperada),
    podeEditarRevisao: podeEditarRevisao(profile) || manualAnterior,
    cadastro: info.cadastro,
  });
  return mesclar(r, v, rExec);
}

export { MSG_LAUDO_OBRIGATORIO };

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
