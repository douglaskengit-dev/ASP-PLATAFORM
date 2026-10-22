/** PDF do laudo do laboratório (Fase 8) — lado do navegador: confere o
 *  arquivo pelos bytes (PDF de verdade, até 30 MB, SHA-256 não repetido na
 *  OS) e o sobe direto ao storage com URL assinada, em
 *  relatorios/<OS>/laudo-<uuid>.pdf. A API confere tudo de novo no storage
 *  quando o rascunho é salvo (ou no envio de fora). */
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/sha256";
import { assinaturaArquivo, examinarArquivoRelatorio, RELATORIO_MAX_BYTES, type LaudoPdf } from "@/lib/validacao";

/** Arquivo já presente na OS (relatório, versão assinada, anexo de coleta). */
export interface ArquivoOS { hash: string; rotulo: string }

export async function examinarLaudoLocal(f: File, arquivosOS: ArquivoOS[]): Promise<{ erro: string | null; hash: string | null }> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (assinaturaArquivo(bytes) !== "pdf") {
    return { erro: `“${f.name}” não é um PDF de verdade (o conteúdo não confere). Envie o laudo do laboratório em PDF.`, hash: null };
  }
  const ex = await examinarArquivoRelatorio(bytes, { tamanho: f.size, max: RELATORIO_MAX_BYTES });
  if (ex.erro) return { erro: ex.erro, hash: null };
  const hash = await sha256Hex(bytes);
  const igual = arquivosOS.find((a) => a.hash === hash);
  if (igual) return { erro: `Este PDF é o mesmo arquivo que ${igual.rotulo} desta OS — escolha o laudo do laboratório.`, hash: null };
  return { erro: null, hash };
}

/** Sobe o laudo (já conferido) e devolve a referência para o snapshot. */
export async function enviarLaudoPdf(inspecaoId: string, f: File, hash: string): Promise<LaudoPdf> {
  const r = await fetch("/api/relatorios/upload-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inspecaoId, laudo: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.erro || "Falha ao preparar o envio do laudo.");
  const up = await getSupabaseBrowserClient().storage.from("gp-arquivos")
    .uploadToSignedUrl(d.caminho, d.token, f, { contentType: "application/pdf" });
  if (up.error) throw new Error(`Falha ao enviar o laudo: ${up.error.message}`);
  return { caminho: d.caminho, hash, nome: f.name, tamanho: f.size, enviado_em: new Date().toISOString() };
}

/** Hashes dos arquivos da OS que o laudo não pode repetir. */
export function arquivosDaOS(
  relatorios: { tipo: string; versao: number; arquivo_hash?: string | null; assinado_hash?: string | null }[],
  coletas: { tipo: string; arquivo_hash?: string | null }[],
): ArquivoOS[] {
  const out: ArquivoOS[] = [];
  for (const r of relatorios) {
    const tipo = r.tipo === "execucao" ? "execução" : "inspeção";
    if (r.arquivo_hash) out.push({ hash: r.arquivo_hash, rotulo: `o arquivo do relatório de ${tipo} v${r.versao}` });
    if (r.assinado_hash) out.push({ hash: r.assinado_hash, rotulo: `a versão assinada do relatório de ${tipo} v${r.versao}` });
  }
  for (const c of coletas) if (c.arquivo_hash) out.push({ hash: c.arquivo_hash, rotulo: c.tipo === "anexo" ? "um anexo das coletas" : "o PDF de uma medição" });
  return out;
}
