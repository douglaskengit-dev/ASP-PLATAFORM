/** Lado servidor do Catálogo: leitura de todos os itens (ativos e
 *  desativados) para as checagens de repetido, uso de cada item (função
 *  gp_uso_catalogo), conferência dos arquivos já enviados ao storage (foto
 *  JPEG/PNG de verdade, modelo .docx de verdade) e remoção dos arquivos que
 *  nenhum item usa mais. Lê com a chave de serviço. Não é rota: só funções. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { BUCKET, removerArquivos } from "@/lib/processos/arquivos";
import { sha256 } from "@/lib/asp/coleta-api";
import {
  caminhoFotoCatalogoValido, caminhoModeloValido, examinarArquivoRelatorio, formatoImagem, FOTO_CATALOGO_MAX_BYTES,
  MODELO_MAX_BYTES, type EquipamentoRef, type ProcedimentoRef, type TipoCatalogo, type UsoCatalogo,
} from "@/lib/validacao";

export const PERFIS_EDICAO_CATALOGO = ["admin", "operacoes", "gerencia"];
export const TABELA_CATALOGO: Record<TipoCatalogo, string> = {
  equipamento: "gp_equipamentos",
  procedimento: "gp_procedimentos",
};

export function tipoCatalogo(t: unknown): TipoCatalogo | null {
  return t === "equipamento" || t === "procedimento" ? t : null;
}

const mb = (n: number) => (n / 1048576).toFixed(1).replace(".", ",");

/** Mensagem para quando a migração do Catálogo ainda não rodou. */
export const MSG_MIGRACAO_CATALOGO =
  "O banco ainda não tem as funções do Catálogo — rode a migração 20261031100000_asp_catalogo_validacao.sql (ou o verificacao-db-asp.sql).";

/** Erro de função/coluna inexistente (migração pendente). */
export function faltaMigracao(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "PGRST202" || e.code === "42883" || e.code === "42703" || /could not find the function/i.test(e.message || ""));
}

export async function equipamentosTodos(): Promise<(EquipamentoRef & Record<string, any>)[]> {
  const { data } = await getSupabaseAdmin().from("gp_equipamentos").select("*");
  return (data || []) as any[];
}

export async function procedimentosTodos(): Promise<(ProcedimentoRef & Record<string, any>)[]> {
  const { data } = await getSupabaseAdmin().from("gp_procedimentos").select("*");
  return (data || []) as any[];
}

/** Onde o item é usado (contagens). null = item não existe; `erro` quando
 *  a função não pôde ser chamada (ex.: migração pendente). */
export async function usoDoItem(tipo: TipoCatalogo, id: string): Promise<{ uso: UsoCatalogo | null; erro?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("gp_uso_catalogo", { p_tipo: tipo, p_id: id });
  if (error) return { uso: null, erro: faltaMigracao(error) ? MSG_MIGRACAO_CATALOGO : error.message };
  return { uso: (data as UsoCatalogo) || null };
}

/** Foto enviada (bytes): JPEG ou PNG de verdade, até 10 MB. WebP/GIF/HEIC
 *  são convertidos no navegador antes do envio. */
export function examinarFotoCatalogo(bytes: Uint8Array): { erro: string | null; formato: "png" | "jpeg" | null; hash: string | null } {
  if (!bytes.length) return { erro: "A imagem está vazia.", formato: null, hash: null };
  if (bytes.length > FOTO_CATALOGO_MAX_BYTES) {
    return { erro: `A imagem tem ${mb(bytes.length)} MB — o limite por foto é 10 MB.`, formato: null, hash: null };
  }
  const f = formatoImagem(bytes);
  if (f !== "png" && f !== "jpeg") {
    return { erro: "O arquivo não é uma imagem JPEG ou PNG (o conteúdo não confere). Envie JPEG ou PNG.", formato: null, hash: null };
  }
  return { erro: null, formato: f, hash: sha256(bytes) };
}

/** Modelo enviado (bytes): DOCX de verdade (ZIP + [Content_Types].xml do
 *  Word), até 20 MB. */
export async function examinarModeloDocx(bytes: Uint8Array): Promise<string | null> {
  const { erro, formato } = await examinarArquivoRelatorio(bytes, { tamanho: bytes.length, max: MODELO_MAX_BYTES });
  if (erro) {
    return /PDF/.test(erro) && !/limite/.test(erro)
      ? "O arquivo não é um documento do Word (.docx) válido. Salve de novo no Word como .docx e envie."
      : erro;
  }
  if (formato !== "docx") return "O modelo precisa ser um documento do Word (.docx), não PDF.";
  return null;
}

async function baixar(caminho: string): Promise<Uint8Array | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(caminho);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Confere uma foto que JÁ está no storage (o PATCH não confia no hash que
 *  o navegador mandou). */
export async function fotoNoStorage(caminho: string): Promise<{ erro: string | null; hash: string | null }> {
  if (!caminhoFotoCatalogoValido(caminho)) return { erro: "Caminho da foto inválido.", hash: null };
  const bytes = await baixar(caminho);
  if (!bytes) return { erro: "Uma das fotos não chegou ao storage — envie de novo.", hash: null };
  const ex = examinarFotoCatalogo(bytes);
  return { erro: ex.erro, hash: ex.hash };
}

/** Confere o modelo .docx que JÁ está no storage. */
export async function modeloNoStorage(caminho: string): Promise<string | null> {
  if (!caminhoModeloValido(caminho)) return "Caminho do modelo inválido — envie o .docx de novo.";
  const bytes = await baixar(caminho);
  if (!bytes) return "O modelo não está no storage — envie o .docx de novo.";
  return examinarModeloDocx(bytes);
}

/** Caminhos que algum item do Catálogo ainda usa (fotos e modelos). */
async function caminhosEmUso(): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  const [eq, pr] = await Promise.all([
    admin.from("gp_equipamentos").select("fotos"),
    admin.from("gp_procedimentos").select("template_path"),
  ]);
  if (eq.error || pr.error) throw new Error("Falha ao ler o Catálogo.");
  const s = new Set<string>();
  (eq.data || []).forEach((e: any) => (Array.isArray(e.fotos) ? e.fotos : []).forEach((f: any) => f?.caminho && s.add(f.caminho)));
  (pr.data || []).forEach((p: any) => p.template_path && s.add(p.template_path));
  return s;
}

/** Remove do storage os arquivos do Catálogo que nenhum item usa (melhor
 *  esforço: falha não interrompe quem chamou). Devolve os removidos. */
export async function removerSeSemUso(caminhos: (string | null | undefined)[]): Promise<string[]> {
  const candidatos = Array.from(new Set(caminhos.filter((c): c is string =>
    !!c && c.startsWith("catalogo/") && !c.includes(".."))));
  if (!candidatos.length) return [];
  try {
    const usados = await caminhosEmUso();
    const livres = candidatos.filter((c) => !usados.has(c));
    await removerArquivos(livres);
    return livres;
  } catch {
    return [];
  }
}
