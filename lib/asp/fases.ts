/**
 * Modelo de fases do novo fluxo ASP (inspeção robótica + execução).
 * As fases 2..10 correm por INSPEÇÃO (não pelo projeto). A fase 1 é
 * nível-projeto (abertura). Ver COWORK-ASP.md §2.1.
 */

export type PerfilAsp = "admin" | "comercial" | "operacoes" | "gerencia";

export type BlocoFase = "inspecao" | "execucao" | "projeto";

export interface DefinicaoFase {
  numero: number;
  titulo: string;
  area: "Comercial" | "Operações" | "Gerência" | "—";
  bloco: BlocoFase;
  /** Perfis que executam a ação principal desta fase. */
  responsaveis: PerfilAsp[];
}

/** Fases 2..10 (as que correm dentro da inspeção). A fase 1 é do projeto. */
export const FASES: DefinicaoFase[] = [
  { numero: 2, titulo: "Agendamento de Visita / Inspeção", area: "Comercial", bloco: "inspecao", responsaveis: ["comercial"] },
  { numero: 3, titulo: "Coleta de Dados da Inspeção", area: "Operações", bloco: "inspecao", responsaveis: ["operacoes"] },
  { numero: 4, titulo: "Realização do Relatório de Inspeção", area: "Operações", bloco: "inspecao", responsaveis: ["operacoes"] },
  { numero: 5, titulo: "Aprovação do Relatório de Inspeção", area: "Gerência", bloco: "inspecao", responsaveis: ["gerencia"] },
  { numero: 6, titulo: "Agendamento de Execução", area: "Comercial", bloco: "execucao", responsaveis: ["comercial"] },
  { numero: 7, titulo: "Execução", area: "Operações", bloco: "execucao", responsaveis: ["operacoes"] },
  { numero: 8, titulo: "Realização do Relatório de Execução", area: "Operações", bloco: "execucao", responsaveis: ["operacoes"] },
  { numero: 9, titulo: "Aprovação do Relatório de Execução", area: "Gerência", bloco: "execucao", responsaveis: ["gerencia"] },
  { numero: 10, titulo: "Encerramento", area: "—", bloco: "projeto", responsaveis: ["gerencia", "admin"] },
];

export const PRIMEIRA_FASE_INSPECAO = 2;
export const ULTIMA_FASE = 10;

export function definicaoFase(numero: number): DefinicaoFase | undefined {
  return FASES.find((f) => f.numero === numero);
}

export function tituloFase(numero: number): string {
  return definicaoFase(numero)?.titulo ?? `Fase ${numero}`;
}

/** Descrição amigável de uma ação do histórico de fases. */
export function descreverAcaoFase(acao: string, faseDe: number, fasePara: number): string {
  switch (acao) {
    case "avancar":
      return `Avançou para a fase ${fasePara} — ${tituloFase(fasePara)}`;
    case "aprovar":
      return `Aprovou o relatório (fase ${faseDe})`;
    case "reprovar":
      return `Reprovou — Ajustar (voltou à fase ${fasePara})`;
    case "assinar":
      return "Enviou a versão assinada do relatório";
    default:
      return `${acao}: fase ${faseDe} → ${fasePara}`;
  }
}

/** Um perfil pode atuar na fase? Gerência e admin atuam em qualquer fase. */
export function perfilAtuaNaFase(perfil: string | null | undefined, numero: number): boolean {
  if (!perfil) return false;
  if (perfil === "admin" || perfil === "gerencia") return true;
  const def = definicaoFase(numero);
  return !!def && def.responsaveis.includes(perfil as PerfilAsp);
}

/**
 * Ação disponível para avançar/aprovar a partir de uma fase, conforme o
 * perfil. Retorna null se o perfil não pode agir na fase atual.
 */
export type AcaoFase = "avancar" | "aprovar" | "reprovar" | "assinar";

export interface OpcaoAcao {
  acao: AcaoFase;
  rotulo: string;
  /** Fase de destino ao aplicar (informativo; a API recalcula). */
  destino: number;
  /** true quando exige motivo (reprovação). */
  exigeMotivo?: boolean;
}

/**
 * Fases de aprovação (5 e 9): Gerência aprova (avança) ou reprova (volta uma
 * fase, tag "Ajustar"). Demais fases: o responsável "avança".
 */
