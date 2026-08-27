/**
 * ASP — Cadastro do tanque da inspeção.
 *
 * Dimensões, capacidade e material são dados de CADASTRO: entram uma vez, na
 * criação da inspeção (dentro do projeto), e alimentam o tópico "Identificação
 * do tanque" de todo relatório gerado depois. Antes disso eram redigitados a
 * cada relatório, o que fazia o mesmo tanque sair com medidas diferentes de um
 * documento para o outro.
 *
 * Moram em `gp_inspecoes.tanque` (jsonb). Comprimentos em METROS e capacidade
 * em M³ — as duas unidades em que o relatório apresenta esses valores.
 */

export type FormatoTanque = "circular" | "retangular";

export interface Tanque {
  formato: FormatoTanque;
  /** Circular: diâmetro, em metros. */
  diametro?: number | null;
  /** Retangular: comprimento e largura, em metros. */
  comprimento?: number | null;
  largura?: number | null;
  /** Altura, em metros — vale para os dois formatos. */
  altura: number;
  /** Capacidade nominal (dado de placa), em m³. */
  capacidade: number;
  material: string;
}

/** O mesmo tanque como o formulário o carrega: tudo texto, nada convertido. */
export interface TanqueForm {
  formato: FormatoTanque;
  diametro: string;
  comprimento: string;
  largura: string;
  altura: string;
  capacidade: string;
  material: string;
}

export const TANQUE_FORM_VAZIO: TanqueForm = {
  formato: "circular",
  diametro: "",
  comprimento: "",
  largura: "",
  altura: "",
  capacidade: "",
  material: "",
};

/** Número a partir do que o usuário digitou. Aceita vírgula decimal. */
function numero(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

const positivo = (v: unknown) => {
  const n = numero(v);
  return n !== null && n > 0 ? n : null;
};

/** Formato válido; qualquer coisa fora da lista vira circular. */
function formatoDe(v: unknown): FormatoTanque {
  return v === "retangular" ? "retangular" : "circular";
}

/** Mensagem do primeiro problema encontrado, ou null se o cadastro está bom.
 *  Usada no formulário e repetida na API — a regra é a mesma dos dois lados. */
export function erroDoTanque(bruto: unknown): string | null {
  const t = (bruto || {}) as Partial<TanqueForm & Tanque>;
  if (formatoDe(t.formato) === "circular") {
    if (!positivo(t.diametro)) return "Informe o diâmetro do tanque (m).";
  } else {
    if (!positivo(t.comprimento)) return "Informe o comprimento do tanque (m).";
    if (!positivo(t.largura)) return "Informe a largura do tanque (m).";
  }
  if (!positivo(t.altura)) return "Informe a altura do tanque (m).";
  if (!positivo(t.capacidade)) return "Informe a capacidade nominal do tanque (m³).";
  if (!String(t.material ?? "").trim()) return "Escolha o material do tanque.";
  return null;
}

/** Converte para o formato guardado no banco. Só chame com o cadastro válido
 *  (`erroDoTanque` retornando null) — as medidas do outro formato viram null,
 *  para o registro não guardar diâmetro de tanque retangular e vice-versa. */
export function normalizarTanque(bruto: unknown): Tanque {
  const t = (bruto || {}) as Partial<TanqueForm & Tanque>;
  const formato = formatoDe(t.formato);
  return {
    formato,
    diametro: formato === "circular" ? positivo(t.diametro) : null,
    comprimento: formato === "retangular" ? positivo(t.comprimento) : null,
    largura: formato === "retangular" ? positivo(t.largura) : null,
    altura: positivo(t.altura) as number,
    capacidade: positivo(t.capacidade) as number,
    material: String(t.material ?? "").trim(),
  };
}

/** Cadastro salvo → estado do formulário (edição). */
export function tanqueParaForm(t?: Tanque | null): TanqueForm {
  if (!t) return { ...TANQUE_FORM_VAZIO };
  const texto = (v: number | null | undefined) =>
    v == null ? "" : String(v).replace(".", ",");
  return {
    formato: formatoDe(t.formato),
    diametro: texto(t.diametro),
    comprimento: texto(t.comprimento),
    largura: texto(t.largura),
    altura: texto(t.altura),
    capacidade: texto(t.capacidade),
    material: t.material || "",
  };
}

const fmt = (v: number, casas: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Comprimento como o relatório mostra: "12,50 m". */
export function medida(v?: number | null): string {
  return v == null ? "" : `${fmt(v, 2)} m`;
}

/** Volume como o relatório mostra: "1.500 m³". */
export function volume(v?: number | null): string {
  return v == null ? "" : `${fmt(v, Number.isInteger(v) ? 0 : 2)} m³`;
}

/** Linha única para a tela: "Circular · Ø 12,50 m × 8,00 m de altura · 1.500 m³ · Aço carbono". */
export function resumoTanque(t?: Tanque | null): string {
  if (!t) return "";
  const dim = t.formato === "circular"
    ? `Ø ${medida(t.diametro)}`
    : `${medida(t.comprimento)} × ${medida(t.largura)}`;
  const partes = [
    t.formato === "circular" ? "Circular" : "Retangular",
    `${dim} × ${medida(t.altura)} de altura`,
    volume(t.capacidade),
    t.material,
  ];
  return partes.filter(Boolean).join(" · ");
}

/** Campos do relatório que o cadastro do tanque já responde. O que a medição
 *  em campo mede (altura e diâmetro reais) continua tendo a última palavra —
 *  aqui vai o que está em cadastro, como ponto de partida do formulário. */
export function dadosRelatorioDoTanque(t?: Tanque | null): {
  material: string; capacidadeNominal: string; alturaTanque: string;
  diametro: string; comprimento: string; largura: string;
} {
  if (!t) return { material: "", capacidadeNominal: "", alturaTanque: "", diametro: "", comprimento: "", largura: "" };
  return {
    material: t.material || "",
    capacidadeNominal: volume(t.capacidade),
    alturaTanque: medida(t.altura),
    diametro: t.formato === "circular" ? medida(t.diametro) : "",
    comprimento: t.formato === "retangular" ? medida(t.comprimento) : "",
    largura: t.formato === "retangular" ? medida(t.largura) : "",
  };
}
