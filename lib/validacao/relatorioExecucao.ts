/** Fase 8 — o RELATÓRIO DE EXECUÇÃO: o que é próprio dele, além das regras
 * gerais do relatório (relatorio.ts, Fase 4) e da aprovação (aprovacao.ts).
 * Puro: o formulário (GerarRelatorio), a página da OS e a API usam as mesmas
 * funções.
 *
 *   pH / cloro antes e depois (modal "Valores das coletas e do laudo")
 *     ⛔ número (pH 0–14, cloro ≥ 0) — rascunho antigo em texto é convertido
 *     ⚠️ diferente da coleta de fotos · diferente do RDO (mesma OS e
 *        momento) · cloro abaixo de 0,2 (CVS 6) ou acima do limite do
 *        procedimento
 *   Operação
 *     ⚠️ data fora do período da execução · data sem RDO da OS · dias do
 *        período sem RDO · equipe do relatório × equipe dos RDOs
 *   Laudo de laboratório
 *     ⛔ célula que não é número nem <LQ, ND, Ausente, Presente (P/A só com
 *        Ausente/Presente) · LD maior que LQ · PDF do laudo ausente ao ENVIAR
 *        para aprovação (o rascunho pode ser salvo sem ele)
 *     ⚠️ incerteza maior que o valor · valor fora do limite (e não citado na
 *        conclusão) · laudo ANTES idêntico ao DEPOIS */
import { addAviso, addErro, novoResultado, type ResultadoValidacao } from "./resultado";
import { normalizarNome, normalizarTexto } from "./texto";
import { dataIsoValida } from "./formatos";
import { contemDia, textoPeriodoLongo, type Periodo } from "./periodo";
import { diasSemRdo, textoDiasSemRdo } from "./execucao";
import { ehLimpezaRobotizada, LAUDO_COLUNAS, LAUDO_PARAMETROS, type DadosRelatorio } from "../asp/relatorio";
import { numeroBr, valorDoSlot, type RegistroFotosExecucao, type UnidadeCloro } from "../asp/fotos-execucao";
import { CLORO_MINIMO, semFraseCloro, type AtividadeRdo, type MembroRdo } from "../asp/rdo";

// ── Números em pt-BR ─────────────────────────────────────────────────────────

/** Número digitado em pt-BR: "7,2", "1.234,5", "0,005". Sem vírgula, um
 *  ponto é decimal ("7.2", "0.005") — exceto quando separa milhar ("1.500",
 *  "12.000.000"). Qualquer outro texto → null. */
export function lerNumeroBr(s: string | null | undefined): number | null {
  const t = (s || "").trim().replace(/\s+/g, "");
  if (!t) return null;
  let norm: string;
  if (/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t) || /^[+-]?\d+(,\d+)?$/.test(t)) {
    norm = t.replace(/\./g, "").replace(",", ".");
    // "0.005" / "7.250": com zero à esquerda o ponto é decimal
    if (/^[+-]?0\.\d{3}$/.test(t)) norm = t;
  } else if (/^[+-]?\d*\.\d+$/.test(t)) {
    norm = t;
  } else return null;
  const n = Number(norm);
  return isFinite(n) ? n : null;
}

/** 7.25 → "7,25" (sem separador de milhar — é valor de laboratório). */
export function textoNumeroBr(n: number): string {
  return String(Math.round(n * 1e6) / 1e6).replace(".", ",");
}

// ── pH e cloro ───────────────────────────────────────────────────────────────

export const CAMPOS_PH_CLORO = ["phAntes", "cloroAntes", "phDepois", "cloroDepois"] as const;
export type CampoPhCloro = (typeof CAMPOS_PH_CLORO)[number];

export const ROTULOS_PH_CLORO: Record<CampoPhCloro, string> = {
  phAntes: "pH antes", cloroAntes: "Cloro livre antes", phDepois: "pH depois", cloroDepois: "Cloro livre depois",
};

/** Vaga da coleta de fotos de onde vem o valor de cada campo. */
export const SLOT_PH_CLORO: Record<CampoPhCloro, string> = {
  phAntes: "agua_antes_ph", cloroAntes: "agua_antes_cloro", phDepois: "agua_depois_ph", cloroDepois: "agua_depois_cloro",
};

const ehCloro = (k: CampoPhCloro) => k.startsWith("cloro");
const momentoDe = (k: CampoPhCloro): "antes" | "depois" => (k.endsWith("Antes") ? "antes" : "depois");

/** Valor medido (pH/cloro) aceitando o texto dos rascunhos antigos, que
 *  traziam a unidade junto: "0,5 mg/L", "0,3 PPM", "pH 7,2". */
export function lerValorMedido(s: string | null | undefined): number | null {
  const t = (s || "").trim().replace(/^ph\s*:?\s*/i, "").replace(/\s*(mg\s*\/\s*l|ppm)\.?$/i, "");
  return lerNumeroBr(t);
}

/** Rascunho antigo (pH/cloro em texto livre) → número em pt-BR. O que não dá
 *  para ler fica vazio, com o aviso do valor que se perdeu. */
export function converterPhCloroLegado(d: Partial<DadosRelatorio>): { d: Partial<DadosRelatorio>; avisos: string[] } {
  const out: Partial<DadosRelatorio> = { ...d };
  const avisos: string[] = [];
  for (const k of CAMPOS_PH_CLORO) {
    const v = (d[k] || "").trim();
    if (!v) continue;
    const n = lerValorMedido(v);
    if (n === null) {
      out[k] = "";
      avisos.push(`${ROTULOS_PH_CLORO[k]}: o valor do rascunho (“${v}”) não é um número — o campo ficou em branco; digite de novo.`);
    } else out[k] = textoNumeroBr(n);
  }
  return { d: out, avisos };
}

/** Valor do campo para o documento: cloro sai com a unidade do procedimento. */
export function textoPhCloroDoc(k: CampoPhCloro, v: string | null | undefined, unidade: UnidadeCloro): string {
  const n = lerValorMedido(v);
  if (n === null) return (v || "").trim();
  return ehCloro(k) ? `${textoNumeroBr(n)} ${unidade}` : textoNumeroBr(n);
}

// ── Laudo de laboratório ─────────────────────────────────────────────────────

/** Fonte dos limites pré-preenchidos (o usuário pode editar a célula). */
export const FONTE_PORTARIA_888 = "Portaria GM/MS nº 888/2021";

