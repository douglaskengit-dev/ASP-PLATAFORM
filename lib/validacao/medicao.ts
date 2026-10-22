/** Regras da Fase 3 — os VALORES de uma medição (estado do Medidor de
 * Sedimento, que é o `dados` da coleta). Puras: a página chama antes de
 * salvar (Medidor, Digitar, Importar) e a API repete com o que recebeu.
 *
 *   ⛔ medição vazia · diâmetro/altura do tanque ausentes · leitura negativa
 *      ou que não é número · com referência no TOPO, leitura maior que a
 *      altura (seria abaixo do fundo — o medidor já a descarta como inválida)
 *   ⚠️ com referência DIRETA/FUNDO, espessura maior que a altura do tanque
 *      (o medidor limita à altura) · medidas do tanque diferentes do
 *      cadastro da OS em mais de 5% (oferece atualizar o cadastro)
 *
 * As leituras estão na unidade do medidor (`unit`), a mesma da altura.
 * `chaveMedicao` = JSON canônico só do que muda o resultado: duas medições
 * com a mesma chave são a mesma medição (a API grava o SHA-256 dela). */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import type { Tanque } from "../asp/tanque";

/** Estado do medidor como vem do iframe (campos soltos, número ou texto). */
export type EstadoMedidor = Record<string, any>;

/** Diferença tolerada entre medida em campo e cadastro do tanque. */
export const TOLERANCIA_TANQUE = 0.05;

const LATERAIS = ["E", "C", "D"];

/** Leitura → número. null = célula vazia; NaN = não é número ("abc", "1,2,3").
 * Aceita vírgula decimal (o medidor também aceita). */
export function lerLeitura(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : NaN;
  const t = String(raw).trim().replace(/\s+/g, "");
  if (!t) return null;
  const n = t.replace(",", ".");
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(n) ? Number(n) : NaN;
}

/** Número positivo de um campo do estado (dimValue, height…), ou null. */
function positivo(v: unknown): number | null {
  const n = lerLeitura(v);
  return n !== null && isFinite(n) && n > 0 ? n : null;
}

export interface CelulaMedicao {
  /** "v2-E, ponto 3" / "linha 1, coluna 4" / "ponto âncora". */
  rotulo: string;
  bruto: unknown;
  valor: number | null;
}

/** Rótulo da célula [i][j]: importação/digitação têm 3 laterais por vetor. */
function rotuloCelula(e: EstadoMedidor, i: number, j: number): string {
  if (e.origem === "batimetria") return `v${Math.floor(j / 3) + 1}-${LATERAIS[j % 3]}, ponto ${i}`;
  if (e.gridMode === "radial" || e.gridMode === "paralelo") return `vetor ${j + 1}, ponto ${i + 1}`;
  return `linha ${i + 1}, coluna ${j + 1}`;
}

/** Leituras que entram no cálculo, com o rótulo de cada uma. */
export function celulasMedicao(e: EstadoMedidor): CelulaMedicao[] {
  const out: CelulaMedicao[] = [];
  if (!e || typeof e !== "object") return out;
  if (e.batimetria === "nao") {
    out.push({ rotulo: "sedimento mínimo", bruto: e.rangeMin, valor: lerLeitura(e.rangeMin) });
    out.push({ rotulo: "sedimento máximo", bruto: e.rangeMax, valor: lerLeitura(e.rangeMax) });
    return out;
  }
  if (e.gridMode === "radial") out.push({ rotulo: "ponto âncora", bruto: e.anchorValue, valor: lerLeitura(e.anchorValue) });
  const linhas = Math.max(0, parseInt(e.rows, 10) || 0);
  const colunas = Math.max(0, parseInt(e.cols, 10) || 0);
  const valores: unknown[][] = Array.isArray(e.values) ? e.values : [];
  for (let i = 0; i < linhas; i++) {
    for (let j = 0; j < colunas; j++) {
      const bruto = Array.isArray(valores[i]) ? valores[i][j] : null;
      out.push({ rotulo: rotuloCelula(e, i, j), bruto, valor: lerLeitura(bruto) });
    }
  }
  return out;
}

/** Medição com ao menos uma leitura preenchida. */
export function medicaoPreenchida(e: EstadoMedidor | null | undefined): boolean {
  return !!e && celulasMedicao(e).some((c) => c.valor !== null);
}

/** "v1-E, ponto 0; v2-C, ponto 4 e mais 3". */
export function listarCelulas(cs: CelulaMedicao[], max = 8): string {
  const nomes = cs.slice(0, max).map((c) => c.rotulo);
  return nomes.join("; ") + (cs.length > max ? ` e mais ${cs.length - max}` : "");
}

