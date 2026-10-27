/**
 * Cópia no aparelho das fotos tiradas pela câmera do app (coleta de fotos da
 * execução). A foto tirada pelo navegador não vai sozinha para a galeria —
 * fica só com o app —, então guardamos o ORIGINAL (qualidade e EXIF da
 * câmera) também no celular:
 *
 *   Android / demais  download automático → pasta Downloads (aparece na
 *                     galeria, em "Download").
 *   iPhone / iPad     o Safari não deixa um site gravar na galeria nem baixar
 *                     sem um toque: a foto fica guardada na tela e o botão
 *                     "Salvar no aparelho" abre o menu de compartilhar, onde
 *                     se escolhe "Salvar Imagem".
 *
 * A preferência é por aparelho (localStorage), ligada por padrão. Só vale em
 * tela de toque — no computador o botão da câmera abre o seletor de arquivos
 * e a foto já está no disco.
 */

const CHAVE = "asp:copiaFotosAparelho";

/** Ligada por padrão; só "0" desliga. Storage indisponível = ligada. */
export function lerPreferenciaCopia(): boolean {
  try { return localStorage.getItem(CHAVE) !== "0"; } catch { return true; }
}

export function gravarPreferenciaCopia(ligada: boolean) {
  try { localStorage.setItem(CHAVE, ligada ? "1" : "0"); } catch { /* aba privada: vale só nesta sessão */ }
}

/** iPhone/iPad (inclui iPad que se apresenta como Mac). */
export function ehIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

/** Tela de toque (celular/tablet): onde a câmera do app tira a foto. */
export function ehAparelhoDeToque(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

const limpar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "foto";

/** "TQ-01_agua-antes-ph_2026-10-27_14-32-05.jpg" (+ "_2" quando vêm várias). */
export function nomeCopia(identificacao: string | undefined, slotId: string, arquivo: File, indice = 0, quando = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const data = `${quando.getFullYear()}-${p(quando.getMonth() + 1)}-${p(quando.getDate())}_` +
    `${p(quando.getHours())}-${p(quando.getMinutes())}-${p(quando.getSeconds())}`;
  const ext = (/\.([A-Za-z0-9]{2,5})$/.exec(arquivo.name || "")?.[1]
    || (arquivo.type.split("/")[1] || "jpg")).toLowerCase().replace("jpeg", "jpg");
  return `${limpar(identificacao || "OS")}_${limpar(slotId.replace(/_/g, "-"))}_${data}${indice ? `_${indice + 1}` : ""}.${ext}`;
}

/** Baixa o arquivo com o nome dado (Android: vai para Downloads). */
export function baixarCopia(arquivo: File, nome: string) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // dá tempo do navegador começar o download antes de soltar o blob
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Abre o menu de compartilhar com as fotos (iPhone: "Salvar Imagem").
 * Precisa ser chamado direto de um toque. "ok" = compartilhou; "cancelado" =
 * a pessoa fechou o menu; "baixado" = sem Web Share de arquivos, baixou.
 */
export async function compartilharCopias(itens: { arquivo: File; nome: string }[]): Promise<"ok" | "cancelado" | "baixado"> {
  const arquivos = itens.map((i) => new File([i.arquivo], i.nome, { type: i.arquivo.type || "image/jpeg" }));
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: arquivos })) {
    try {
      await nav.share({ files: arquivos });
      return "ok";
    } catch (e: any) {
      if (e?.name === "AbortError") return "cancelado";
      // outro erro (permissão, arquivo grande demais): cai para o download
    }
  }
  itens.forEach((i) => baixarCopia(i.arquivo, i.nome));
  return "baixado";
}