export interface LimitePortaria {
  /** Igual a LAUDO_PARAMETROS[i]. */
  parametro: string;
  /** Texto que vai na coluna "Limite". */
  limite: string;
  /** "max" = valor numérico máximo; "pa" = presença/ausência. */
  tipo: "max" | "pa";
  /** Como a frase da conclusão chama o limite. */
  rotulo: string;
}

/** Limites do padrão de potabilidade — Portaria GM/MS nº 888, de 4 de maio de
 *  2021 (altera o Anexo XX da Portaria de Consolidação GM/MS nº 5/2017):
 *   · Cor aparente: VMP 15 uH (uH ≈ mg Pt-Co/L) — padrão organoléptico.
 *   · Turbidez: VMP 5 uT (uT ≈ NTU) — padrão organoléptico (sistema de
 *     distribuição / reservatório).
 *   · Coliformes totais e Escherichia coli: ausência em 100 mL — padrão
 *     microbiológico.
 *   · Bactérias heterotróficas: 500 UFC/mL — valor de referência (não é VMP).
 *  Na mesma ordem de LAUDO_PARAMETROS. CONFIRMAR com o responsável técnico. */
export const LIMITES_PORTARIA_888: LimitePortaria[] = [
  { parametro: LAUDO_PARAMETROS[0], limite: "15", tipo: "max", rotulo: "valor máximo permitido" },
  { parametro: LAUDO_PARAMETROS[1], limite: "5", tipo: "max", rotulo: "valor máximo permitido" },
  { parametro: LAUDO_PARAMETROS[2], limite: "Ausente", tipo: "pa", rotulo: "ausência em 100 mL" },
  { parametro: LAUDO_PARAMETROS[3], limite: "Ausente", tipo: "pa", rotulo: "ausência em 100 mL" },
  { parametro: LAUDO_PARAMETROS[4], limite: "500", tipo: "max", rotulo: "valor de referência" },
];

export const COL_VALOR = 0, COL_INCERTEZA = 1, COL_LQ = 2, COL_LD = 3, COL_LIMITE = 4;

/** "Turbidez (NTU)" → { nome: "Turbidez", unidade: "NTU", pa: false }. */
export function infoParametro(i: number): { nome: string; unidade: string; pa: boolean } {
  const p = LAUDO_PARAMETROS[i] || "";
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(p);
  const nome = (m ? m[1] : p).trim();
  const unidade = m ? m[2].trim() : "";
  const pa = unidade.toUpperCase() === "P/A";
  return { nome, unidade: pa ? "" : unidade, pa };
}

/** "-" = parâmetro não analisado (como o laboratório escreve no laudo). */
export const TOKENS_LAUDO = ["<LQ", "ND", "Ausente", "Presente", "-"] as const;
export type TokenLaudo = (typeof TOKENS_LAUDO)[number];

export type CelulaLaudo =
  | { tipo: "vazio" }
  | { tipo: "numero"; n: number }
  /** "<2,50" — abaixo do limite de quantificação do laboratório, escrito
   *  como no laudo. `texto` guarda os dígitos como vieram ("2,50"). */
  | { tipo: "menor"; n: number; texto: string }
  | { tipo: "token"; token: TokenLaudo }
  | { tipo: "invalido" };

function tokenDe(s: string): TokenLaudo | null {
  const k = normalizarTexto(s).replace(/[\s.]/g, "");
  if (k === "<lq") return "<LQ";
  if (k === "nd") return "ND";
  if (k === "ausente" || k === "ausencia") return "Ausente";
  if (k === "presente" || k === "presenca") return "Presente";
  if (k === "-" || k === "—" || k === "na" || k === "naoanalisado") return "-";
  return null;
}

/** Uma célula do laudo: número (pt-BR), "<número" (abaixo do LQ, como o
 *  laboratório escreve), <LQ, ND, Ausente, Presente ou "-" (não analisado),
 *  sem diferença de caixa e acento. */
export function lerCelulaLaudo(s: string | null | undefined): CelulaLaudo {
  const t = (s || "").trim();
  if (!t) return { tipo: "vazio" };
  const tok = tokenDe(t);
  if (tok) return { tipo: "token", token: tok };
  const menor = /^<\s*(.+)$/.exec(t);
  if (menor) {
    const n = lerNumeroBr(menor[1]);
    return n === null ? { tipo: "invalido" } : { tipo: "menor", n, texto: menor[1].trim().replace(".", ",") };
  }
  const n = lerNumeroBr(t);
  return n === null ? { tipo: "invalido" } : { tipo: "numero", n };
}

/** Texto da célula como fica no documento: "ausente" → "Ausente", "<lq" →
 *  "<LQ", "7.2" → "7,2", "< 2.50" → "<2,50" (casas como no laudo), "na" →
 *  "-". Inválido fica como foi digitado. */
export function normalizarCelulaLaudo(s: string | null | undefined): string {
  const c = lerCelulaLaudo(s);
  if (c.tipo === "token") return c.token;
  if (c.tipo === "numero") return numeroComoVeio((s || "").trim().replace(/\s+/g, ""), c.n);
  if (c.tipo === "menor") return `<${c.texto}`;
  return (s || "").trim();
}

/** Número do laudo com as casas como o laboratório escreveu: "2,60" não
 *  vira "2,6" (o relatório não pode divergir do laudo assinado). Ponto
 *  decimal vira vírgula; ponto de milhar ("1.200") fica. */
function numeroComoVeio(t: string, n: number): string {
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) return t;          // 1.200 / 1.200,5
  if (/^\d+\.\d+$/.test(t)) return t.replace(".", ",");              // 2.60 → 2,60
  if (/^\d+(,\d+)?$/.test(t)) return t;                              // 2,60 / 15
  return textoNumeroBr(n);
}

/** Duas células iguais no valor: número compara como número ("15" = "15,0",
 *  "2,6" = "2,60"); o resto, pelo texto normalizado. */
export function celulasIguais(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = lerCelulaLaudo(a), y = lerCelulaLaudo(b);
  if ((x.tipo === "numero" || x.tipo === "menor") && x.tipo === y.tipo) return x.n === (y as { n: number }).n;
  return normalizarCelulaLaudo(a) === normalizarCelulaLaudo(b);
}