/** Medidas do estado convertidas para metros (como o cadastro do tanque). */
export function medidasEmMetros(e: EstadoMedidor): {
  formato: "circular" | "retangular" | null;
  diametro: number | null; comprimento: number | null; largura: number | null; altura: number | null;
} {
  const k = e?.unit === "cm" ? 0.01 : 1;
  const dim = positivo(e?.dimValue);
  const alt = positivo(e?.height);
  const f = e?.formato || "circulo";
  const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  const altura = r3(alt != null ? alt * k : null);
  if (f === "circulo") {
    const d = dim != null ? dim * k * (e?.inputMode === "radius" ? 2 : 1) : null;
    return { formato: "circular", diametro: r3(d), comprimento: null, largura: null, altura };
  }
  if (f === "quadrado" || f === "retangulo") {
    // Largura em branco = quadrado (o medidor faz o mesmo).
    const lg = f === "quadrado" ? dim : positivo(e?.largura) ?? dim;
    return {
      formato: "retangular", diametro: null,
      comprimento: r3(dim != null ? dim * k : null), largura: r3(lg != null ? lg * k : null), altura,
    };
  }
  // n-ágono / personalizado: não há equivalente no cadastro.
  return { formato: null, diametro: null, comprimento: null, largura: null, altura };
}

export interface DiferencaTanque {
  campo: "formato" | "diametro" | "comprimento" | "largura" | "altura";
  rotulo: string;
  medido: number | null;
  cadastro: number | null;
}

const ROTULO_MEDIDA: Record<string, string> = {
  diametro: "Diâmetro", comprimento: "Comprimento", largura: "Largura", altura: "Altura",
};

/** Medidas do medidor que diferem do cadastro do tanque em mais de 5%. */
export function diferencasTanque(e: EstadoMedidor, tanque: Tanque | null | undefined): DiferencaTanque[] {
  if (!tanque || !e) return [];
  const m = medidasEmMetros(e);
  const out: DiferencaTanque[] = [];
  const comparar = (campo: DiferencaTanque["campo"], medido: number | null, cad: number | null | undefined) => {
    if (medido == null || cad == null || !(cad > 0)) return;
    if (Math.abs(medido - cad) / cad > TOLERANCIA_TANQUE) out.push({ campo, rotulo: ROTULO_MEDIDA[campo], medido, cadastro: cad });
  };
  if (m.formato && m.formato !== tanque.formato) {
    out.push({ campo: "formato", rotulo: "Formato", medido: null, cadastro: null });
  } else if (m.formato === "circular") {
    comparar("diametro", m.diametro, tanque.diametro);
  } else if (m.formato === "retangular") {
    comparar("comprimento", m.comprimento, tanque.comprimento);
    comparar("largura", m.largura, tanque.largura);
  }
  comparar("altura", m.altura, tanque.altura);
  return out;
}

/** Cadastro do tanque com as medidas da medição (formato, dimensões e
 * altura); capacidade e material ficam como estão. */
export function tanqueComMedidas(tanque: Tanque, e: EstadoMedidor): Tanque {
  const m = medidasEmMetros(e);
  const formato = m.formato || tanque.formato;
  return {
    ...tanque,
    formato,
    diametro: formato === "circular" ? m.diametro ?? tanque.diametro ?? null : null,
    comprimento: formato === "retangular" ? m.comprimento ?? tanque.comprimento ?? null : null,
    largura: formato === "retangular" ? m.largura ?? tanque.largura ?? null : null,
    altura: m.altura ?? tanque.altura,
  };
}

