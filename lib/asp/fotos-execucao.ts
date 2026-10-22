/**
 * Coleta de fotos da execução (fase 7) — definição única das vagas do
 * checklist fotográfico, da conta de pendências e do destino de cada foto no
 * Relatório de Execução.
 *
 * Tudo que fala de "quais fotos a execução pede" sai daqui: o card da
 * inspeção (ColetaFotosExecucao), o aviso ao avançar a fase 7 → 8, o aviso do
 * formulário do relatório e a API (que só aceita ids de vaga conhecidos).
 * Mudar uma vaga aqui muda as quatro telas juntas.
 *
 * Coleta incompleta só AVISA — nunca bloqueia avanço de fase nem relatório.
 */

// ── Cloro: unidade e limite de aviso (Catálogo → procedimento) ─────────────

/** Unidade do cloro livre escolhida no procedimento. Em água, 1 mg/L = 1 PPM:
 *  muda só o que se escreve — card da coleta, frase do RDO e relatório. */
export const UNIDADES_CLORO = ["mg/L", "PPM"] as const;
export type UnidadeCloro = (typeof UNIDADES_CLORO)[number];
export const UNIDADE_CLORO_PADRAO: UnidadeCloro = "mg/L";
/** Acima disso a coleta avisa (provável erro de digitação). */
export const CLORO_LIMITE_AVISO_PADRAO = 5;

export function unidadeCloroValida(u: unknown): u is UnidadeCloro {
  return u === "mg/L" || u === "PPM";
}

/** Unidade e limite do procedimento (linha de gp_procedimentos); coluna
 *  ausente (migração não rodada) ou inválida = padrões. */
export function cloroDoProcedimento(p: { cloro_unidade?: unknown; cloro_limite_aviso?: unknown } | null | undefined): {
  unidade: UnidadeCloro; limite: number;
} {
  const lim = Number(p?.cloro_limite_aviso);
  return {
    unidade: unidadeCloroValida(p?.cloro_unidade) ? p!.cloro_unidade as UnidadeCloro : UNIDADE_CLORO_PADRAO,
    limite: isFinite(lim) && lim > 0 ? lim : CLORO_LIMITE_AVISO_PADRAO,
  };
}

export type SecaoFotosId = "tanque" | "robo" | "agua_antes" | "agua_depois" | "limpeza";
type Fase = "antes" | "durante" | "depois";

export interface SlotFoto {
  /** Chave no jsonb `itens` e pasta no storage — só [a-z_]. */
  id: string;
  rotulo: string;
  /** Legenda sugerida da figura no relatório. */
  legenda: string;
  /** Vaga de várias fotos (lista no jsonb); `minimo` é o que conta como completo. */
  minimo?: number;
  /** Além da foto, pede um valor medido em campo. */
  valor?: { nome: "pH" | "Cloro"; unidade?: string };
  /** Palavras que identificam esta foto na legenda de uma vaga do modelo. */
  palavras: string[];
  /** Momento da foto em relação à limpeza — evita casar "antes" com "depois". */
  fase?: Fase;
}

export interface SecaoFotos {
  id: SecaoFotosId;
  titulo: string;
  descricao?: string;
  /** Seção opcional: só é exigida com esta caixinha marcada na inspeção. */
  flag?: "agua_antes" | "agua_depois";
  slots: SlotFoto[];
}

export const MINIMO_FOTOS_LIMPEZA = 3;

function slotsAgua(pref: "agua_antes" | "agua_depois"): SlotFoto[] {
  const fase: Fase = pref === "agua_antes" ? "antes" : "depois";
  const quando = fase === "antes" ? "antes da limpeza" : "após a limpeza";
  return [
    { id: `${pref}_local`, rotulo: "Limpeza do local de extração", fase,
      legenda: `Limpeza do local de extração (${quando})`,
      palavras: ["higieniz", "local de extra", "limpeza do local"] },
    { id: `${pref}_ponto`, rotulo: "Ponto de coleta", fase,
      legenda: `Ponto de coleta (${quando})`, palavras: ["ponto de coleta"] },
    { id: `${pref}_ph`, rotulo: "pH", fase, valor: { nome: "pH" },
      legenda: `Medição de pH ${quando}`, palavras: ["ph"] },
    { id: `${pref}_cloro`, rotulo: "Cloro", fase, valor: { nome: "Cloro", unidade: "mg/L" },
      legenda: `Medição de cloro ${quando}`, palavras: ["cloro"] },
    { id: `${pref}_procedimento`, rotulo: "Procedimento de coleta", fase,
      legenda: `Procedimento de coleta (${quando})`, palavras: ["procedimento", "frasco"] },
  ];
}

