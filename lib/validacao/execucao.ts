/** Fase 6 — a EXECUÇÃO da OS vista de fora do modal de agendamento: o card
 * do agendamento, o resumo dos RDOs e as confirmações de fase (6 → 7 e
 * 7 → 8). Só avisos (⚠️) — quem está em campo decide se segue. Puro.
 *
 *   · dias do período de execução sem RDO cobrindo a OS (fim de semana e
 *     feriado aparecem marcados, não somem da lista)
 *   · procedimento de água potável com as coletas de água desmarcadas na
 *     coleta de fotos
 *   · itens de segurança do checklist sem marcar com a execução começando
 *   · equipamento do procedimento fora do agendamento; equipe sem
 *     liderança (funções com "Conta como liderança" — gp_funcoes)
 *
 * As regras que BLOQUEIAM (período, sobreposição) ficam em agendamento.ts. */
import { equipamentosFaltando, equipeSemLideranca, msgSemLideranca, segurancaPendente, dataCurta, type CatalogoLideranca } from "./agendamento";
import { diaNaoUtil, diasDoPeriodo, Periodo, periodoDe } from "./periodo";

/** Agendamento como a página o tem (gravado). */
export interface AgendamentoExecucao {
  tipo: string;
  data_visita: string | null;
  data_fim?: string | null;
  a_definir?: boolean;
  equipe?: { id: string; nome: string }[];
  equipamentos?: string[];
  checklist?: { item: string; ok?: boolean }[];
  substituido_em?: string | null;
}

/** O agendamento de execução ativo com data (o período da execução). */
export function execucaoAtiva<T extends AgendamentoExecucao>(ags: T[]): T | null {
  return ags.find((a) => a.tipo === "execucao" && !a.substituido_em && !a.a_definir && !!a.data_visita) || null;
}

export interface DiaSemRdo {
  dia: string;
  /** "sábado", "feriado — Finados"; null = dia útil. */
  naoUtil: string | null;
  /** Ainda não chegou (depois de hoje). */
  futuro: boolean;
}

/** Dias do período sem RDO que cubra a OS. `ate` corta os dias futuros
 *  (resumo da seção); sem `ate`, vêm todos, com `futuro` marcado. */
export function diasSemRdo(periodo: Periodo | null, datasRdo: string[], hoje: string, ate?: string): DiaSemRdo[] {
  if (!periodo) return [];
  const com = new Set(datasRdo.map((d) => (d || "").slice(0, 10)));
  return diasDoPeriodo(periodo)
    .filter((dia) => !com.has(dia) && (!ate || dia <= ate))
    .map((dia) => ({ dia, naoUtil: diaNaoUtil(dia), futuro: dia > hoje }));
}

/** "05/11, 08/11 (fim de semana — sábado), 15/11 (feriado — Proclamação da República)". */
export function textoDiasSemRdo(dias: DiaSemRdo[]): string {
  return dias.map((d) => {
    const marcas = [d.naoUtil ? (d.naoUtil.startsWith("feriado") ? d.naoUtil : `fim de semana — ${d.naoUtil}`) : "", d.futuro ? "ainda não chegou" : ""]
      .filter(Boolean);
    return `${dataCurta(d.dia)}${marcas.length ? ` (${marcas.join("; ")})` : ""}`;
  }).join(", ");
}

/** Água potável no procedimento, coletas de água desmarcadas nas fotos. */
export function aguaPotavelDesmarcada(
  aguaPotavel: boolean | null | undefined,
  fotos: { agua_antes?: boolean; agua_depois?: boolean } | null | undefined
): string | null {
  if (!aguaPotavel || !fotos) return null;
  const faltam = [!fotos.agua_antes ? "ANTES" : "", !fotos.agua_depois ? "DEPOIS" : ""].filter(Boolean);
  if (!faltam.length) return null;
  return `O procedimento é de água potável, mas a coleta de água ${faltam.join(" e ")} da limpeza está desmarcada — as fotos e análises dela não serão cobradas nem entram no relatório.`;
}

/** Avisos do card do agendamento de execução (e da confirmação 6 → 7). */
export function avisosExecucao(opts: {
  ag: AgendamentoExecucao | null;
  hoje: string;
  /** Nomes do Catálogo previstos no procedimento. undefined = não checado. */
  equipamentosProcedimento?: string[];
  /** Funções por id de usuário. undefined = não checado. */
  funcoes?: Record<string, string | null>;
  /** Funções cadastradas (quais contam como liderança). */
  catalogoFuncoes?: CatalogoLideranca | null;
}): { seguranca: string[]; faltamEquipamentos: string[]; semLideranca: boolean; mensagens: string[] } {
  const { ag, hoje } = opts;
  const vazio = { seguranca: [], faltamEquipamentos: [], semLideranca: false, mensagens: [] };
  if (!ag || ag.tipo !== "execucao" || ag.substituido_em) return vazio;
  const p = periodoDe(ag);
  const seguranca = p && p.inicio <= hoje ? segurancaPendente(ag.checklist) : [];
  const faltamEquipamentos = equipamentosFaltando(opts.equipamentosProcedimento, ag.equipamentos || []);
  const equipe = (ag.equipe || []).filter((m) => m && m.id);
  const semLideranca = equipeSemLideranca(equipe, opts.funcoes, opts.catalogoFuncoes);
  const mensagens: string[] = [];
  if (seguranca.length) {
    mensagens.push(`Checklist de segurança incompleto com a execução ${p!.inicio < hoje ? "em andamento" : "começando hoje"}: ${seguranca.join(", ")}.`);
  }
  if (faltamEquipamentos.length) mensagens.push(`Equipamento(s) do procedimento fora do agendamento: ${faltamEquipamentos.join(", ")}.`);
  if (semLideranca) mensagens.push(`${msgSemLideranca(opts.catalogoFuncoes)}.`);
  return { seguranca, faltamEquipamentos, semLideranca, mensagens };
}