/** Grade completa (parâmetros × colunas), sem buraco. */
export function gradeLaudo(g: string[][] | null | undefined): string[][] {
  return LAUDO_PARAMETROS.map((_, i) => LAUDO_COLUNAS.map((__, j) => (g?.[i]?.[j] ?? "") + ""));
}

/** Coluna "Limite" vazia → o limite da Portaria 888. O resto fica. */
export function preencherLimitesPadrao(g: string[][] | null | undefined): string[][] {
  const out = gradeLaudo(g);
  LIMITES_PORTARIA_888.forEach((l, i) => { if (!out[i][COL_LIMITE].trim()) out[i][COL_LIMITE] = l.limite; });
  return out;
}

export type ChaveLaudo = "laudoAntes" | "laudoDepois";
export const MOMENTO_LAUDO: Record<ChaveLaudo, string> = {
  laudoAntes: "na amostra coletada antes da limpeza", laudoDepois: "na amostra coletada após a limpeza",
};
const TITULO_LAUDO: Record<ChaveLaudo, string> = { laudoAntes: "Laudo antes", laudoDepois: "Laudo depois" };

export interface ForaDoLimite {
  chave: ChaveLaudo;
  linha: number;
  nome: string;
  unidade: string;
  pa: boolean;
  valor: string;
  limite: string;
  /** O limite da célula é o da Portaria 888 (a frase cita a portaria). */
  daPortaria: boolean;
}

/** Parâmetros com valor fora do limite da própria linha: número acima do
 *  limite numérico; P/A com "Presente". */
export function foraDoLimite(chave: ChaveLaudo, g: string[][] | null | undefined): ForaDoLimite[] {
  if (!g) return [];
  const grade = gradeLaudo(g);
  const out: ForaDoLimite[] = [];
  grade.forEach((linha, i) => {
    const info = infoParametro(i);
    const v = lerCelulaLaudo(linha[COL_VALOR]);
    const lim = lerCelulaLaudo(linha[COL_LIMITE]);
    let fora = false;
    if (info.pa) fora = v.tipo === "token" && v.token === "Presente";
    else fora = v.tipo === "numero" && lim.tipo === "numero" && v.n > lim.n;
    if (!fora) return;
    const portaria = LIMITES_PORTARIA_888[i];
    out.push({
      chave, linha: i, nome: info.nome, unidade: info.unidade, pa: info.pa,
      valor: normalizarCelulaLaudo(linha[COL_VALOR]), limite: normalizarCelulaLaudo(linha[COL_LIMITE]),
      daPortaria: !!portaria && normalizarCelulaLaudo(portaria.limite) === normalizarCelulaLaudo(linha[COL_LIMITE] || portaria.limite),
    });
  });
  return out;
}

/** Frase para a Conclusão, por parâmetro fora do limite. */
export function fraseForaDoLimite(f: ForaDoLimite): string {
  const onde = MOMENTO_LAUDO[f.chave];
  const fonte = f.daPortaria ? ` (${FONTE_PORTARIA_888})` : " (limite informado no laudo)";
  if (f.pa) {
    return `O parâmetro ${f.nome} apresentou resultado Presente ${onde}, em desacordo com o padrão de ausência em 100 mL${fonte}.`;
  }
  const u = f.unidade ? ` ${f.unidade}` : "";
  const rot = LIMITES_PORTARIA_888[f.linha]?.rotulo || "valor máximo permitido";
  return `O parâmetro ${f.nome} apresentou ${f.valor}${u} ${onde}, acima do ${rot} de ${f.limite}${u}${fonte}.`;
}