export function acoesDisponiveis(perfil: string | null | undefined, faseAtual: number): OpcaoAcao[] {
  if (!perfilAtuaNaFase(perfil, faseAtual)) return [];

  // Fases de aprovação
  if (faseAtual === 5 || faseAtual === 9) {
    return [
      { acao: "aprovar", rotulo: "Aprovar relatório", destino: faseAtual + 1 },
      { acao: "reprovar", rotulo: "Reprovar (Ajustar)", destino: faseAtual - 1, exigeMotivo: true },
    ];
  }

  // Encerramento
  if (faseAtual >= ULTIMA_FASE) return [];

  return [{ acao: "avancar", rotulo: "Concluir e avançar", destino: faseAtual + 1 }];
}

// ── Seções da página da inspeção ─────────────────────────────────────────────

/** Seções recolhíveis da página da inspeção. O id também é a âncora da URL
 *  (`/inspecoes/<id>#relatorios` abre e rola até a seção). */
export type SecaoInspecao =
  | "coletas" | "agendamentos" | "checklist" | "fotos" | "rdos" | "relatorios" | "arquivos" | "historico";

export const SECOES_INSPECAO: SecaoInspecao[] =
  ["coletas", "agendamentos", "checklist", "fotos", "rdos", "relatorios", "arquivos", "historico"];

/** Como a seção nasce: aberta, recolhida (só o resumo) ou oculta. */
export type EstadoSecao = "aberta" | "recolhida" | "oculta";

const A = "aberta", R = "recolhida", H = "oculta";
type LinhaSecoes = Record<SecaoInspecao, EstadoSecao>;
const linha = (
  coletas: EstadoSecao, agendamentos: EstadoSecao, checklist: EstadoSecao, fotos: EstadoSecao,
  rdos: EstadoSecao, relatorios: EstadoSecao, arquivos: EstadoSecao, historico: EstadoSecao,
): LinhaSecoes => ({ coletas, agendamentos, checklist, fotos, rdos, relatorios, arquivos, historico });

/**
 * Padrão de cada seção por fase: abre o que a fase pede, recolhe o resto.
 * Fotos e RDOs ficam ocultos no bloco de inspeção (2–5) — os dois são da
 * execução; o RDO (diário de operação) abre na fase 7, quando é preenchido.
 * Tabela aprovada pelo produto; mudar aqui muda para todo mundo.
 */
export const SECOES_POR_FASE: Record<number, LinhaSecoes> = {
  //          Coletas Agend. Checkl. Fotos RDOs Relat. Arquiv. Hist.
  2:  linha(R, A, A, H, H, R, R, R),
  3:  linha(A, R, A, H, H, R, R, R),
  4:  linha(A, R, R, H, H, A, R, R),
  5:  linha(A, R, R, H, H, A, R, R),
  6:  linha(R, A, A, R, R, R, R, R),
  7:  linha(R, R, A, A, A, R, R, R),
  8:  linha(R, R, R, A, R, A, R, R),
  9:  linha(R, R, R, R, R, A, R, R),
  10: linha(R, R, R, R, R, A, A, A),
};

/**
 * Estado padrão das seções para a fase e o perfil. Função pura — a página
 * soma a escolha do usuário (localStorage) e as aberturas forçadas (erro,
 * fila de fotos, âncora da URL) por cima disto.
 *
 * - `reprovadoAgora`: a última movimentação foi uma reprovação que trouxe a
 *   inspeção para esta fase → abre Relatórios e Histórico (onde está o motivo).
 * - Comercial nas fases de Operações/Gerência (3–5, 7–9) acompanha pela
 *   agenda: Agendamentos abre e Coletas recolhe.
 */
export function secoesPadrao(
  fase: number,
  perfil: string | null | undefined,
  opcoes: { reprovadoAgora?: boolean } = {},
): LinhaSecoes {
  const base = SECOES_POR_FASE[fase] ?? (fase > ULTIMA_FASE ? SECOES_POR_FASE[ULTIMA_FASE] : SECOES_POR_FASE[PRIMEIRA_FASE_INSPECAO]);
  const r: LinhaSecoes = { ...base };
  if (perfil === "comercial" && ((fase >= 3 && fase <= 5) || (fase >= 7 && fase <= 9))) {
    r.agendamentos = A;
    if (r.coletas === A) r.coletas = R;
  }
  if (opcoes.reprovadoAgora) {
    r.relatorios = A;
    r.historico = A;
  }
  return r;
}
