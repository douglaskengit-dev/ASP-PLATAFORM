/**
 * Importação de batimetria a partir da planilha da ASP (Caminho B).
 *
 * Lê um arquivo no MESMO layout da planilha atual (blocos "v1..vN" na linha 1;
 * para cada ponto, a linha "Altura sedimento" com as 3 leituras
 * Esquerda/Centro/Direita) e monta a matriz do medidor no modo RADIAL, tratando
 * cada lateral como um sub-vetor (colunas = 3·N, linhas = m pontos). Os valores
 * já são a espessura de sedimento (referência = fundo).
 *
 * Aceita CSV e XLSX. É afinado ao template atual — se o layout mudar, ajusta-se
 * aqui. Ver COWORK: medidor de sedimento.
 */

export interface DadosBatimetria {
  vetores: number;          // N
  pontos: number;           // m
  /** valores[ponto][lateralGlobal] — lateralGlobal = vetor*3 + (0 esq,1 centro,2 dir) */
  valores: (number | null)[][];
  alturaSugerida: number | null; // "Coluna teórica da água" máxima, se achada
  invalidos: number;        // leituras marcadas INCORRETO na validação
  totalValidacao: number;   // total de leituras que têm validação
  /** Leituras com espessura negativa (sonar corrigido > régua corrigida).
   *  O medidor as trata como inválidas — ficam FORA do cálculo. */
  negativos: number;
}

/** Número de uma célula da planilha. Prioridade pt-BR: vírgula decimal e
 * ponto de milhar ("1.234,56" = 1234.56; "0,26" = 0.26). Também aceita o
 * formato inglês quando não há ambiguidade ("1,234.56" — o separador que vem
 * por ÚLTIMO é o decimal; "0.26"). Ponto sozinho é decimal ("1.5"); vários
 * pontos sem vírgula são milhar ("1.234.567"). Espaços (inclusive o fino/
 * não separável do Excel) e sinal são aceitos. Texto que não é número → null. */
