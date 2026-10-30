/**
 * Leitura do laudo do laboratório (Relatório de Ensaio da Acquasys, formato
 * padrão) a partir do TEXTO do PDF — o servidor extrai com o pdf-parse e
 * esta função, pura, tira os valores. Nada vai para serviço externo.
 *
 * Cada parâmetro sai numa linha com as colunas na ordem do laudo:
 *   Cor Aparente  2,60 mg Pt-Co/L  15 mg Pt-Co/L 0,07  2,50  0,76  SMWW…
 *                 resultado        limite        inc.  LQ    LD
 * Nos P/A o limite é "Ausência em 100 mL P-A/100ml" e o resultado
 * "Presença/Ausência P-A/100ml"; "-" é campo não informado.
 *
 * PDF sem texto ("Microsoft Print to PDF", escaneado) não tem o que ler: a
 * rota devolve o aviso para usar o PDF original do laboratório.
 */
import { LAUDO_COLUNAS, LAUDO_PARAMETROS } from "./relatorio";

export interface LaudoLido {
  /** Nº do Relatório de Ensaio, ex.: "27066/2026.0.A" — vai no cabeçalho. */
  amostra?: string;
  /** Data da coleta (ISO) — ordena antes/depois. */
  dataColeta?: string;
  /** Medidos em campo pelo amostrador (só para conferir com a coleta). */
  cloro?: number;
  ph?: number;
  /** Grade do sistema: [valor, incerteza, LQ, LD, limite] por parâmetro;
   *  "" = não achado no laudo (o formulário mantém o que já tinha). */
  grade: string[][];
  /** Quantos dos 5 parâmetros foram lidos. */
  lidos: number;
  /** Parâmetros que o laboratório declarou fora ("NÃO ATENDE … no(s)
   *  parâmetro(s) …"), como escritos no laudo. */
  naoAtende: string[];
  /** Parâmetros achados cuja linha não tinha as 5 colunas reconhecíveis —
   *  ficaram em branco para digitar. */
  incompletos: string[];
  /** Tem cara de Relatório de Ensaio (cabeçalho + resultados analíticos). */
  ehRelatorioDeEnsaio: boolean;
}

/** Nome do parâmetro como o laboratório escreve (ordem de LAUDO_PARAMETROS). */
const NOMES: RegExp[] = [
  /cor\s+aparente/i,
  /turbidez/i,
  /coliformes\s+totais/i,
  /escherichia\s+coli|\bE\.\s*coli\b/i,
  /bact[ée]rias\s+heterotr[óo]ficas/i,
];

/** Unidades e textos fixos que trazem números ("100 mL") e atrapalham. */
const RUIDO: RegExp[] = [
  /\(P\/A\)/gi,
  /P\s*-\s*A\s*\/\s*100\s*ml/gi,
  /em\s+100\s*mL/gi,
  /mg\s*Pt\s*-\s*Co\s*\/\s*L/gi,
  /UFC\s*\/\s*mL/gi,
  /\bNTU\b/g,
];

