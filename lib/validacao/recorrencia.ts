/** Cliente RECORRENTE e OS com/sem inspeção. Puro (navegador + API).
 *
 *   ⛔ "Serviço recorrente" marcado sem periodicidade (3, 6 ou 12 meses) ·
 *      periodicidade fora da lista · aviso de antecedência fora de 0–365 dias
 *
 * Regra do padrão "Haverá inspeção?" ao abrir um projeto: cliente
 * recorrente que JÁ tem ao menos um projeto ativo (fora da lixeira) → Não;
 * senão → Sim. O usuário pode trocar.
 *
 * Próximo serviço do cliente recorrente: vencimento = fim da última
 * execução do cliente + periodicidade (meses, com o fim do mês ajustado:
 * 31/01 + 1 mês = 28/02 ou 29/02). Fim de uma OS = o maior entre o último
 * dia do agendamento de execução ativo (data_fim, senão data_visita) e o
 * dia do encerramento. O lembrete abre `aviso_antecedencia_dias` antes. */
import { addErro, novoResultado, type ResultadoValidacao } from "./resultado";

export const PERIODICIDADES_MESES = [3, 6, 12] as const;
export const AVISO_ANTECEDENCIA_PADRAO = 30;
export const AVISO_ANTECEDENCIA_MAX = 365;

export const ROTULOS_RECORRENCIA: Record<string, string> = {
  periodicidadeMeses: "Periodicidade",
  avisoAntecedenciaDias: "Aviso de antecedência",
};

export interface DadosRecorrencia {
  recorrente?: boolean | null;
  periodicidadeMeses?: number | string | null;
  avisoAntecedenciaDias?: number | string | null;
}

const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

export function validarRecorrencia(d: DadosRecorrencia): ResultadoValidacao {
  const r = novoResultado();
  const per = inteiro(d.periodicidadeMeses);
  if (d.recorrente && per === null) {
    addErro(r, "periodicidadeMeses", "Escolha a periodicidade do serviço recorrente (3, 6 ou 12 meses).");
  } else if (per !== null && !(PERIODICIDADES_MESES as readonly number[]).includes(per)) {
    addErro(r, "periodicidadeMeses", "Periodicidade inválida — use 3, 6 ou 12 meses.");
  }
  const aviso = inteiro(d.avisoAntecedenciaDias);
  if (aviso !== null && (Number.isNaN(aviso) || aviso < 0 || aviso > AVISO_ANTECEDENCIA_MAX)) {
    addErro(r, "avisoAntecedenciaDias", `Aviso de antecedência: um número inteiro de 0 a ${AVISO_ANTECEDENCIA_MAX} dias.`);
  }
  return r;
}

/** Colunas de gp_orgaos a gravar. Desmarcado, a periodicidade sai (null). */
export function recorrenciaParaGravar(d: DadosRecorrencia): { recorrente: boolean; periodicidade_meses: number | null; aviso_antecedencia_dias: number } {
  const recorrente = !!d.recorrente;
  const per = inteiro(d.periodicidadeMeses);
  const aviso = inteiro(d.avisoAntecedenciaDias);
  return {
    recorrente,
    periodicidade_meses: recorrente && per !== null && !Number.isNaN(per) ? per : null,
    aviso_antecedencia_dias: aviso !== null && !Number.isNaN(aviso) ? aviso : AVISO_ANTECEDENCIA_PADRAO,
  };
}

/** "Haverá inspeção?" padrão do projeto novo. `projetosAtivos` = projetos do
 *  cliente fora da lixeira (o projeto que está sendo aberto não conta). */
export function inspecaoPadraoDoProjeto(d: { recorrente?: boolean | null; projetosAtivos: number }): boolean {
  return !(d.recorrente === true && d.projetosAtivos > 0);
}

// ── Datas ────────────────────────────────────────────────────────────────────

