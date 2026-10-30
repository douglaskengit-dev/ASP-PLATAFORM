/**
 * OCR do laudo em PDF de imagem, no próprio servidor (sem IA, sem serviço
 * externo): a 1ª página é renderizada (pdf-parse) e lida pelo Tesseract com
 * o idioma português que vem no pacote @tesseract.js-data/por — nada é
 * baixado em tempo de execução. A leitura da tabela é por posição
 * (lerLaudoDePalavras), pelo layout do Relatório de Ensaio padrão.
 */
import path from "path";
import { renderizarPaginaPdf } from "@/lib/pdfExtract";
import { lerLaudoDePalavras, type PalavraOcr } from "./laudo-ocr";
import type { LaudoLido } from "./laudo-leitura";

/** Largura da página renderizada: ~300 dpi numa A4, boa para o OCR. */
const LARGURA_OCR = 2480;

export async function lerLaudoPorOcr(pdf: Buffer): Promise<LaudoLido> {
  const png = await renderizarPaginaPdf(pdf, 1, LARGURA_OCR);
  const { createWorker } = await import("tesseract.js");
  const langPath = path.join(process.cwd(), "node_modules", "@tesseract.js-data", "por", "4.0.0_best_int");
  const worker = await createWorker("por", 1, { langPath, cacheMethod: "none", gzip: true });
  try {
    const r = await worker.recognize(png, {}, { blocks: true, text: true });
    const palavras: PalavraOcr[] = [];
    for (const b of r.data.blocks || []) for (const pa of b.paragraphs) for (const l of pa.lines) for (const w of l.words) {
      palavras.push({ t: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, c: w.confidence });
    }
    return lerLaudoDePalavras(palavras, r.data.text || "");
  } finally {
    await worker.terminate();
  }
}
