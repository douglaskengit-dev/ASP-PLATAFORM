/** Data da foto gravada pela câmera (EXIF DateTimeOriginal), lida dos bytes
 *  do JPEG ORIGINAL — a compressão no canvas apaga o EXIF, então a leitura
 *  acontece antes dela. Leitor mínimo, sem dependência: SOI → segmento APP1
 *  "Exif" → cabeçalho TIFF (II/MM) → IFD0 → ponteiro do Exif IFD (0x8769) →
 *  tag 0x9003. Qualquer coisa fora do esperado devolve null (foto sem EXIF,
 *  PNG, HEIC, arquivo truncado) — a data é só para AVISAR. */

const ascii = (b: Uint8Array, ini: number, n: number) =>
  String.fromCharCode(...Array.from(b.subarray(ini, Math.min(b.length, ini + n))));

/** "2026:08:25 14:03:12" → "2026-08-25T14:03:12" (null se inválida). */
export function dataExifParaIso(t: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(t || "");
  if (!m) return null;
  const [, a, me, d, h, mi, s] = m;
  const data = new Date(`${a}-${me}-${d}T00:00:00Z`);
  if (a === "0000" || isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== `${a}-${me}-${d}`) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return `${a}-${me}-${d}T${h}:${mi}:${s}`;
}

function lerTiff(b: Uint8Array, t0: number, fim: number): string | null {
  const le = b[t0] === 0x49 && b[t0 + 1] === 0x49;
  const be = b[t0] === 0x4d && b[t0 + 1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o: number) => (o < t0 || o + 2 > fim ? -1 : le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (o < t0 || o + 4 > fim ? -1
    : (le ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
      : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  if (u16(t0 + 2) !== 42) return null;

  /** Entrada `alvo` do IFD que começa em t0 + desloc. */
  const entrada = (desloc: number, alvo: number) => {
    if (desloc < 0) return null;
    const o = t0 + desloc;
    const n = u16(o);
    if (n < 0 || n > 512) return null;
    for (let k = 0; k < n; k++) {
      const e = o + 2 + k * 12;
      if (u16(e) === alvo) return { tipo: u16(e + 2), cont: u32(e + 4), valor: e + 8 };
    }
    return null;
  };

  const ponteiro = entrada(u32(t0 + 4), 0x8769);
  if (!ponteiro) return null;
  const tag = entrada(u32(ponteiro.valor), 0x9003);   // DateTimeOriginal
  if (!tag || tag.tipo !== 2 || tag.cont < 19) return null;
  const off = tag.cont > 4 ? t0 + u32(tag.valor) : tag.valor;
  if (off < t0 || off + 19 > fim) return null;
  return dataExifParaIso(ascii(b, off, 19));
}

/** DateTimeOriginal do JPEG, "aaaa-mm-ddThh:mm:ss"; null se não houver. */
export function dataCapturaExif(b: Uint8Array): string | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marcador = b[p + 1];
    if (marcador === 0xff) { p++; continue; }                 // preenchimento
    if (marcador === 0xd9 || marcador === 0xda) return null;  // fim / início dos dados da imagem
    if ((marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) { p += 2; continue; }
    const tam = (b[p + 2] << 8) | b[p + 3];
    if (tam < 2) return null;
    if (marcador === 0xe1 && tam >= 16 && ascii(b, p + 4, 6) === "Exif\0\0") {
      const r = lerTiff(b, p + 10, Math.min(b.length, p + 2 + tam));
      if (r) return r;
    }
    p += 2 + tam;
  }
  return null;
}
