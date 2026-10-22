/** Foto que entra no relatório (navegador): só PNG ou JPEG vão para o .docx.
 *  WebP, GIF e BMP são convertidos aqui (canvas → PNG, preserva
 *  transparência); HEIC (iPhone) só se o navegador conseguir abrir — senão,
 *  erro claro. Nada de dependência nova. Devolve o arquivo final e o SHA-256
 *  dele (é o hash que impede a mesma foto duas vezes e dá nome no storage). */
import { formatoImagem, FOTO_MAX_BYTES } from "@/lib/validacao";
import { sha256Hex } from "@/lib/sha256";

export interface ImagemPreparada {
  arquivo: File;
  extensao: "png" | "jpeg";
  hash: string;
  /** Foi convertida (ex.: "WebP → PNG"). */
  convertida?: string;
}

const mb = (n: number) => (n / 1048576).toFixed(1).replace(".", ",");

async function converter(blob: Blob, tipo: "image/png" | "image/jpeg"): Promise<Blob | null> {
  try {
    let fonte: CanvasImageSource & { width: number; height: number };
    if (typeof createImageBitmap === "function") {
      fonte = await createImageBitmap(blob);
    } else {
      const url = URL.createObjectURL(blob);
      try {
        fonte = await new Promise<HTMLImageElement>((ok, falha) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = () => falha(new Error("decodificação"));
          img.src = url;
        });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
    if (!fonte.width || !fonte.height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = fonte.width;
    canvas.height = fonte.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    if (tipo === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(fonte, 0, 0);
    return await new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, 0.9));
  } catch {
    return null;
  }
}

export async function prepararImagemRelatorio(original: Blob, nome: string): Promise<ImagemPreparada | { erro: string }> {
  if (original.size > FOTO_MAX_BYTES) {
    return { erro: `“${nome}” tem ${mb(original.size)} MB — o limite por foto é 10 MB. Reduza a resolução e envie de novo.` };
  }
  if (original.size === 0) return { erro: `“${nome}” está vazio.` };
  const bytes = new Uint8Array(await original.arrayBuffer());
  const fmt = formatoImagem(bytes);
  const base = nome.replace(/\.[^.]+$/, "") || "foto";
  if (fmt === "png" || fmt === "jpeg") {
    const arquivo = original instanceof File && original.name === nome
      ? original : new File([bytes], nome, { type: `image/${fmt}` });
    return { arquivo, extensao: fmt, hash: await sha256Hex(bytes) };
  }
  if (fmt === "webp" || fmt === "gif" || fmt === "bmp" || fmt === "heic") {
    const destino = fmt === "heic" ? "image/jpeg" : "image/png";
    const conv = await converter(new Blob([bytes], { type: fmt === "heic" ? "image/heic" : `image/${fmt}` }), destino);
    if (!conv) {
      return {
        erro: fmt === "heic"
          ? `“${nome}” é HEIC (foto do iPhone) e este navegador não consegue abri-la. Exporte como JPEG (no iPhone: Ajustes → Câmera → Formatos → “Mais Compatível”) e envie de novo.`
          : `Não foi possível converter “${nome}” (${fmt.toUpperCase()}) para PNG. Salve como PNG ou JPEG e envie de novo.`,
      };
    }
    const ext = destino === "image/png" ? "png" : "jpeg";
    const final = new Uint8Array(await conv.arrayBuffer());
    if (final.length > FOTO_MAX_BYTES) {
      return { erro: `“${nome}” convertida ficou com ${mb(final.length)} MB — o limite por foto é 10 MB. Reduza a resolução.` };
    }
    return {
      arquivo: new File([final], `${base}.${ext === "png" ? "png" : "jpg"}`, { type: destino }),
      extensao: ext, hash: await sha256Hex(final), convertida: `${fmt.toUpperCase()} → ${ext.toUpperCase()}`,
    };
  }
  return { erro: `“${nome}” não é uma imagem reconhecida. Envie PNG ou JPEG (WebP, GIF e HEIC são convertidos quando possível).` };
}
