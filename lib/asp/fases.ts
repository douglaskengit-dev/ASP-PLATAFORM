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
      return "Assinou os participantes";
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