export function paraNumero(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let t = String(v).replace(/[\s  ]/g, "").replace(/^−/, "-");
  if (!t || !/^[+-]?[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const ultPonto = t.lastIndexOf(".");
  const ultVirg = t.lastIndexOf(",");
  if (ultPonto >= 0 && ultVirg >= 0) {
    // Os dois: o último é o decimal, o outro é milhar.
    t = ultVirg > ultPonto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (ultVirg >= 0) {
    // Só vírgula: uma = decimal (pt-BR); várias = milhar ("1,234,567").
    t = (t.match(/,/g) || []).length > 1 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if ((t.match(/\./g) || []).length > 1) {
    t = t.replace(/\./g, ""); // vários pontos: milhar
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/** 0 → "A", 27 → "AB" (para apontar a coluna na mensagem). */
function colunaLetra(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function texto(v: any): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Lê o arquivo (CSV ou XLSX) para uma matriz 2D de células. */
export async function lerArquivoParaMatriz(file: File): Promise<any[][]> {
  const nome = file.name.toLowerCase();
  if (nome.endsWith(".xlsx") || nome.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    // Escolhe a aba que tem "v1" na primeira linha; senão a primeira.
    let nomeAba = wb.SheetNames[0];
    for (const s of wb.SheetNames) {
      const linha = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[s], { header: 1, range: 0 })[0] || [];
      if (linha.some((c) => /^v\d+/i.test(texto(c)))) { nomeAba = s; break; }
    }
    return XLSX.utils.sheet_to_json<any[]>(wb.Sheets[nomeAba], { header: 1, defval: null });
  }
  // CSV
  let txt = await file.text();
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1); // remove BOM (UTF-8)
  const sep = separadorCsv(txt);
  return txt.split(/\r?\n/).map((l) => dividirLinhaCsv(l, sep));
}

/** Separador do CSV. Prefere ";" (Excel pt-BR) e tabulação — com eles a
 * vírgula decimal ("0,26") sobrevive. Vírgula só quando não há ";" nem tab
 * fora de aspas; aí o decimal tem de ser ponto ou vir entre aspas ("0,26"). */
export function separadorCsv(txt: string): ";" | "\t" | "," {
  const linhas = txt.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let pv = 0, tab = 0;
  for (const l of linhas) {
    let aspas = false;
    for (const ch of l) {
      if (ch === '"') aspas = !aspas;
      else if (!aspas && ch === ";") pv++;
      else if (!aspas && ch === "\t") tab++;
    }
  }
  return pv > 0 ? ";" : tab > 0 ? "\t" : ",";
}

/** Divide uma linha de CSV respeitando aspas. */
export function dividirLinhaCsv(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else aspas = !aspas;
    } else if (ch === sep && !aspas) {
      out.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  out.push(atual);
  return out;
}

/** Interpreta a matriz 2D no layout da planilha e extrai a batimetria. */
export function extrairBatimetria(rows: any[][]): DadosBatimetria {
  const linha0 = rows[0] || [];
  // Blocos de vetores: colunas onde aparece "vN".
  const blocos: number[] = [];
  linha0.forEach((c, i) => { if (/^v\d+/i.test(texto(c))) blocos.push(i); });
  if (blocos.length === 0) {
    throw new Error("Não encontrei os blocos de vetores (v1, v2, …) na primeira linha.");
  }
  const N = blocos.length;
  const nomeBloco = (b: number) => texto(linha0[blocos[b]]).replace(/\s+/g, "");

  // ⛔ Cabeçalho de vetor repetido (dois "v1"): qual leitura é de qual vetor?
  const porNumero = new Map<number, number>();
  const repetidos: string[] = [];
  blocos.forEach((col, b) => {
    const n = parseInt((/^v(\d+)/i.exec(nomeBloco(b)) || [])[1] || "", 10);
    if (porNumero.has(n)) repetidos.push(`v${n} (colunas ${colunaLetra(porNumero.get(n)!)} e ${colunaLetra(col)})`);
    else porNumero.set(n, col);
  });
  if (repetidos.length) {
    throw new Error(`Cabeçalho de vetor repetido: ${repetidos.join(", ")}. Cada vetor precisa de um nome único na linha 1.`);
  }

  // Para cada bloco: rótulo em base+2, valores esq/centro/dir em base+3/+4/+5.
  // Linhas de ponto = onde a célula (base+2) contém "sedimento".
  const primeiroBase = blocos[0];
  const linhasPonto: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    if (/sedimento/i.test(texto((rows[r] || [])[primeiroBase + 2]))) linhasPonto.push(r);
  }
  if (linhasPonto.length === 0) {
    throw new Error("Não encontrei as linhas de 'Altura sedimento'. Confira o template.");
  }
  const m = linhasPonto.length;

  // ⛔ Todos os vetores com os mesmos pontos, nas mesmas linhas — senão a
  // leitura de um vetor seria lida na linha de outro ponto.
  const diferentes: string[] = [];
  blocos.forEach((base, b) => {
    if (b === 0) return;
    const linhasB: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      if (/sedimento/i.test(texto((rows[r] || [])[base + 2]))) linhasB.push(r);
    }
    if (linhasB.length !== m) diferentes.push(`${nomeBloco(b)} tem ${linhasB.length}`);
    else if (linhasB.some((r, i) => r !== linhasPonto[i])) diferentes.push(`${nomeBloco(b)} tem os pontos em outras linhas`);
  });
  if (diferentes.length) {
    throw new Error(`Os vetores têm quantidades de pontos diferentes: ${nomeBloco(0)} tem ${m} ponto(s); ${diferentes.join("; ")}. Todos os vetores precisam ter os mesmos pontos.`);
  }

  const valores: (number | null)[][] = [];
  let negativos = 0;
  for (let p = 0; p < m; p++) {
    const r = linhasPonto[p];
    const linha = rows[r] || [];
    const rowVals: (number | null)[] = [];
    for (let b = 0; b < N; b++) {
      const base = blocos[b];
      rowVals.push(paraNumero(linha[base + 3])); // esquerda
      rowVals.push(paraNumero(linha[base + 4])); // centro
      rowVals.push(paraNumero(linha[base + 5])); // direita
    }
    for (const v of rowVals) if (v != null && v < 0) negativos++;
    valores.push(rowVals);
  }

  // Altura sugerida: "Coluna teórica da água" (rótulo em base+0/+1). Pega o máx.
  let alturaSugerida: number | null = null;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    for (const base of blocos) {
      const rot = texto((rows[r] || [])[base + 1]) + texto((rows[r] || [])[base + 0]);
      if (/coluna te/i.test(rot)) {
        const v = paraNumero((rows[r] || [])[base + 2]);
        if (v != null) alturaSugerida = Math.max(alturaSugerida ?? 0, v);
      }
    }
  }

  // Validação (régua × sonar): conta quantas leituras estão "INCORRETO".
  let invalidos = 0, totalValidacao = 0;
  for (let r = 0; r < rows.length; r++) {
    if (/valida/i.test(texto((rows[r] || [])[primeiroBase + 2]))) {
      for (const b of blocos) {
        for (const off of [3, 4, 5]) {
          const cel = texto((rows[r] || [])[b + off]).toUpperCase();
          if (cel) { totalValidacao++; if (cel.indexOf("INCORRET") >= 0) invalidos++; }
        }
      }
    }
  }

  return { vetores: N, pontos: m, valores, alturaSugerida, invalidos, totalValidacao, negativos };
}

/** Gera um MODELO vazio (.xlsx) com N vetores e m pontos, no mesmo layout que
 * o importador lê, com as fórmulas de ALTURA REAL / Altura sedimento /
 * VALIDAÇÃO prontas. Retorna um Blob para download. */
export async function gerarModeloXlsx(N: number, m: number): Promise<Blob> {
  const XLSX = await import("xlsx");
  const col = (c: number) => XLSX.utils.encode_col(c);      // 0-idx → letra
  const a1 = (r: number, c: number) => `${col(c)}${r + 1}`; // ref A1 (r,c 0-idx)
  const cells: Record<string, any> = {};
  const put = (r: number, c: number, v: any) => { cells[XLSX.utils.encode_cell({ r, c })] = typeof v === "string" ? { t: "s", v } : { t: "n", v }; };
  const putF = (r: number, c: number, f: string) => { cells[XLSX.utils.encode_cell({ r, c })] = { t: "n", f }; };

  let maxR = 0, maxC = 0;
  for (let k = 0; k < N; k++) {
    const B = 6 * k; // coluna base (0-idx) do bloco v(k+1)
    put(0, B, `v${k + 1}`);
    put(1, B + 1, "Coluna teorica da agua");        // água teórica: preencher em (1, B+2)
    put(3, B + 2, "CONSTANTE ROV"); put(3, B + 3, 0.26);
    for (let p = 0; p < m; p++) {
      const hr = 7 + 5 * p; // linha do cabeçalho do ponto (0-idx)
      put(hr, B + 2, p);
      ["Esquerda", "Centro", "Direita"].forEach((lab, j) => put(hr, B + 3 + j, lab));
      // régua medida em (hr+2, B); régua+0,15 em (hr+2, B+1)
      putF(hr + 2, B + 1, `${a1(hr + 2, B)}+0.15`);
      put(hr + 1, B + 2, "ALTURA SONAR");            // leitura do sonar: (hr+1, B+3..+5)
      put(hr + 2, B + 2, "ALTURA REAL SONAR");
      for (let j = 0; j < 3; j++) putF(hr + 2, B + 3 + j, `${a1(hr + 1, B + 3 + j)}+$${col(B + 3)}$4`);
      put(hr + 3, B + 2, "Altura sedimento");
      for (let j = 0; j < 3; j++) putF(hr + 3, B + 3 + j, `${a1(hr + 2, B + 1)}-${a1(hr + 2, B + 3 + j)}`);
      put(hr + 4, B + 2, "VALIDACAO");
      for (let j = 0; j < 3; j++) putF(hr + 4, B + 3 + j, `IF(ROUND(${a1(hr + 3, B + 3 + j)}+${a1(hr + 2, B + 3 + j)},2)=ROUND($${col(B + 2)}$2,2),"CORRETO","INCORRETO")`);
      maxR = Math.max(maxR, hr + 4);
    }
    maxC = Math.max(maxC, B + 5);
  }
  cells["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, cells, "Batimetria");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ── Entrada manual (mesma matemática da planilha) ──────────────────────────
// Espessura = (régua + peso) − (sonar + ROV). Padrões: ROV 0,26 m e peso
// 0,15 m — na mesma unidade das leituras (em cm: 26 e 15).

/** ROV e peso da régua padrão na unidade escolhida. */
export function padroesRovPeso(unidade: "m" | "cm"): { rov: number; peso: number } {
  return unidade === "cm" ? { rov: 26, peso: 15 } : { rov: 0.26, peso: 0.15 };
}

export interface GridManual {
  vetores: number;
  pontos: number;
  agua: (number | null)[];         // água teórica por vetor
  /** Régua (coluna de água) medida em CADA ponto de CADA vetor: [ponto][vetor].
   *  Cada vetor é uma passada distinta do ROV, com a própria régua por ponto —
   *  igual ao layout da planilha (um bloco de régua por v1..vN). */
  regua: (number | null)[][];
  sonar: (number | null)[][][];    // [ponto][vetor][lateral 0=esq,1=centro,2=dir]
}

export function calcularSedimento(
  sonar: number | null, regua: number | null, rov: number, peso: number
): number | null {
  if (sonar == null || regua == null) return null;
  const real = sonar + rov;
  return Number(((regua + peso) - real).toFixed(3));
}

/** Constrói a mesma estrutura DadosBatimetria a partir da digitação manual —
 * garantindo que import e digitação produzam resultados idênticos. */
export function montarDadosManuais(g: GridManual, opts: { rov: number; peso: number }): DadosBatimetria {
  const N = g.vetores, m = g.pontos;
  const valores: (number | null)[][] = [];
  let invalidos = 0, totalValidacao = 0, negativos = 0;
  for (let p = 0; p < m; p++) {
    const row: (number | null)[] = [];
    for (let v = 0; v < N; v++) {
      for (let lat = 0; lat < 3; lat++) {
        const s = g.sonar?.[p]?.[v]?.[lat] ?? null;
        const reg = g.regua?.[p]?.[v] ?? null;   // régua do PONTO daquele VETOR
        const sed = calcularSedimento(s, reg, opts.rov, opts.peso);
        row.push(sed);
        if (sed != null && sed < 0) negativos++;
        const agua = g.agua?.[v] ?? null;
        if (s != null && reg != null && agua != null && sed != null) {
          totalValidacao++;
          if (Math.round((sed + s + opts.rov) * 100) !== Math.round(agua * 100)) invalidos++;
        }
      }
    }
    valores.push(row);
  }
  const alturaSugerida = Math.max(0, ...g.agua.map((a) => a ?? 0)) || null;
  return { vetores: N, pontos: m, valores, alturaSugerida, invalidos, totalValidacao, negativos };
}

/** Formato do tanque escolhido na importação. */
export interface FormatoTanque {
  formato: "circulo" | "quadrado" | "retangulo" | "ngon" | "custom";
  largura?: number | null;   // retângulo
  ngonLados?: number | null; // n-ágono
  vertices?: string;         // personalizado ("x,y; x,y; …")
}

/** Monta o "estado" do medidor a partir da batimetria + parâmetros.
 *
 * Modo VETORES PARALELOS: cada lateral é um sub-vetor independente, então há
 * 3·N passadas paralelas atravessando o tanque (colunas) e m pontos ao longo
 * de cada uma (linhas). O medidor distribui os pontos sobre o comprimento útil
 * de cada passada (a corda do tanque), de modo que TODAS as 3·N·m leituras
 * importadas entram no cálculo — nada é descartado.
 *
 * refMode = fundo (os valores já são espessura de sedimento).
 */
export function montarEstadoMedidor(
  dados: DadosBatimetria,
  opts: {
    diametro: number;              // medida principal (diâmetro / comprimento)
    altura: number;
    unidade?: "m" | "cm";
    tanque?: FormatoTanque;
  }
): Record<string, unknown> {
  const cols = dados.vetores * 3;
  const rows = dados.pontos;
  const t = opts.tanque;
  return {
    unit: opts.unidade || "m",
    inputMode: "diameter",
    dimValue: opts.diametro,
    height: opts.altura,
    refMode: "bottom",
    gridMode: "paralelo",
    // Planilha/digitação: 3 laterais (E/C/D) por vetor — é assim que a
    // validação aponta a leitura ("v2-E, ponto 3").
    origem: "batimetria",
    batimetria: "sim",
    formato: t?.formato || "circulo",
    largura: t?.largura ?? null,
    ngonLados: t?.ngonLados ?? 6,
    vertices: t?.vertices || "",
    rows,
    cols,
    values: dados.valores,
  };
}
