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

  return { vetores: N, pontos: m, valores, alturaSugerida, invalidos, totalValidacao };
}

// ── Entrada manual (mesma matemática da planilha) ──────────────────────────
// Espessura = (régua + peso) − (sonar + ROV). Padrões: ROV 0,26 e peso 0,15.

export interface GridManual {
  vetores: number;
  pontos: number;
  agua: (number | null)[];         // água teórica por vetor
  regua: (number | null)[];        // régua medida por ponto
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
  let invalidos = 0, totalValidacao = 0;
  for (let p = 0; p < m; p++) {
    const row: (number | null)[] = [];
    for (let v = 0; v < N; v++) {
      for (let lat = 0; lat < 3; lat++) {
        const s = g.sonar?.[p]?.[v]?.[lat] ?? null;
        const reg = g.regua?.[p] ?? null;
        const sed = calcularSedimento(s, reg, opts.rov, opts.peso);
        row.push(sed);
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
  return { vetores: N, pontos: m, valores, alturaSugerida, invalidos, totalValidacao };
}

/** Monta o "estado" do medidor (radial) a partir da batimetria + parâmetros.
 * Cada lateral vira um sub-vetor → cols = 3·N. refMode = fundo (espessura). */
export function montarEstadoMedidor(
  dados: DadosBatimetria,
  opts: { diametro: number; altura: number; unidade?: "m" | "cm" }
): Record<string, unknown> {
  const cols = dados.vetores * 3;
  const rows = dados.pontos;
  // Passo radial ≤ 2 m: distribui os m pontos ao longo do maior vetor (~diâmetro).
  const passo = Math.min(2, opts.diametro / Math.max(1, rows));
  return {
    unit: opts.unidade || "m",
    inputMode: "diameter",
    dimValue: opts.diametro,
    height: opts.altura,
    refMode: "bottom",
    gridMode: "radial",
    batimetria: "sim",
    fanSpacing: Number(passo.toFixed(3)),
    rows,
    cols,
    values: dados.valores,
  };
}
