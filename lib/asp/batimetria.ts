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

function paraNumero(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).trim().replace(/\./g, "").replace(",", ".")) ;
  // Observação: acima trata "1.234,56" e "0,08". Se vier com ponto decimal
  // simples ("0.08"), o replace de pontos zeraria — então tentamos os dois.
  const n2 = parseFloat(String(v).trim().replace(",", "."));
  const escolhido = !isNaN(n2) ? n2 : n;
  return isNaN(escolhido) ? null : escolhido;
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
  const sep = txt.includes(";") ? ";" : ",";
  return txt.split(/\r?\n/).map((l) => l.split(sep));
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
// Espessura = (régua + peso) − (sonar + ROV). Padrões: ROV 0,26 e peso 0,15.

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