// Número com ponto de milhar ("1.200", "1.200,5") vem antes do decimal.
const NUM = String.raw`[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;
const TOKEN = new RegExp(String.raw`<\s*LQ\b|<\s*(?:${NUM})|${NUM}|presen[çc]a|aus[êe]ncia|ausente|presente|\bND\b|\bN[AI]\b|(?<=^|\s)-(?=\s|$)`, "gi");

/** "2.60" → "2,60"; "1.200" fica; "< 1" → "<1"; Presença → Presente;
 *  NA/NI (não se aplica / não informado) → "-". */
function celula(tok: string): string {
  const t = tok.replace(/\s+/g, "");
  if (/^presen/i.test(t)) return "Presente";
  if (/^aus/i.test(t)) return "Ausente";
  if (/^nd$/i.test(t)) return "ND";
  if (/^n[ai]$/i.test(t)) return "-";
  if (/^<lq$/i.test(t)) return "<LQ";
  const menor = t.startsWith("<") ? "<" : "";
  const n = menor ? t.slice(1) : t;
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(n)) return menor + n;   // milhar
  return menor + n.replace(".", ",");
}

/** Uma célula já separada (vinda da leitura por IA) no formato do sistema:
 *  "2.60" → "2,60", "< 1 UFC/mL" → "<1", "Presença P-A/100ml" → "Presente",
 *  "Ausência em 100 mL" → "Ausente". Vazio fica vazio; mais de um valor na
 *  mesma célula (ou nada reconhecível) → null, para a linha ficar em branco. */
export function celulaLida(texto: string | null | undefined): string | null {
  let t = (texto || "").trim();
  if (!t) return "";
  for (const r of RUIDO) t = t.replace(r, " ");
  const toks = t.match(TOKEN) || [];
  return toks.length === 1 ? celula(toks[0]) : null;
}

const num = (s?: string) => {
  const n = s ? Number(s.replace(",", ".")) : NaN;
  return isFinite(n) ? n : undefined;
};

export function lerLaudoTexto(texto: string): LaudoLido {
  const t = (texto || "").replace(/\r/g, "");
  const grade = LAUDO_PARAMETROS.map(() => LAUDO_COLUNAS.map(() => ""));
  const incompletos: string[] = [];
  let lidos = 0;

  NOMES.forEach((re, i) => {
    const m = re.exec(t);
    if (!m) return;
    // trecho do parâmetro: do nome até o método de referência
    const ini = m.index + m[0].length;
    const fimMetodo = t.slice(ini).search(/SMWW|M[ée]todo\s+\d|Standard Methods/i);
    let trecho = t.slice(ini, fimMetodo < 0 ? ini + 300 : ini + fimMetodo);
    for (const r of RUIDO) trecho = trecho.replace(r, " ");
    const toks = (trecho.match(TOKEN) || []).map(celula);
    // As colunas são pegas pela posição: sem as 5 (resultado, limite,
    // incerteza, LQ, LD) uma célula do laudo não foi reconhecida e as demais
    // escorregariam — o limite viraria resultado. Melhor deixar em branco.
    if (toks.length !== 5) {
      if (toks.length) incompletos.push(LAUDO_PARAMETROS[i]);
      return;
    }
    const [valor, limite, incerteza, lq, ld] = toks;
    grade[i] = [valor, incerteza, lq, ld, limite === "-" ? "" : limite];
    lidos++;
  });

  const amostra = /Relat[óo]rio\s+de\s+Ensaio\s+(\d+\/\d{4}\.\d+\.[A-Z])/i.exec(t)?.[1];
  const dc = /Data\s+(?:da\s+)?Coleta:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  // "…NÃO ATENDE … no(s) parâmetro(s) Coliformes Totais (P/A), Escherichia
  // Coli (P/A)." — a lista pode quebrar de linha: vai até o ponto final.
  const naoAtendeTxt = /N[ÃA]O\s+ATENDE[\s\S]*?par[âa]metro\(s\)\s*([\s\S]*?)\.(?=\s*(?:\n|$))/i.exec(t)?.[1] || "";
  const naoAtende = naoAtendeTxt.replace(/\(P\/A\)/gi, "").replace(/\s+/g, " ")
    .split(/,\s*|\s+e\s+/).map((s) => s.trim()).filter(Boolean);

  return {
    amostra,
    dataColeta: dc ? `${dc[3]}-${dc[2]}-${dc[1]}` : undefined,
    cloro: num(/Cloro\s+Residual\s+Livre:\s*([\d.,]+)/i.exec(t)?.[1]),
    ph: num(/\bpH:\s*([\d.,]+)/i.exec(t)?.[1]),
    grade, lidos, naoAtende, incompletos,
    ehRelatorioDeEnsaio: /Relat[óo]rio\s+de\s+Ensaio/i.test(t) && /Resultados\s+Anal[íi]ticos/i.test(t),
  };
}

/** Texto curto demais = PDF sem camada de texto (impresso como imagem). */
export const MINIMO_TEXTO_LAUDO = 200;