export const SECOES_FOTOS: SecaoFotos[] = [
  {
    id: "tanque", titulo: "Foto do tanque",
    slots: [
      { id: "tanque_geral", rotulo: "Geral", legenda: "Vista geral do tanque", palavras: ["geral"] },
      { id: "tanque_abastecimento", rotulo: "Ponto de abastecimento", legenda: "Ponto de abastecimento do tanque", palavras: ["abastecimento"] },
      { id: "tanque_bomba", rotulo: "Saída da bomba", legenda: "Saída da bomba", palavras: ["bomba"] },
    ],
  },
  {
    id: "robo", titulo: "Robô no local da inspeção",
    slots: [{ id: "robo", rotulo: "Robô no local", legenda: "Robô no local da inspeção", palavras: ["robo"] }],
  },
  {
    id: "agua_antes", titulo: "Coleta de água ANTES da limpeza", flag: "agua_antes",
    descricao: "Exigida em reservatório de água potável.",
    slots: slotsAgua("agua_antes"),
  },
  {
    id: "agua_depois", titulo: "Coleta de água DEPOIS da limpeza", flag: "agua_depois",
    descricao: "Exigida em reservatório de água potável.",
    slots: slotsAgua("agua_depois"),
  },
  {
    id: "limpeza", titulo: "Limpeza",
    descricao: `No mínimo ${MINIMO_FOTOS_LIMPEZA} fotos em cada momento.`,
    slots: [
      { id: "limpeza_antes", rotulo: "Antes — visão geral e pontos de interesse", minimo: MINIMO_FOTOS_LIMPEZA,
        fase: "antes", legenda: "Antes da limpeza", palavras: ["antes"] },
      { id: "limpeza_durante", rotulo: "Durante", minimo: MINIMO_FOTOS_LIMPEZA,
        fase: "durante", legenda: "Durante a limpeza", palavras: ["durante", "andamento", "execu"] },
      { id: "limpeza_depois", rotulo: "Depois", minimo: MINIMO_FOTOS_LIMPEZA,
        fase: "depois", legenda: "Após a limpeza", palavras: ["depois", "apos", "final"] },
    ],
  },
];

// ── Registro ─────────────────────────────────────────────────────────────────

/** `hash` = SHA-256 do arquivo ORIGINAL (antes da compressão): a mesma foto
 *  enviada de novo é reconhecida mesmo que a compressão saia diferente.
 *  `capturada_em` = data/hora da câmera (EXIF DateTimeOriginal,
 *  "aaaa-mm-ddThh:mm:ss", hora local da câmera), quando a foto tem. */
export interface FotoColetada {
  caminho: string; por?: string | null; em?: string | null;
  hash?: string | null; capturada_em?: string | null;
}
/** Vaga de uma foto só. `valor` pode existir antes da foto (pH, cloro). */
export interface ItemColetado {
  caminho?: string | null; valor?: number | null; por?: string | null; em?: string | null;
  hash?: string | null; capturada_em?: string | null;
}

export interface RegistroFotosExecucao {
  /** null = ainda não gravado (a tela mostra os padrões do procedimento). */
  id?: string | null;
  inspecao_id?: string;
  agua_antes: boolean;
  agua_depois: boolean;
  limpeza_confirmada: boolean;
  itens: Record<string, ItemColetado | FotoColetada[]>;
}

export function registroVazio(aguaPotavel = false): RegistroFotosExecucao {
  return { id: null, agua_antes: aguaPotavel, agua_depois: aguaPotavel, limpeza_confirmada: false, itens: {} };
}

export function slotPorId(id: string): { secao: SecaoFotos; slot: SlotFoto } | null {
  for (const secao of SECOES_FOTOS) {
    const slot = secao.slots.find((s) => s.id === id);
    if (slot) return { secao, slot };
  }
  return null;
}