/** Texto do HTML do editor (sem tags), para procurar o nome do parâmetro. */
function textoDoHtml(html: string | null | undefined): string {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** Parâmetros fora do limite que nenhuma das conclusões (a geral e a das
 *  Análises Laboratoriais) cita COMO fora: a frase precisa ter o nome e uma
 *  palavra de desacordo — "Coliformes Totais ausentes" não conta. */
export function foraNaoCitados(itens: ForaDoLimite[], ...conclusoes: (string | null | undefined)[]): ForaDoLimite[] {
  const frases = conclusoes.map(textoDoHtml).join("\n")
    .split(/(?<=[.!?;])\s+|\n+/).map((f) => normalizarTexto(f));
  const desacordo = /(acima|fora d|exced|ultrapass|superior|nao atende|desacordo|presen)/;
  // "Não houve presença de contaminação (… ausentes)", "sem presença", "não
  // apresentaram resultado acima" — negam o desacordo: é justamente a frase
  // falsa que o aviso precisa pegar.
  const negado = /(\bnao\b|\bsem\b)[^.;:]{0,60}(presen|acima|fora d|exced|ultrapass|superior|desacordo)|\bausente/;
  return itens.filter((f) => {
    const nome = normalizarTexto(f.nome);
    return !frases.some((fr) => fr.includes(nome) && desacordo.test(fr) && !negado.test(fr));
  });
}

/** "<20" com limite 15: o resultado não permite afirmar que atende. */
export function semConclusaoNoLimite(g: string[][] | null | undefined): { linha: number; nome: string; valor: string; limite: string }[] {
  if (!g) return [];
  return gradeLaudo(g).flatMap((l, i) => {
    const v = lerCelulaLaudo(l[COL_VALOR]), lim = lerCelulaLaudo(l[COL_LIMITE]);
    return v.tipo === "menor" && lim.tipo === "numero" && v.n > lim.n
      ? [{ linha: i, nome: infoParametro(i).nome, valor: normalizarCelulaLaudo(l[COL_VALOR]), limite: normalizarCelulaLaudo(l[COL_LIMITE]) }]
      : [];
  });
}

/** Parágrafos a acrescentar na Conclusão (HTML do editor), sem repetir
 *  frase que já está lá. */
export function sugestaoConclusao(itens: ForaDoLimite[], conclusao: string | null | undefined): string {
  const atual = normalizarTexto(textoDoHtml(conclusao));
  return itens.map(fraseForaDoLimite)
    .filter((f) => !atual.includes(normalizarTexto(f)))
    .map((f) => `<p>${f.replace(/</g, "&lt;")}</p>`).join("");
}

/** Cloro livre: máximo permitido (Portaria GM/MS nº 888/2021, Anexo 9). */
export const CLORO_MAXIMO = 5;
/** pH recomendado no sistema de distribuição (Portaria GM/MS nº 888/2021). */
export const PH_FAIXA = { min: 6, max: 9 } as const;

/**
 * Texto sugerido para a "Conclusão das Análises Laboratoriais" (HTML do
 * editor), a partir dos valores medidos — o técnico revisa antes de gerar.
 * Regra: só afirma o que os dados sustentam, sempre dizendo de QUAL amostra
 * (antes/após) fala.
 *   • cloro livre × mínimo 0,2 e máximo 5; pH × faixa 6,0–9,0;
 *   • laudo, por amostra: fora do limite; "<x" acima do limite (sem como
 *     afirmar); não analisados ("-"); sem resultado; o que ficou dentro;
 *   • "dentro dos padrões" no fim só com o laudo de após completo e conforme.
 * Sem nenhum valor preenchido, devolve "".
 */
export function sugestaoConclusaoAnalises(d: {
  cloroAntes?: string | null; cloroDepois?: string | null;
  phAntes?: string | null; phDepois?: string | null;
  laudoAntes?: string[][] | null; laudoDepois?: string[][] | null;
}, unidade: UnidadeCloro): string {
  const frases: string[] = [];
  const n = (v: number) => `${textoNumeroBr(v)} ${unidade}`;
  const ref = "referência: Portaria GM/MS nº 888/2021";

  // Cloro livre
  const ca = lerValorMedido(d.cloroAntes), cd = lerValorMedido(d.cloroDepois);
  const sit = (v: number) => (v < CLORO_MINIMO ? "abaixo" : v > CLORO_MAXIMO ? "acima" : "ok");
  const desc = (x: string) => x === "abaixo" ? `abaixo do mínimo de 0,2 ${unidade}`
    : x === "acima" ? `acima do máximo de ${CLORO_MAXIMO} ${unidade}` : `dentro da faixa de 0,2 a ${CLORO_MAXIMO} ${unidade}`;
  if (ca !== null && cd !== null) {
    const a = sit(ca), b = sit(cd);
    if (a === b) frases.push(`Tanto antes quanto após a operação de limpeza, o cloro livre esteve ${desc(a)} (${n(ca)} antes e ${n(cd)} após a limpeza; ${ref}).`);
    else frases.push(`O cloro livre estava ${desc(a)} antes da limpeza (${n(ca)}) e ${b === "ok" ? `passou a ficar ${desc(b)}` : `ficou ${desc(b)}`} após a operação (${n(cd)}; ${ref}).`);
  } else if (ca !== null) {
    frases.push(`Antes da limpeza, o cloro livre medido foi de ${n(ca)}, ${desc(sit(ca))} (${ref}).`);
  } else if (cd !== null) {
    frases.push(`Após a limpeza, o cloro livre medido foi de ${n(cd)}, ${desc(sit(cd))} (${ref}).`);
  }

  // pH fora da faixa recomendada
  const pa_ = lerValorMedido(d.phAntes), pd = lerValorMedido(d.phDepois);
  const foraPh = (v: number | null) => v !== null && (v < PH_FAIXA.min || v > PH_FAIXA.max);
  const faixa = "da faixa de 6,0 a 9,0 recomendada pela Portaria GM/MS nº 888/2021";
  if (foraPh(pa_) && foraPh(pd)) frases.push(`O pH ficou fora ${faixa} antes (${textoNumeroBr(pa_!)}) e após (${textoNumeroBr(pd!)}) a limpeza.`);
  else if (foraPh(pa_)) frases.push(`O pH medido antes da limpeza (${textoNumeroBr(pa_!)}) ficou fora ${faixa}.`);
  else if (foraPh(pd)) frases.push(`O pH medido após a limpeza (${textoNumeroBr(pd!)}) ficou fora ${faixa}.`);

  // Laudo, amostra por amostra
  type Estado = {
    chave: ChaveLaudo; fora: ForaDoLimite[]; inconclusivos: ReturnType<typeof semConclusaoNoLimite>;
    naoAnalisados: string[]; semResultado: string[]; semLimite: string[]; dentro: number; paAusente: boolean;
  };
  const estado = (chave: ChaveLaudo): Estado | null => {
    const g = d[chave];
    if (!g || !gradeLaudo(g).some((l) => l[COL_VALOR].trim())) return null;
    const grade = gradeLaudo(g);
    const fora = foraDoLimite(chave, g), inconclusivos = semConclusaoNoLimite(g);
    const e: Estado = { chave, fora, inconclusivos, naoAnalisados: [], semResultado: [], semLimite: [], dentro: 0, paAusente: true };
    grade.forEach((l, i) => {
      const info = infoParametro(i);
      const v = lerCelulaLaudo(l[COL_VALOR]), lim = lerCelulaLaudo(l[COL_LIMITE]);
      if (info.pa && !(v.tipo === "token" && v.token === "Ausente")) e.paAusente = false;
      if (v.tipo === "vazio") { e.semResultado.push(info.nome); return; }
      if (v.tipo === "token" && v.token === "-") { e.naoAnalisados.push(info.nome); return; }
      if (fora.some((f) => f.linha === i) || inconclusivos.some((x) => x.linha === i)) return;
      if (!info.pa && lim.tipo !== "numero") { e.semLimite.push(info.nome); return; }
      e.dentro++;
    });
    return e;
  };
  const momento = (c: ChaveLaudo) => (c === "laudoAntes" ? "antes da limpeza" : "após a limpeza");
  const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : xs[0]);
  const ant = estado("laudoAntes"), dep = estado("laudoDepois");
  const presentes = [ant, dep].filter((x): x is Estado => !!x);
  if (presentes.length) {
    // Por amostra, na ordem antes → após: o que ficou fora, o inconclusivo e
    // o que ficou dentro. "Os demais" sempre que alguma linha da amostra não
    // entra na afirmação (fora, inconclusiva ou sem limite).
    const portaria = "dos limites da Portaria GM/MS nº 888/2021";
    const ressalva = (e: Estado) => e.fora.length > 0 || e.inconclusivos.length > 0 || e.semLimite.length > 0;
    const juntas = presentes.length === 2 && presentes.every((e) => !ressalva(e) && e.dentro > 0);
    if (juntas) frases.push(`Os parâmetros analisados em laboratório ficaram dentro ${portaria} nas amostras coletadas antes e após a limpeza.`);
    for (const e of presentes) {
      e.fora.forEach((f) => frases.push(fraseForaDoLimite(f)));
      e.inconclusivos.forEach((x) =>
        frases.push(`Na amostra coletada ${momento(e.chave)}, o resultado de ${x.nome} (${x.valor}) não permite confirmar o atendimento ao limite de ${x.limite}.`));
      if (!juntas && e.dentro > 0) {
        frases.push(`${ressalva(e) ? "Os demais parâmetros" : "Os parâmetros"} analisados na amostra coletada ${momento(e.chave)} ficaram dentro ${portaria}.`);
      }
    }
    for (const e of presentes) {
      if (e.naoAnalisados.length) frases.push(`Não foram analisados na amostra coletada ${momento(e.chave)}: ${lista(e.naoAnalisados)}.`);
      if (e.semResultado.length) frases.push(`Sem resultado informado na amostra coletada ${momento(e.chave)}: ${lista(e.semResultado)}.`);
      if (e.semLimite.length) frases.push(`Sem limite de referência para ${lista(e.semLimite)} na amostra coletada ${momento(e.chave)} — o resultado não foi comparado.`);
    }
    // microbiologia: só afirma ausência onde as duas P/A estão Ausente
    const semMicro = presentes.filter((e) => e.paAusente);
    if (semMicro.length === 2) frases.push("Não houve presença de contaminação microbiológica (coliformes totais e Escherichia coli ausentes) antes e após a limpeza.");
    else if (semMicro.length === 1) frases.push(`Não houve presença de contaminação microbiológica (coliformes totais e Escherichia coli ausentes) na amostra coletada ${momento(semMicro[0].chave)}.`);
    // fecho: só com o laudo de APÓS
    if (dep) {
      const completo = !dep.naoAnalisados.length && !dep.semResultado.length && !dep.semLimite.length && !dep.inconclusivos.length;
      if (dep.fora.length) {
        frases.push(`Após a limpeza, a amostra não atende à Portaria GM/MS nº 888/2021 em: ${lista(Array.from(new Set(dep.fora.map((f) => f.nome))))}. Recomenda-se investigar a causa e repetir a análise.`);
      } else if (completo) {
        if (ant && (ant.fora.length || ant.inconclusivos.length)) frases.push("Após a limpeza, todos os parâmetros analisados passaram a atender aos padrões da Portaria GM/MS nº 888/2021.");
        else if (ant) frases.push("A limpeza contribuiu para a remoção de sedimentos, mantendo a água dentro dos padrões analisados.");
        else frases.push("Após a limpeza, a água atendeu aos padrões analisados.");
      }
    }
  }
  return frases.map((f) => `<p>${f.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
}

/** ANTES idêntico ao DEPOIS: todas as células preenchidas (fora a coluna
 *  Limite, que já vem preenchida) iguais, e ao menos uma preenchida. */
export function laudosIdenticos(a: string[][] | null | undefined, b: string[][] | null | undefined): boolean {
  if (!a || !b) return false;
  const ga = gradeLaudo(a), gb = gradeLaudo(b);
  let preenchidas = 0;
  for (let i = 0; i < ga.length; i++) {
    for (let j = 0; j < COL_LIMITE; j++) {
      if (!celulasIguais(ga[i][j], gb[i][j])) return false;
      if (normalizarCelulaLaudo(ga[i][j])) preenchidas++;
    }
  }
  return preenchidas > 0;
}

/** ⛔/⚠️ de uma tabela de laudo. Chaves: "laudoAntes.<linha>.<coluna>" para
 *  a célula e "laudoAntes.<linha>" para a linha. */
export function validarLaudo(chave: ChaveLaudo, g: string[][] | null | undefined, r: ResultadoValidacao = novoResultado()): ResultadoValidacao {
  if (!g) return r;
  const grade = gradeLaudo(g);
  grade.forEach((linha, i) => {
    const info = infoParametro(i);
    const cel = linha.map(lerCelulaLaudo);
    cel.forEach((c, j) => {
      const campo = `${chave}.${i}.${j}`;
      const onde = `${TITULO_LAUDO[chave]} — ${info.nome} (${LAUDO_COLUNAS[j]})`;
      if (c.tipo === "invalido") {
        addErro(r, campo, `${onde}: “${linha[j].trim()}” não é um número, “<número” (ex.: <2,50), <LQ, ND, Ausente, Presente nem “-” (não analisado).`);
        return;
      }
      if ((c.tipo === "numero" || c.tipo === "menor") && c.n < 0) { addErro(r, campo, `${onde}: não pode ser negativo.`); return; }
      // "-" (não analisado) vale em qualquer parâmetro e coluna.
      if (c.tipo === "token" && c.token === "-") return;
      const pa = c.tipo === "token" && (c.token === "Ausente" || c.token === "Presente");
      if (info.pa && (j === COL_VALOR || j === COL_LIMITE) && c.tipo !== "vazio" && !pa) {
        addErro(r, campo, `${onde}: parâmetro de presença/ausência — use Ausente, Presente ou “-” (não analisado).`);
      } else if (pa && !info.pa) {
        addErro(r, campo, `${onde}: Ausente/Presente só vale para os parâmetros P/A (coliformes totais, E. coli).`);
      } else if (pa && info.pa && j !== COL_VALOR && j !== COL_LIMITE) {
        addErro(r, campo, `${onde}: Ausente/Presente só nas colunas Valor e Limite.`);
      }
    });
    const lq = cel[COL_LQ], ld = cel[COL_LD], v = cel[COL_VALOR], inc = cel[COL_INCERTEZA];
    if (lq.tipo === "numero" && ld.tipo === "numero" && ld.n > lq.n) {
      addErro(r, `${chave}.${i}.${COL_LD}`, `${TITULO_LAUDO[chave]} — ${info.nome}: o LD (${textoNumeroBr(ld.n)}) não pode ser maior que o LQ (${textoNumeroBr(lq.n)}).`);
    }
    if (inc.tipo === "numero" && v.tipo === "numero" && inc.n > v.n) {
      addAviso(r, `${chave}.${i}`, `${TITULO_LAUDO[chave]} — ${info.nome}: a incerteza (${textoNumeroBr(inc.n)}) é maior que o valor (${textoNumeroBr(v.n)}) — confira.`);
    }
  });
  for (const x of semConclusaoNoLimite(grade)) {
    addAviso(r, `${chave}.${x.linha}`, `${TITULO_LAUDO[chave]} — ${x.nome}: ${x.valor} com limite ${x.limite} — o resultado não permite afirmar que atende; confira com o laboratório.`);
  }
  for (const f of foraDoLimite(chave, grade)) {
    const u = f.unidade ? ` ${f.unidade}` : "";
    addAviso(r, `${chave}.${f.linha}`, f.pa
      ? `${TITULO_LAUDO[chave]} — ${f.nome}: Presente — fora do padrão (ausência em 100 mL).`
      : `${TITULO_LAUDO[chave]} — ${f.nome}: ${f.valor}${u} — acima do limite (${f.limite}${u}).`);
  }
  return r;
}

// ── PDF do laudo ─────────────────────────────────────────────────────────────

/** PDF do laudo do laboratório, referenciado no snapshot do relatório. */
export interface LaudoPdf {
  /** relatorios/<OS>/laudo-<uuid>.pdf */
  caminho: string;
  /** SHA-256 dos bytes (conferido no servidor). */
  hash: string;
  nome: string;
  enviado_em: string;
  enviado_por?: string | null;
  tamanho?: number;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function caminhoLaudoValido(caminho: string | null | undefined, inspecaoId: string): boolean {
  if (!caminho || caminho.includes("..")) return false;
  const p = `relatorios/${inspecaoId}/laudo-`;
  return caminho.startsWith(p) && new RegExp(`^${UUID}\\.pdf$`, "i").test(caminho.slice(p.length));
}

/** O procedimento tem o bloco do laudo — o mesmo critério que mostra a
 *  tabela do laudo no formulário (limpeza robotizada, POP 001). */
export function procedimentoUsaLaudo(proc: { limpeza_robotizada?: unknown; codigo?: unknown } | null | undefined): boolean {
  return ehLimpezaRobotizada(proc);
}

export const MSG_LAUDO_OBRIGATORIO = "Anexe o PDF do laudo do laboratório de ANTES da limpeza — sem ele o relatório de execução não pode ser enviado para aprovação.";
export const MSG_LAUDO_DEPOIS_OBRIGATORIO = "Anexe o PDF do laudo do laboratório de APÓS a limpeza — sem ele o relatório de execução não pode ser enviado para aprovação.";

// ── Validação do formulário ──────────────────────────────────────────────────

/** RDO como a página/API o tem (só o que importa aqui). */
export interface RdoResumo {
  data: string;
  inspecoes?: string[] | null;
  dados?: { equipe?: MembroRdo[] | null; atividades?: AtividadeRdo[] | null } | null;
}

export interface ContextoRelatorioExecucao {
  inspecaoId: string;
  hoje: string;
  unidadeCloro: UnidadeCloro;
  limiteCloro: number;
  /** Procedimento com o bloco do laudo (limpeza robotizada). */
  usaLaudo: boolean;
  /** Envio para aprovação: sem o PDF do laudo é ⛔ (no rascunho, ⚠️). */
  exigirLaudoPdf?: boolean;
  coleta?: RegistroFotosExecucao | null;
  /** RDOs que cobrem a OS; null/undefined = não carregados (sem avisos). */
  rdos?: RdoResumo[] | null;
  periodo?: Periodo | null;
  /** Nomes da equipe marcada no relatório. undefined = não checa. */
  equipeRelatorio?: string[];
}

function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Valores de pH/cloro dos RDOs para esta OS e momento. */
export function valoresRdo(rdos: RdoResumo[] | null | undefined, inspecaoId: string, k: CampoPhCloro): { data: string; valor: number }[] {
  const out: { data: string; valor: number }[] = [];
  for (const rdo of rdos || []) {
    const umaSo = (rdo.inspecoes || []).length <= 1;
    for (const a of rdo.dados?.atividades || []) {
      if (a?.momento !== momentoDe(k)) continue;
      if (a.inspecaoId ? a.inspecaoId !== inspecaoId : !umaSo) continue;
      const v = ehCloro(k) ? a.cloro : a.ph;
      if (v != null && isFinite(Number(v))) out.push({ data: rdo.data, valor: Number(v) });
    }
  }
  return out;
}

/** Mesma pessoa? Nome normalizado igual, ou um contém todas as partes do
 *  outro ("João Silva" × "João da Silva Santos"). */
export function mesmaPessoa(a: string, b: string): boolean {
  const x = normalizarNome(a), y = normalizarNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [menor, maior] = x.length <= y.length ? [x, y] : [y, x];
  const partes = new Set(maior.split(" "));
  const m = menor.split(" ");
  return m.length >= 2 && m.every((p) => partes.has(p));
}

/** Equipe do relatório × equipe dos RDOs do período. */
export function cruzarEquipe(relatorio: string[], rdos: RdoResumo[]): { soNoRelatorio: string[]; soNosRdos: string[] } {
  const nosRdos: string[] = [];
  for (const r of rdos) for (const m of r.dados?.equipe || []) {
    const nome = (m?.nome || "").trim();
    if (nome && !nosRdos.some((n) => mesmaPessoa(n, nome))) nosRdos.push(nome);
  }
  return {
    soNoRelatorio: relatorio.filter((n) => n.trim() && !nosRdos.some((x) => mesmaPessoa(x, n))),
    soNosRdos: nosRdos.filter((n) => !relatorio.some((x) => mesmaPessoa(x, n))),
  };
}

export interface SnapshotExecucao {
  d: Partial<DadosRelatorio>;
  /** PDF do laudo de ANTES da limpeza (versões antigas: o único laudo). */
  laudoPdf?: LaudoPdf | null;
  /** PDF do laudo de APÓS a limpeza. */
  laudoPdfDepois?: LaudoPdf | null;
}

export function validarRelatorioExecucao(s: SnapshotExecucao, ctx: ContextoRelatorioExecucao): ResultadoValidacao {
  const r = novoResultado();
  const d = s.d || {};
  const u = ctx.unidadeCloro;

  // pH e cloro
  for (const k of CAMPOS_PH_CLORO) {
    const bruto = (d[k] || "").trim();
    if (!bruto) continue;
    const n = lerValorMedido(bruto);
    if (n === null) { addErro(r, k, "Digite um número (ex.: 7,2)."); continue; }
    if (!ehCloro(k) && (n < 0 || n > 14)) { addErro(r, k, "pH fora da escala — use um valor de 0 a 14."); continue; }
    if (ehCloro(k) && n < 0) { addErro(r, k, "O cloro não pode ser negativo."); continue; }
    const un = ehCloro(k) ? ` ${u}` : "";
    const c = ctx.coleta ? valorDoSlot(ctx.coleta, SLOT_PH_CLORO[k]) : null;
    if (c != null && Math.abs(c - n) > 1e-9) addAviso(r, k, `Diferente da coleta de fotos (${numeroBr(c)}${un}).`);
    const doRdo = valoresRdo(ctx.rdos, ctx.inspecaoId, k);
    if (doRdo.length && !doRdo.some((x) => Math.abs(x.valor - n) < 1e-9)) {
      addAviso(r, k, `Diferente do RDO — aqui ${textoNumeroBr(n)}${un}; ${doRdo.map((x) => `RDO de ${dataBr(x.data)}: ${textoNumeroBr(x.valor)}${un}`).join("; ")}.`);
    }
    if (!ehCloro(k) && (n < PH_FAIXA.min || n > PH_FAIXA.max)) {
      addAviso(r, k, "Fora da faixa de 6,0 a 9,0 recomendada pela Portaria GM/MS nº 888/2021.");
    }
    if (ehCloro(k)) {
      if (n < CLORO_MINIMO) addAviso(r, k, `Abaixo do mínimo de 0,2 ${u} de cloro livre (Portaria GM/MS nº 888/2021).`);
      else if (n > CLORO_MAXIMO) addAviso(r, k, `Acima do máximo de ${CLORO_MAXIMO} ${u} de cloro livre (Portaria GM/MS nº 888/2021).`);
      else if (n > ctx.limiteCloro) addAviso(r, k, `Acima do limite de aviso do procedimento (${textoNumeroBr(ctx.limiteCloro)} ${u}) — confira o valor.`);
    }
  }

  // Operação: data × período × RDOs
  const dop = (d.dataOperacao || "").trim();
  if (dop && dataIsoValida(dop) && ctx.periodo && !contemDia(ctx.periodo, dop)) {
    addAviso(r, "dataOperacao", `Fora do período da execução (${textoPeriodoLongo(ctx.periodo)}).`);
  }
  if (ctx.rdos) {
    const datas = ctx.rdos.map((x) => (x.data || "").slice(0, 10));
    if (dop && dataIsoValida(dop) && !datas.includes(dop)) {
      addAviso(r, "dataOperacao", `Nenhum RDO desta OS em ${dataBr(dop)}.`);
    }
    const faltam = diasSemRdo(ctx.periodo || null, datas, ctx.hoje, ctx.hoje);
    if (faltam.length) addAviso(r, "rdos", `Dias do período da execução sem RDO desta OS: ${textoDiasSemRdo(faltam)}.`);
    if (ctx.equipeRelatorio) {
      const doPeriodo = ctx.periodo ? ctx.rdos.filter((x) => contemDia(ctx.periodo!, (x.data || "").slice(0, 10))) : ctx.rdos;
      if (doPeriodo.length) {
        const { soNoRelatorio, soNosRdos } = cruzarEquipe(ctx.equipeRelatorio, doPeriodo);
        if (soNoRelatorio.length) addAviso(r, "equipe", `Na equipe do relatório, mas em nenhum RDO do período: ${soNoRelatorio.join(", ")}.`);
        if (soNosRdos.length) addAviso(r, "equipe", `Nos RDOs do período, mas fora da equipe do relatório: ${soNosRdos.join(", ")}.`);
      }
    }
  }

  // Laudo
  const temLaudo = (g?: string[][]) => !!g && g.some((l) => (l || []).some((c, j) => j !== COL_LIMITE && (c || "").trim()));
  validarLaudo("laudoAntes", d.laudoAntes, r);
  validarLaudo("laudoDepois", d.laudoDepois, r);
  if (laudosIdenticos(d.laudoAntes, d.laudoDepois)) {
    addAviso(r, "laudoDepois", "O laudo DEPOIS da limpeza é idêntico ao de ANTES — confira se não foi copiado.");
  }
  const fora = [...foraDoLimite("laudoAntes", d.laudoAntes), ...foraDoLimite("laudoDepois", d.laudoDepois)];
  const naoCitados = foraNaoCitados(fora, d.conclusao, d.conclusaoAnalises);
  if (naoCitados.length) {
    const nomes = Array.from(new Set(naoCitados.map((f) => f.nome)));
    addAviso(r, "conclusao", `Parâmetro(s) fora do limite não citado(s) como fora na Conclusão nem na Conclusão das Análises: ${nomes.join(", ")}. Use “Sugerir texto”.`);
  }
  // Limite: o documento usa o do laudo de DEPOIS (ou o de ANTES, se vazio)
  if (d.laudoAntes && d.laudoDepois) {
    const ga = gradeLaudo(d.laudoAntes), gd = gradeLaudo(d.laudoDepois);
    ga.forEach((l, i) => {
      const a = normalizarCelulaLaudo(l[COL_LIMITE]), b = normalizarCelulaLaudo(gd[i][COL_LIMITE]);
      if (a && b && !celulasIguais(a, b)) addAviso(r, `laudoDepois.${i}`, `${infoParametro(i).nome}: limite diferente nos dois laudos (antes ${a}, depois ${b}) — o documento usa o de depois.`);
    });
  }
  // A seção Análise sai sempre (texto fixo): sem resultado nenhum, a tabela
  // sai toda "—" — avisa antes de gerar.
  if (ctx.usaLaudo && !temLaudo(d.laudoAntes) && !temLaudo(d.laudoDepois)) {
    addAviso(r, "laudoAntes", "Nenhum resultado de laudo preenchido — a tabela da Análise Físico Química sairá toda com “—”. Use “Laudo ANTES/APÓS (PDF)” ou digite os valores.");
  }
  // Dois laudos do laboratório: o de antes e o de após a limpeza.
  if (ctx.usaLaudo) {
    const pdfs: [ "laudoPdf" | "laudoPdfDepois", LaudoPdf | null | undefined, string][] = [
      ["laudoPdf", s.laudoPdf, MSG_LAUDO_OBRIGATORIO], ["laudoPdfDepois", s.laudoPdfDepois, MSG_LAUDO_DEPOIS_OBRIGATORIO]];
    for (const [k, l, msg] of pdfs) {
      if (l?.caminho) continue;
      if (ctx.exigirLaudoPdf) addErro(r, k, msg);
      else addAviso(r, k, `${msg.replace(" — sem ele o relatório de execução não pode ser enviado para aprovação.", "")} — obrigatório para enviar para aprovação (o rascunho pode ser salvo sem ele).`);
    }
    if (s.laudoPdf?.hash && s.laudoPdf.hash === s.laudoPdfDepois?.hash) {
      addErro(r, "laudoPdfDepois", "O laudo de APÓS a limpeza é o mesmo arquivo do laudo de ANTES — anexe o PDF de cada amostra.");
    }
  }
  return r;
}

export const ROTULOS_RELATORIO_EXECUCAO: Record<string, string> = {
  phAntes: "pH antes", cloroAntes: "Cloro livre antes", phDepois: "pH depois", cloroDepois: "Cloro livre depois",
  rdos: "RDOs", equipe: "Equipe de trabalho", laudoPdf: "PDF do laudo (antes)", laudoPdfDepois: "PDF do laudo (após)", conclusao: "Conclusão",
};

// ── Dados do relatório a partir das RDOs ─────────────────────────────────────

/** O que as RDOs da OS dão para o relatório: equipe, datas/horários da
 *  operação e o texto corrido das atividades (Observações). Só preenche ao
 *  clicar em "Puxar das RDOs" — pH e cloro continuam no modal das coletas. */
export interface DadosDasRdos {
  /** Pessoas das RDOs, sem repetir (na ordem em que aparecem). */
  equipe: MembroRdo[];
  /** Data (ISO) da primeira RDO — início da execução. */
  dataExecucao?: string;
  /** Dia (ISO) em que a limpeza começou; sem limpeza registrada, o da 1ª RDO. */
  dataOperacao?: string;
  /** [chegada, início da limpeza, conclusão, saída] do dia da operação. */
  horarios: string[];
  /** Um parágrafo por dia, em HTML. */
  observacoes: string;
}

const RE_CHEGADA = /\bcheg(a|ou|ada)\b.*\bsite\b|\bchegada\b/i;
const RE_SAIDA = /\bdeix(a|ou)\b.*\bsite\b|\bsa[íi]da\b/i;
const RE_INICIO_LIMPEZA = /\b(in[íi]cio|inicia|iniciou|come[çc]a|come[çc]o)\b.*\blimpeza\b/i;
const RE_FIM_LIMPEZA = /\b(fim|t[ée]rmino|termina|terminou|conclus[ãa]o|conclui|concluiu|finaliza)\b.*\blimpeza\b/i;
const RE_ALMOCO = /\balmo[çc]o\b/i;

/** Atividades do dia que valem para esta OS: as marcadas com ela e as sem
 *  OS (chegada, PT, saída…), que valem para todas as que o RDO cobre. */
function atividadesDaOs(rdo: RdoResumo, inspecaoId: string): AtividadeRdo[] {
  return (rdo.dados?.atividades || [])
    .filter((a) => a && (a.texto || "").trim() && (!a.inspecaoId || a.inspecaoId === inspecaoId))
    .slice()
    .sort((a, b) => (a.inicio || "").localeCompare(b.inicio || ""));
}

/** "Liberação da PT." → "liberação da PT." (sigla no começo fica como está). */
function minusculaInicial(t: string): string {
  return /^[A-ZÀ-Ý][A-ZÀ-Ý]/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

function hora(h?: string): string {
  return h && /^\d{2}:\d{2}$/.test(h) ? `${h}h` : "";
}

/** Frase de uma atividade no texto corrido: "às 08:10h, equipe ASP …". */
function fraseAtividade(a: AtividadeRdo): string {
  let t = semFraseCloro(a.texto.trim()).replace(/\s+/g, " ");
  if (!/[.!?]$/.test(t)) t += ".";
  const ini = hora(a.inicio), fim = hora(a.fim);
  const quando = ini && fim ? `das ${ini} às ${fim}` : ini ? `às ${ini}` : "";
  return quando ? `${quando}, ${minusculaInicial(t)}` : t;
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function dadosDasRdos(rdos: RdoResumo[] | null | undefined, inspecaoId: string): DadosDasRdos {
  const lista = (rdos || [])
    .filter((r) => r && dataIsoValida(r.data) && ((r.inspecoes || []).length === 0 || (r.inspecoes || []).includes(inspecaoId)))
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data));

  const equipe: MembroRdo[] = [];
  for (const r of lista) for (const m of r.dados?.equipe || []) {
    const nome = (m?.nome || "").trim();
    if (nome && !equipe.some((x) => mesmaPessoa(x.nome, nome))) equipe.push({ nome, funcao: (m.funcao || "").trim() });
  }

  const dias = lista.map((r) => ({ data: r.data, atividades: atividadesDaOs(r, inspecaoId) }))
    .filter((d) => d.atividades.length > 0);

  // Dia da operação: o primeiro em que a limpeza começou.
  const diaLimpeza = dias.find((d) => d.atividades.some((a) => RE_INICIO_LIMPEZA.test(a.texto)))
    || dias.find((d) => d.atividades.some((a) => /\blimpeza\b/i.test(a.texto) && !/coleta/i.test(a.texto)));
  const diaOp = diaLimpeza || dias[0];
  const horarios = ["", "", "", ""];
  if (diaOp) {
    const at = diaOp.atividades;
    const achar = (re: RegExp) => at.find((a) => re.test(a.texto));
    const inicio = achar(RE_INICIO_LIMPEZA);
    const fim = [...at].reverse().find((a) => RE_FIM_LIMPEZA.test(a.texto));
    horarios[0] = achar(RE_CHEGADA)?.inicio || "";
    horarios[1] = inicio?.inicio || "";
    // "10:50 às 15:20 – limpeza de fundo": a mesma atividade dá início e fim.
    horarios[2] = fim?.inicio || inicio?.fim || "";
    horarios[3] = [...at].reverse().find((a) => RE_SAIDA.test(a.texto))?.inicio || "";
  }

  const observacoes = dias.map((d) => {
    const frases = d.atividades.filter((a) => !RE_ALMOCO.test(a.texto)).map(fraseAtividade);
    if (frases.length === 0) return "";
    const [primeira, ...resto] = frases;
    const texto = [`No dia ${dataBr(d.data)}, ${primeira}`,
      ...resto.map((f) => f.charAt(0).toUpperCase() + f.slice(1))].join(" ");
    return `<p>${escaparHtml(texto)}</p>`;
  }).join("");

  return {
    equipe,
    dataExecucao: lista[0]?.data,
    dataOperacao: diaOp?.data,
    horarios,
    observacoes,
  };
}
