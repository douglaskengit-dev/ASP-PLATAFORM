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
/** OS SEM inspeção (gp_inspecoes.com_inspecao = false) nasce aqui e nunca
 *  passa pelas fases 2–5 (bloco de inspeção). */
export const PRIMEIRA_FASE_EXECUCAO = 6;

/** Fase em que a OS nasce: 2 (com inspeção) ou 6 (sem inspeção). */
export function faseInicial(comInspecao: boolean | null | undefined): number {
  return comInspecao === false ? PRIMEIRA_FASE_EXECUCAO : PRIMEIRA_FASE_INSPECAO;
}

/** Menor fase que a OS pode ocupar (nada a leva abaixo disto). */
export function faseMinima(comInspecao: boolean | null | undefined): number {
  return faseInicial(comInspecao);
}

/** Fases que valem para a OS, com a 1 (abertura do projeto): 1..10 com
 *  inspeção; 1, 6..10 sem inspeção (2–5 não existem para ela). */
export function fasesAplicaveis(comInspecao: boolean | null | undefined): number[] {
  const todas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return comInspecao === false ? todas.filter((n) => n === 1 || n >= PRIMEIRA_FASE_EXECUCAO) : todas;
}

/** Progresso da OS sobre as fases que valem para ela. O NÚMERO da fase não
 *  muda (a fase 6 é sempre o Agendamento de Execução); a posição é contada
 *  nas fases aplicáveis: com inspeção, etapa = fase ("Fase 4 de 10"); sem
 *  inspeção, a fase 6 é a etapa 2 de 6 (a 1 é a abertura do projeto). */
export function progressoFase(fase: number, comInspecao: boolean | null | undefined): { etapa: number; total: number; pct: number } {
  const lista = fasesAplicaveis(comInspecao);
  const total = lista.length;
  let etapa = lista.indexOf(fase) + 1;
  // Fase fora da lista (dado antigo): conta as aplicáveis até ela.
  if (etapa === 0) etapa = Math.max(1, lista.filter((n) => n <= fase).length);
  return { etapa, total, pct: Math.round(((etapa - 1) / (total - 1)) * 100) };
}

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
    case "encerrar":
      return "Encerrou a OS";
    case "reabrir":
      return "Reabriu a OS (volta a aceitar alterações)";
    case "alterar_inspecao":
      return faseDe === fasePara
        ? "Alterou “Haverá inspeção?” da OS"
        : `Alterou “Haverá inspeção?” da OS — fase ${faseDe} → ${fasePara} (${tituloFase(fasePara)})`;
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
export function acoesDisponiveis(
  perfil: string | null | undefined,
  faseAtual: number,
  opcoes: { comInspecao?: boolean | null } = {},
): OpcaoAcao[] {
  if (!perfilAtuaNaFase(perfil, faseAtual)) return [];
  // OS sem inspeção: nada a leva para as fases 2–5 (a reprovação da fase 9
  // volta para a 8). Uma que, por dado antigo, esteja abaixo da 6 só anda
  // para a 6.
  const minima = faseMinima(opcoes.comInspecao);
  const limitar = (n: number) => Math.min(Math.max(n, minima), ULTIMA_FASE);
  if (faseAtual < minima) {
    return [{ acao: "avancar", rotulo: "Concluir e avançar", destino: minima }];
  }

  // Fases de aprovação
  if (faseAtual === 5 || faseAtual === 9) {
    return [
      { acao: "aprovar", rotulo: "Aprovar relatório", destino: limitar(faseAtual + 1) },
      { acao: "reprovar", rotulo: "Reprovar (Ajustar)", destino: limitar(faseAtual - 1), exigeMotivo: true },
    ];
  }

  // Encerramento
  if (faseAtual >= ULTIMA_FASE) return [];

  return [{ acao: "avancar", rotulo: "Concluir e avançar", destino: limitar(faseAtual + 1) }];
}

// ── "Haverá inspeção?" — troca depois de criada ─────────────────────────────

export interface TrocaInspecao {
  /** false = nada a fazer (mesmo valor). */
  muda: boolean;
  /** Fase depois da troca. */
  faseNova: number;
  /** Texto do aviso (confirmação) — sempre presente quando muda. */
  aviso: string;
  /** Não → Sim na fase 6 sem nada da execução feito: dá para voltar à fase 2. */
  podeVoltarParaInspecao: boolean;
}

/**
 * O que acontece ao trocar "Haverá inspeção?" de uma OS aberta (a OS
 * encerrada nem chega aqui — é só consulta). Puro: a tela usa para o aviso,
 * a API para gravar.
 *  · Sim → Não nas fases 2–5: pula para a 6; o que já foi feito da inspeção
 *    (agendamento de inspeção, coletas, relatório de inspeção) fica no
 *    histórico.
 *  · Sim → Não da 6 em diante: só esconde as fases 2–5; a fase não muda.
 *  · Não → Sim na 6 sem nada da execução feito: pode voltar à fase 2
 *    (`voltarParaInspecao`); sem escolher voltar, fica na 6.
 *  · Não → Sim depois disso: a fase não muda; as fases 2–5 ficam puladas.
 */
