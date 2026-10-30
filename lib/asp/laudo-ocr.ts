/**
 * Leitura do laudo (Relatório de Ensaio padrão) a partir do OCR — para o PDF
 * que é IMAGEM ("Imprimir em PDF", escaneado). Sem IA: o OCR (Tesseract, no
 * servidor) devolve cada palavra com a posição na página e esta função, pura,
 * monta a tabela pelo LAYOUT do laudo:
 *
 *   • colunas — pelos cabeçalhos de cada tabela (Resultado, Portaria,
 *     Incerteza, LQ, LD, Método): a fronteira é o meio entre dois cabeçalhos;
 *   • linhas — pelo nome de cada parâmetro: a faixa vai do meio até a âncora
 *     de cima ao meio até a de baixo, o que pega as células de várias linhas
 *     ("Ausência em / 100 mL P- / A/100ml").
 *
 * Cada célula passa pela mesma normalização do leitor de texto (celulaLida).
 * Célula com reconhecimento duvidoso (confiança baixa) vai para `conferir`;
 * célula ilegível ou com dois valores deixa a linha em branco (`incompletos`).
 */
import { LAUDO_COLUNAS, LAUDO_PARAMETROS } from "./relatorio";
import { celulaLida, lerLaudoTexto, type LaudoLido } from "./laudo-leitura";

export interface PalavraOcr { t: string; x0: number; x1: number; y0: number; y1: number; c: number }

/** Nome do parâmetro como aparece na linha (a palavra que serve de âncora). */
const ANCORAS: RegExp[] = [/^aparente$/i, /^turbidez$/i, /^coliformes$/i, /^escherichia$/i, /^bact[ée]rias$/i];
/** Cabeçalhos das colunas, na ordem do laudo. */
const CABECALHOS: RegExp[] = [/^resultado$/i, /^portaria$/i, /^incerteza$/i, /^l[qo0]$/i, /^ld$/i, /^m[ée]todo$/i];
/** Palavras que só existem no texto fixo das células (unidades, "em 100 mL")
 *  — não contam na confiança da leitura do valor. */
const RUIDO_PALAVRA = /^(mg|pt-co\/l|ntu|ufc\/m+l|p-a\/100ml|p-|a\/100ml|em|100|ml|gm\/ms|n[ºo°]888)$/i;
/** Abaixo disso o OCR não tem certeza da palavra: o valor pede conferência. */
const CONFIANCA_MINIMA = 60;

const yc = (w: PalavraOcr) => (w.y0 + w.y1) / 2;
const xc = (w: PalavraOcr) => (w.x0 + w.x1) / 2;
const altura = (w: PalavraOcr) => Math.max(1, w.y1 - w.y0);

/** Linhas de cabeçalho (uma por tabela): as palavras dos 6 cabeçalhos na
 *  mesma altura do "Resultado". */
function cabecalhos(ps: PalavraOcr[]): { y: number; base: number; x: number[] }[] {
  const out: { y: number; base: number; x: number[] }[] = [];
  for (const r of ps.filter((w) => CABECALHOS[0].test(w.t))) {
    const naLinha = ps.filter((w) => Math.abs(yc(w) - yc(r)) < altura(r) * 1.6);
    const x = CABECALHOS.map((re) => naLinha.find((w) => re.test(w.t)));
    if (x.some((w) => !w)) continue;
    // fim do cabeçalho: a 2ª linha ("GM/MS nº888") fica logo abaixo
    const base = Math.max(...naLinha.map((w) => w.y1), ...ps.filter((w) => /gm\/ms|888/i.test(w.t) && Math.abs(yc(w) - yc(r)) < altura(r) * 2.5).map((w) => w.y1));
    out.push({ y: yc(r), base, x: x.map((w) => xc(w!)) });
  }
  return out.sort((a, b) => a.y - b.y);
}

export function lerLaudoDePalavras(palavras: PalavraOcr[], texto: string): LaudoLido {
  // Metadados (nº do relatório, data, cloro, pH, NÃO ATENDE) pelo texto do OCR
  const meta = lerLaudoTexto(texto);
  const grade = LAUDO_PARAMETROS.map(() => LAUDO_COLUNAS.map(() => ""));
  const incompletos: string[] = [], conferir: string[] = [];
  let lidos = 0;

  const ps = palavras.filter((w) => w.t.trim());
  const cabs = cabecalhos(ps);
  // âncoras de linha: nomes dos parâmetros + cabeçalhos + fim das tabelas
  // títulos das seções ("Físico Químico", "Microbiológico", "Especificações")
  // também limitam a faixa da linha de cima
  const fim = ps.filter((w) => /^(especifica|microbiol|f[íi]sico$)/i.test(w.t)).map(yc);
  const nomes = ANCORAS.map((re) => ps.find((w) => re.test(w.t) && cabs.some((c) => yc(w) > c.y)));
  const limites = [...cabs.map((c) => c.y), ...fim, ...nomes.filter(Boolean).map((w) => yc(w!))].sort((a, b) => a - b);

  nomes.forEach((nome, i) => {
    if (!nome) return;
    const y = yc(nome);
    const cab = [...cabs].reverse().find((c) => c.y < y);
    if (!cab) return;
    const acima = Math.max(...limites.filter((v) => v < y - 1));
    const abaixo = Math.min(...limites.filter((v) => v > y + 1), y + altura(nome) * 6);
    const topo = Math.max((acima + y) / 2, cab.base + 1), base = (y + abaixo) / 2;
    // fronteiras das colunas Resultado | Portaria | Incerteza | LQ | LD
    const [r, p, inc, lq, ld, met] = cab.x;
    const fronteiras = [r - (p - r) / 2, (r + p) / 2, (p + inc) / 2, (inc + lq) / 2, (lq + ld) / 2, (ld + met) / 2];
    const naFaixa = ps.filter((w) => yc(w) > topo && yc(w) < base);
    const celulas = [0, 1, 2, 3, 4].map((k) => naFaixa
      .filter((w) => xc(w) >= fronteiras[k] && xc(w) < fronteiras[k + 1])
      .sort((a, b) => (Math.abs(yc(a) - yc(b)) < altura(a) / 2 ? a.x0 - b.x0 : yc(a) - yc(b))));
    // ordem do laudo: resultado, limite, incerteza, LQ, LD
    const [vRes, vLim, vInc, vLq, vLd] = celulas.map((ws) => celulaLida(ws.map((w) => w.t).join(" ")));
    if ([vRes, vLim, vInc, vLq, vLd].some((c) => c === null) || !vRes) { incompletos.push(LAUDO_PARAMETROS[i]); return; }
    grade[i] = [vRes!, vInc!, vLq!, vLd!, vLim === "-" ? "" : vLim!];
    lidos++;
    if (celulas.some((ws) => ws.some((w) => !RUIDO_PALAVRA.test(w.t) && w.c < CONFIANCA_MINIMA))) conferir.push(LAUDO_PARAMETROS[i]);
  });

  return {
    ...meta,
    // pH fora da escala = ponto decimal perdido no OCR ("8.9" → "89"): descarta
    ph: meta.ph != null && meta.ph >= 0 && meta.ph <= 14 ? meta.ph : undefined,
    grade, lidos, incompletos, conferir,
  };
}
