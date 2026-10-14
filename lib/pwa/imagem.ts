/** Compressão de foto no navegador, antes do envio.
 *
 * Foto de celular sai com 3–8 MB. Reduzida para ~1600 px no lado maior em
 * JPEG 0,8 fica com 200–500 KB e continua nítida no relatório (15 cm de
 * largura). Importa em dobro offline: a fila do IndexedDB guarda o arquivo em
 * base64 até a rede voltar, e dez fotos cruas estourariam a cota do aparelho.
 *
 * Qualquer falha (formato que o canvas não lê, navegador antigo) devolve o
 * arquivo original — comprimir é otimização, nunca motivo para perder a foto. */

async function decodificar(f: File): Promise<{ fonte: CanvasImageSource; largura: number; altura: number; liberar: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" aplica a rotação EXIF — foto de celular em pé não deita.
      const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
      return { fonte: bmp, largura: bmp.width, altura: bmp.height, liberar: () => bmp.close() };
    } catch { /* cai para o <img> */ }
  }
  const url = URL.createObjectURL(f);
  const img = new Image();
  await new Promise<void>((ok, falha) => {
    img.onload = () => ok();
    img.onerror = () => falha(new Error("imagem ilegível"));
    img.src = url;
  });
  return { fonte: img, largura: img.naturalWidth, altura: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
}

export async function comprimirImagem(f: File, ladoMax = 1600, qualidade = 0.8): Promise<File> {
  if (typeof document === "undefined" || !f.type.startsWith("image/")) return f;
  try {
    const { fonte, largura, altura, liberar } = await decodificar(f);
    const escala = Math.min(1, ladoMax / Math.max(largura, altura));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(largura * escala));
    canvas.height = Math.max(1, Math.round(altura * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) { liberar(); return f; }
    // fundo branco: PNG com transparência viraria preto no JPEG
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
    liberar();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
    if (!blob) return f;
    // já era pequena e não precisou reduzir: fica a original
    if (escala === 1 && blob.size >= f.size && /jpe?g$/i.test(f.type)) return f;
    const nome = (f.name.replace(/\.[^.]+$/, "") || "foto") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg" });
  } catch {
    return f;
  }
}