export function planejarTrocaInspecao(d: {
  fase: number;
  comInspecaoAtual: boolean;
  novo: boolean;
  /** Sem agendamento de execução ativo, relatório de execução nem RDO. */
  nadaFeitoNaExecucao: boolean;
  voltarParaInspecao?: boolean;
}): TrocaInspecao {
  const { fase, comInspecaoAtual, novo } = d;
  if (comInspecaoAtual === novo) {
    return { muda: false, faseNova: fase, aviso: "", podeVoltarParaInspecao: false };
  }
  if (!novo) {
    if (fase < PRIMEIRA_FASE_EXECUCAO) {
      return {
        muda: true, faseNova: PRIMEIRA_FASE_EXECUCAO, podeVoltarParaInspecao: false,
        aviso: `A OS sai da fase ${fase} (${tituloFase(fase)}) e vai direto para a fase 6 (${tituloFase(6)}). `
          + "O que já foi feito da inspeção — agendamento de inspeção, coletas e relatório de inspeção — continua no histórico da OS.",
      };
    }
    return {
      muda: true, faseNova: fase, podeVoltarParaInspecao: false,
      aviso: `A OS continua na fase ${fase}. As fases de inspeção (2 a 5) deixam de aparecer; os registros que já existirem continuam no histórico.`,
    };
  }
  if (fase === PRIMEIRA_FASE_EXECUCAO && d.nadaFeitoNaExecucao) {
    const volta = !!d.voltarParaInspecao;
    return {
      muda: true, faseNova: volta ? PRIMEIRA_FASE_INSPECAO : fase, podeVoltarParaInspecao: true,
      aviso: volta
        ? `A OS volta para a fase 2 (${tituloFase(2)}) e segue o fluxo com inspeção (fases 2 a 5 antes da execução).`
        : "A OS continua na fase 6. As fases de inspeção (2 a 5) ficam como puladas — nada da inspeção foi feito.",
    };
  }
  return {
    muda: true, faseNova: fase, podeVoltarParaInspecao: false,
    aviso: `A OS continua na fase ${fase}. As fases de inspeção (2 a 5) foram puladas e aparecem como não realizadas`
      + (fase === PRIMEIRA_FASE_EXECUCAO ? " — a execução já começou a ser preparada, então não dá para voltar à fase 2." : "."),
  };
}

// ── Seções da página da inspeção ─────────────────────────────────────────────

/** Seções recolhíveis da página da inspeção. O id também é a âncora da URL
 *  (`/inspecoes/<id>#relatorios` abre e rola até a seção). */
export type SecaoInspecao =
  | "coletas" | "agendamentos" | "checklist" | "fotos" | "rdos" | "relatorios" | "entregas" | "arquivos" | "historico";

export const SECOES_INSPECAO: SecaoInspecao[] =
  ["coletas", "agendamentos", "checklist", "fotos", "rdos", "relatorios", "entregas", "arquivos", "historico"];

/** Como a seção nasce: aberta, recolhida (só o resumo) ou oculta. */
export type EstadoSecao = "aberta" | "recolhida" | "oculta";

const A = "aberta", R = "recolhida", H = "oculta";
type LinhaSecoes = Record<SecaoInspecao, EstadoSecao>;
const linha = (
  coletas: EstadoSecao, agendamentos: EstadoSecao, checklist: EstadoSecao, fotos: EstadoSecao,
  rdos: EstadoSecao, relatorios: EstadoSecao, entregas: EstadoSecao, arquivos: EstadoSecao, historico: EstadoSecao,
): LinhaSecoes => ({ coletas, agendamentos, checklist, fotos, rdos, relatorios, entregas, arquivos, historico });

/**
 * Padrão de cada seção por fase: abre o que a fase pede, recolhe o resto.
 * Fotos e RDOs ficam ocultos no bloco de inspeção (2–5) — os dois são da
 * execução; o RDO (diário de operação) abre na fase 7, quando é preenchido.
 * "Entregas ao cliente" só existe no Encerramento (fase 10), aberta.
 * Tabela aprovada pelo produto; mudar aqui muda para todo mundo.
 */
export const SECOES_POR_FASE: Record<number, LinhaSecoes> = {
  //          Coletas Agend. Checkl. Fotos RDOs Relat. Entreg. Arquiv. Hist.
  2:  linha(R, A, A, H, H, R, H, R, R),
  3:  linha(A, R, A, H, H, R, H, R, R),
  4:  linha(A, R, R, H, H, A, H, R, R),
  5:  linha(A, R, R, H, H, A, H, R, R),
  6:  linha(R, A, A, R, R, R, H, R, R),
  7:  linha(R, R, A, A, A, R, H, R, R),
  8:  linha(R, R, R, A, R, A, H, R, R),
  9:  linha(R, R, R, R, R, A, H, R, R),
  10: linha(R, R, R, R, R, A, A, A, A),
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