/** Fotos de uma vaga, sempre como lista (vaga simples devolve 0 ou 1). */
export function fotosDoSlot(reg: RegistroFotosExecucao | null | undefined, id: string): FotoColetada[] {
  const v = reg?.itens?.[id];
  if (Array.isArray(v)) return v.filter((f) => f?.caminho);
  return v?.caminho ? [{ caminho: v.caminho, por: v.por, em: v.em, hash: v.hash, capturada_em: v.capturada_em }] : [];
}

/** Onde a mesma foto (mesmo hash) já está na coleta: "Limpeza — Durante".
 *  Na vaga de uma foto só, a foto atual vai ser SUBSTITUÍDA — não conta. */
export function fotoRepetida(reg: RegistroFotosExecucao | null | undefined, hash: string, slotId: string): string | null {
  if (!hash || !reg?.itens) return null;
  for (const id of Object.keys(reg.itens)) {
    const def = slotPorId(id);
    if (!def || (id === slotId && !def.slot.minimo)) continue;
    if (fotosDoSlot(reg, id).some((f) => f.hash === hash)) return `${def.secao.titulo} — ${def.slot.rotulo}`;
  }
  return null;
}

export function valorDoSlot(reg: RegistroFotosExecucao | null | undefined, id: string): number | null {
  const v = reg?.itens?.[id];
  if (!v || Array.isArray(v) || v.valor == null || !isFinite(Number(v.valor))) return null;
  return Number(v.valor);
}