const fmtM = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m`);

export interface OpcoesMedicao {
  /** Cadastro do tanque da OS — compara as medidas (⚠️). */
  tanque?: Tanque | null;
}

export const ROTULOS_MEDICAO: Record<string, string> = {
  medicao: "Medição",
  valores: "Leituras",
  tanque: "Tanque",
};

export function validarMedicao(e: EstadoMedidor | null | undefined, opts: OpcoesMedicao = {}): ResultadoValidacao {
  const r = novoResultado();
  if (!e || typeof e !== "object" || Array.isArray(e)) {
    addErro(r, "medicao", "A medição está vazia.");
    return r;
  }
  const un = e.unit === "cm" ? "cm" : "m";
  const H = positivo(e.height);
  if (positivo(e.dimValue) == null) addErro(r, "medicao", "Informe a medida do tanque (diâmetro/comprimento) no medidor.");
  if (H == null) addErro(r, "medicao", "Informe a altura do tanque no medidor.");

  const cs = celulasMedicao(e);
  if (!cs.some((c) => c.valor !== null)) addErro(r, "medicao", "A medição está vazia — nenhuma leitura preenchida.");

  const invalidas = cs.filter((c) => c.valor !== null && isNaN(c.valor));
  const negativas = cs.filter((c) => c.valor !== null && !isNaN(c.valor) && c.valor < 0);
  const acima = H == null ? [] : cs.filter((c) => c.valor !== null && !isNaN(c.valor) && c.valor > H + 1e-9);
  if (invalidas.length) addErro(r, "valores", `${invalidas.length} leitura(s) que não são número: ${listarCelulas(invalidas)}.`);
  if (negativas.length) addErro(r, "valores", `${negativas.length} leitura(s) negativa(s): ${listarCelulas(negativas)}. Espessura negativa não existe — corrija ou apague.`);
  if (acima.length) {
    const alt = `${H!.toLocaleString("pt-BR")} ${un}`;
    if (e.refMode === "top" || !e.refMode) {
      addErro(r, "valores", `${acima.length} leitura(s) maior(es) que a altura do tanque (${alt}) com referência no topo — ficaria abaixo do fundo: ${listarCelulas(acima)}.`);
    } else {
      addAviso(r, "valores", `${acima.length} leitura(s) de sedimento acima da altura do tanque (${alt}) — o medidor limita à altura: ${listarCelulas(acima)}.`);
    }
  }

  diferencasTanque(e, opts.tanque).forEach((d) => {
    if (d.campo === "formato") {
      addAviso(r, "tanque", `Formato do medidor diferente do cadastro da OS (${opts.tanque!.formato}).`);
    } else {
      addAviso(r, "tanque", `${d.rotulo} no medidor (${fmtM(d.medido)}) difere mais de 5% do cadastro (${fmtM(d.cadastro)}).`);
    }
  });
  return r;
}

// ── Chave canônica (duplicidade) ───────────────────────────────────────────

/** JSON com chaves em ordem — a ordem dos campos não muda a chave. */
export function jsonCanonico(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(",")}}`;
}

/** Valor normalizado: número-texto vira número ("0,26" = 0.26), vazio vira null. */
function normalizarValor(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizarValor);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = normalizarValor(x);
    return o;
  }
  if (typeof v === "string" || typeof v === "number") {
    const n = lerLeitura(v);
    if (n === null) return null;
    return isNaN(n) ? String(v).trim() : n;
  }
  return v ?? null;
}

/** Só os campos que mudam o resultado da medição. Cabeçalho do relatório
 * (data, responsável, local), robô, previsão e o resultado calculado ficam
 * de fora — salvar a mesma medição com outro cabeçalho é duplicata. */
export function chaveMedicao(e: EstadoMedidor | null | undefined): string | null {
  if (!medicaoPreenchida(e)) return null;
  const s = e as EstadoMedidor;
  const formato = s.formato || "circulo";
  const bat = s.batimetria === "nao" ? "nao" : "sim";
  const linhas = Math.max(0, parseInt(s.rows, 10) || 0);
  const colunas = Math.max(0, parseInt(s.cols, 10) || 0);
  const valores: unknown[][] = Array.isArray(s.values) ? s.values : [];
  const c: Record<string, unknown> = {
    unit: s.unit === "cm" ? "cm" : "m",
    formato,
    dimValue: s.dimValue,
    height: s.height,
    refMode: s.refMode || "top",
    batimetria: bat,
    colunas: s.colunas || [],
  };
  if (formato === "circulo") c.inputMode = s.inputMode === "radius" ? "radius" : "diameter";
  if (formato === "retangulo") c.largura = s.largura;
  if (formato === "ngon") c.ngonLados = s.ngonLados;
  if (formato === "custom") c.vertices = String(s.vertices || "").replace(/\s+/g, "");
  if (bat === "nao") {
    c.rangeMin = s.rangeMin;
    c.rangeMax = s.rangeMax;
  } else {
    c.gridMode = s.gridMode || "rect";
    c.rows = linhas;
    c.cols = colunas;
    c.values = Array.from({ length: linhas }, (_, i) =>
      Array.from({ length: colunas }, (_, j) => (Array.isArray(valores[i]) ? valores[i][j] ?? null : null)));
    if (s.gridMode === "radial") {
      c.anchorValue = s.anchorValue;
      c.fanHours = s.fanHours;
      c.fanSpacing = s.fanSpacing;
    }
  }
  return jsonCanonico(normalizarValor(c));
}