/** AAAA-MM-DD + n meses; dia que não existe no mês de destino vira o último
 *  dia dele (31/08 + 6 meses = 28/02, ou 29/02 em ano bissexto). */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.slice(0, 10).split("-").map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total - ano * 12;          // 0..11
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dd = Math.min(d, ultimo);
  return `${String(ano).padStart(4, "0")}-${String(mes + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function somarDiasIso(dia: string, n: number): string {
  const t = Date.parse(dia.slice(0, 10) + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const diaDe = (s: string | null | undefined): string | null =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

// ── Próximo serviço ──────────────────────────────────────────────────────────

/** Uma OS ativa do cliente, como o cálculo precisa. */
export interface OSRecorrencia {
  id: string;
  /** Dia (Brasília) da criação da OS. */
  criadaEm: string | null;
  /** Dia do encerramento (null = aberta). */
  encerradaEm: string | null;
  /** Agendamentos ATIVOS (não substituídos) — só os de execução contam. */
  agendamentos: { tipo: string; data_visita: string | null; data_fim?: string | null; a_definir?: boolean | null }[];
}

export type StatusRecorrencia = "vencido" | "em_breve" | "sem_historico" | "em_andamento" | "em_dia";

export const ROTULO_STATUS_RECORRENCIA: Record<StatusRecorrencia, string> = {
  vencido: "Vencido",
  em_breve: "Em breve",
  sem_historico: "Sem histórico",
  em_andamento: "Próximo serviço aberto",
  em_dia: "Em dia",
};

export interface ProximoServico {
  /** Fim da última execução do cliente (AAAA-MM-DD) ou null. */
  ultimaExecucao: string | null;
  /** Vencimento do próximo serviço (null sem histórico). */
  vencimento: string | null;
  /** Dia em que o lembrete abre (vencimento − antecedência). */
  abreEm: string | null;
  status: StatusRecorrencia;
  /** Dias até o vencimento (negativo = vencido há N dias). */
  dias: number | null;
}

/** Fim da OS: maior entre o último dia da execução agendada e o encerramento. */
export function fimDaOS(o: OSRecorrencia): string | null {
  let fim: string | null = null;
  for (const a of o.agendamentos || []) {
    if (a.tipo !== "execucao" || a.a_definir) continue;
    const d = diaDe(a.data_fim) || diaDe(a.data_visita);
    if (d && (!fim || d > fim)) fim = d;
  }
  const enc = diaDe(o.encerradaEm);
  if (enc && (!fim || enc > fim)) fim = enc;
  return fim;
}

/**
 * Situação do próximo serviço de um cliente recorrente.
 *  · sem histórico: nenhuma OS do cliente tem execução ou encerramento.
 *  · próximo serviço aberto: há OS NÃO encerrada criada depois do fim da
 *    última execução — o ciclo seguinte já começou (não lembra).
 *  · vencido: hoje > vencimento · em breve: hoje ≥ vencimento − antecedência.
 */
export function proximoServico(
  cfg: { periodicidadeMeses: number | null | undefined; avisoAntecedenciaDias?: number | null },
  oss: OSRecorrencia[],
  hoje: string,
): ProximoServico {
  let ultima: string | null = null;
  for (const o of oss) {
    const f = fimDaOS(o);
    if (f && (!ultima || f > ultima)) ultima = f;
  }
  const meses = Number(cfg.periodicidadeMeses) || 0;
  if (!ultima || !meses) {
    return { ultimaExecucao: ultima, vencimento: null, abreEm: null, status: "sem_historico", dias: null };
  }
  const vencimento = somarMeses(ultima, meses);
  const antecedencia = Number.isFinite(Number(cfg.avisoAntecedenciaDias)) && cfg.avisoAntecedenciaDias != null
    ? Math.max(0, Number(cfg.avisoAntecedenciaDias)) : AVISO_ANTECEDENCIA_PADRAO;
  const abreEm = somarDiasIso(vencimento, -antecedencia);
  const dias = Math.round((Date.parse(vencimento + "T00:00:00Z") - Date.parse(hoje + "T00:00:00Z")) / 86400000);
  // OS aberta criada depois da última execução (sem execução própria ainda,
  // senão ela seria a última): o próximo ciclo já foi aberto.
  const novoCiclo = oss.some((o) => !o.encerradaEm && (diaDe(o.criadaEm) || "") > ultima!);
  const status: StatusRecorrencia = novoCiclo ? "em_andamento"
    : hoje > vencimento ? "vencido"
    : hoje >= abreEm ? "em_breve"
    : "em_dia";
  return { ultimaExecucao: ultima, vencimento, abreEm, status, dias };
}


/** O lembrete do ciclo deve ser gerado (vencido ou em breve). */
export function lembreteDevido(p: ProximoServico): boolean {
  return !!p.vencimento && (p.status === "vencido" || p.status === "em_breve");
}