/** "7,2" / "7.2" → 7.2; vazio ou inválido → null. */
export function lerNumero(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

export function numeroBr(n: number): string {
  return String(n).replace(".", ",");
}

/** Unidade de exibição do valor da vaga: a do procedimento para o cloro. */
export function unidadeDoSlot(slot: SlotFoto, unidadeCloro: UnidadeCloro = UNIDADE_CLORO_PADRAO): string {
  if (!slot.valor) return "";
  return slot.valor.nome === "Cloro" ? unidadeCloro : slot.valor.unidade || "";
}

/** Valor para legenda: "pH: 7,2" / "Cloro: 0,5 mg/L" (unidade do procedimento). */
export function textoDoValor(slot: SlotFoto, valor: number | null, unidadeCloro: UnidadeCloro = UNIDADE_CLORO_PADRAO): string {
  if (!slot.valor || valor == null) return "";
  const u = unidadeDoSlot(slot, unidadeCloro);
  return `${slot.valor.nome}: ${numeroBr(valor)}${u ? ` ${u}` : ""}`;
}

export function secaoExigida(reg: RegistroFotosExecucao | null | undefined, secao: SecaoFotos): boolean {
  return !secao.flag || !!reg?.[secao.flag];
}

// ── Pendências ───────────────────────────────────────────────────────────────

export interface SituacaoItem {
  id: string;
  secao: SecaoFotos;
  rotulo: string;
  completo: boolean;
  /** O que falta, para o aviso ("falta o valor", "1 de 3 fotos"). */
  falta?: string;
}

/** Itens exigidos nesta inspeção, na ordem da tela, com o que falta em cada. */
export function situacaoDosItens(reg: RegistroFotosExecucao | null | undefined): SituacaoItem[] {
  const lista: SituacaoItem[] = [];
  for (const secao of SECOES_FOTOS) {
    if (!secaoExigida(reg, secao)) continue;
    if (secao.id === "limpeza") {
      lista.push({
        id: "limpeza_confirmada", secao, rotulo: "Confirmação das fotos durante a limpeza",
        completo: !!reg?.limpeza_confirmada, falta: "não confirmada",
      });
    }
    for (const slot of secao.slots) {
      const n = fotosDoSlot(reg, slot.id).length;
      if (slot.minimo) {
        lista.push({ id: slot.id, secao, rotulo: slot.rotulo, completo: n >= slot.minimo, falta: `${n} de ${slot.minimo} fotos` });
        continue;
      }
      const semValor = !!slot.valor && valorDoSlot(reg, slot.id) == null;
      const falta = n === 0 && semValor ? "falta a foto e o valor"
        : n === 0 ? "falta a foto" : semValor ? "falta o valor" : undefined;
      lista.push({ id: slot.id, secao, rotulo: slot.rotulo, completo: !falta, falta });
    }
  }
  return lista;
}

export function progressoColeta(reg: RegistroFotosExecucao | null | undefined): { feitos: number; total: number } {
  const itens = situacaoDosItens(reg);
  return { feitos: itens.filter((i) => i.completo).length, total: itens.length };
}

/** Pendências em texto, uma por item ("Limpeza — Durante: 1 de 3 fotos"). */
export function pendenciasColeta(reg: RegistroFotosExecucao | null | undefined): string[] {
  return situacaoDosItens(reg)
    .filter((i) => !i.completo)
    .map((i) => i.id === "limpeza_confirmada"
      ? `${i.secao.titulo} — ${i.rotulo}`
      : `${i.secao.titulo} — ${i.rotulo}: ${i.falta}`);
}

// ── Destino no Relatório de Execução ─────────────────────────────────────────

/**
 * Para qual seção do modelo vai cada foto. A seção é reconhecida pela CHAVE
 * do título (CHAVES_TOPICO em lib/asp/relatorio.ts), não pelo número — cada
 * modelo numera diferente. Vale a primeira chave da lista que existir (e
 * estiver marcada) no modelo em uso:
 *
 *   Tanque (geral, abastecimento, bomba) → 6.3 "Fotos do tanque" (modelo
 *       padrão); senão "Identificação do tanque".
 *   Robô no local → "Limpeza robotizada"; senão "Sanitização"; senão
 *       "Inspeção visual interna".
 *   Água antes/depois (local, ponto, pH, cloro, procedimento) → "Coletas das
 *       amostras"; senão "Análise Físico Química e Laboratorial"; senão
 *       "Inspeção visual interna". pH/cloro: valor na legenda e nos
 *       marcadores [dado coletado] do modelo.
 *   Limpeza antes e durante → "Limpeza robotizada"; senão "Inspeção visual
 *       interna".
 *   Limpeza depois → "Imagens após a limpeza"; senão "Limpeza robotizada";
 *       senão "Inspeção visual interna".
 *
 * Nada casou → primeira seção marcada do modelo (a foto nunca some calada).
 *
 * Seção com vagas de imagem no modelo ([imagem] + legenda já escrita): cada
 * foto procura a vaga cuja legenda cita o que ela mostra ("pH", "cloro",
 * "ponto de coleta", "antes"…), respeitando antes/depois; as que não casam
 * ocupam as vagas livres na ordem da coleta. Sobrou foto além das vagas? Ela
 * entra como figura livre no fim da seção. O formulário mostra o destino de
 * cada uma e deixa trocar a vaga ou remover.
 */
const DESTINOS: Record<SecaoFotosId | "limpeza_depois", { chave: string; ancora?: string; soNumero?: number }[]> = {
  tanque: [{ chave: "reservatorio", ancora: "6.3", soNumero: 6 }, { chave: "tanque" }],
  robo: [{ chave: "limpeza" }, { chave: "sanitizacao" }, { chave: "fotos-internas" }],
  agua_antes: [{ chave: "coletas" }, { chave: "analise" }, { chave: "fotos-internas" }],
  agua_depois: [{ chave: "coletas" }, { chave: "analise" }, { chave: "fotos-internas" }],
  limpeza: [{ chave: "limpeza" }, { chave: "fotos-internas" }],
  limpeza_depois: [{ chave: "apos-limpeza" }, { chave: "limpeza" }, { chave: "fotos-internas" }],
};

export interface FotoPlanejada {
  caminho: string;
  slotId: string;
  /** "Coleta de água ANTES da limpeza — pH" — para o painel do formulário. */
  rotulo: string;
  legenda: string;
  topico: number;
  ancora?: string;
  vaga?: boolean;
  /** Posição entre as vagas do tópico (0 = primeira). */
  vagaIndice?: number;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function faseDaLegenda(legenda: string): Fase | null {
  const t = normalizar(legenda);
  const antes = /\bantes\b/.test(t);
  const depois = /\b(depois|apos)\b/.test(t);
  return antes === depois ? null : antes ? "antes" : "depois";
}

/** Quanto a legenda de uma vaga combina com a foto (0 = não combina). */
function afinidade(slot: SlotFoto, legenda: string): number {
  const t = normalizar(legenda);
  const fase = faseDaLegenda(legenda);
  if (fase && slot.fase && fase !== slot.fase) return 0;
  let pontos = 0;
  for (const p of slot.palavras) {
    const re = p.length <= 3 ? new RegExp(`\\b${p}\\b`) : new RegExp(p);
    if (re.test(t)) pontos += p.length;          // termo mais específico pesa mais
  }
  return pontos;
}

/**
 * Converte o que foi coletado em fotos do relatório, já com tópico, âncora
 * ou vaga. Função pura: o formulário baixa os arquivos e monta as figuras.
 */
export function planejarFotosNoRelatorio(
  reg: RegistroFotosExecucao,
  modelo: {
    /** Número da seção com aquela chave no modelo em uso (undefined = não tem). */
    numeroDaChave: (chave: string) => number | undefined;
    /** Seção marcada para sair no documento? */
    ativo: (numero: number) => boolean;
    vagas: { topico: number; legenda: string }[];
    /** Último recurso quando nenhuma chave casa. */
    primeiraSecao: number;
    /** Unidade do cloro do procedimento (legenda "Cloro: 0,5 mg/L"). */
    unidadeCloro?: UnidadeCloro;
  },
): FotoPlanejada[] {
  const planejadas: FotoPlanejada[] = [];
  // fotos que vão para vagas, por tópico, aguardando a distribuição
  const paraVagas = new Map<number, { foto: FotoPlanejada; slot: SlotFoto }[]>();

  for (const secao of SECOES_FOTOS) {
    if (!secaoExigida(reg, secao)) continue;
    for (const slot of secao.slots) {
      const fotos = fotosDoSlot(reg, slot.id);
      if (fotos.length === 0) continue;
      const opcoes = DESTINOS[slot.id === "limpeza_depois" ? "limpeza_depois" : secao.id];
      let topico = modelo.primeiraSecao;
      let ancora: string | undefined;
      for (const d of opcoes) {
        const n = modelo.numeroDaChave(d.chave);
        if (n === undefined || !modelo.ativo(n)) continue;
        if (d.ancora && d.soNumero !== undefined && n !== d.soNumero) continue;
        topico = n; ancora = d.ancora;
        break;
      }
      const valor = textoDoValor(slot, valorDoSlot(reg, slot.id), modelo.unidadeCloro);
      fotos.forEach((f, k) => {
        const foto: FotoPlanejada = {
          caminho: f.caminho, slotId: slot.id,
          rotulo: `${secao.titulo} — ${slot.rotulo}${fotos.length > 1 ? ` (${k + 1})` : ""}`,
          legenda: valor ? `${slot.legenda} — ${valor}` : slot.legenda,
          topico, ancora,
        };
        planejadas.push(foto);
        if (!ancora && modelo.vagas.some((v) => v.topico === topico)) {
          const lista = paraVagas.get(topico) || [];
          lista.push({ foto, slot });
          paraVagas.set(topico, lista);
        }
      });
    }
  }

  for (const [topico, fotos] of paraVagas) {
    const vagas = modelo.vagas.filter((v) => v.topico === topico);
    const ocupada = new Array<boolean>(vagas.length).fill(false);
    const pendentes = new Set(fotos);
    // 1) vaga cuja legenda cita o que a foto mostra
    vagas.forEach((v, i) => {
      let melhor: { foto: FotoPlanejada; slot: SlotFoto } | null = null;
      let pontos = 0;
      for (const c of pendentes) {
        const p = afinidade(c.slot, v.legenda);
        if (p > pontos) { pontos = p; melhor = c; }
      }
      if (melhor) {
        melhor.foto.vaga = true; melhor.foto.vagaIndice = i;
        ocupada[i] = true; pendentes.delete(melhor);
      }
    });
    // 2) as demais ocupam as vagas livres na ordem da coleta; sem vaga, ficam
    //    como figura livre no fim da seção
    for (const c of pendentes) {
      const i = ocupada.indexOf(false);
      if (i < 0) break;
      c.foto.vaga = true; c.foto.vagaIndice = i; ocupada[i] = true;
    }
  }
  return planejadas;
}
