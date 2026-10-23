/** Regras da Fase 2 — agendamento da visita de uma OS (gp_agendamentos).
 * Puras: o modal chama com o que veio de /api/agendamentos/verificar; a API
 * (lib/asp/agendamento-api.ts) chama com o que leu do banco.
 *
 *   ⛔ data da visita (ou "data a definir") · visita não pode ser no passado
 *      nem antes da abertura do projeto (na edição, só se a data mudou —
 *      registro antigo não fica preso) · "lembrar em" ≥ hoje · execução
 *      prevista antes da visita · equipe com ≥ 1 pessoa, só usuários ativos
 *      · outro agendamento ativo do mesmo tipo na mesma data nesta OS ·
 *      equipamento ou item de checklist repetido
 *   ⚠️ hora em branco · fim de semana/feriado nacional · pessoa ou
 *      equipamento já agendado no mesmo dia em OUTRO local · equipamento
 *      fora do Catálogo mas parecido com um item dele · o agendamento atual
 *      do mesmo tipo será substituído (remarcação)
 *
 * "Local" = projeto; dois projetos com o mesmo endereço também contam como
 * o mesmo local (vários tanques no mesmo site não conflitam).
 *
 * Fase 6 — execução com PERÍODO (data_visita = início, data_fim = último
 * dia; null = um dia só):
 *   ⛔ fim antes do início · período em agendamento de inspeção · outro
 *      agendamento ATIVO do mesmo tipo desta OS com período sobreposto
 *   ⚠️ período > 30 dias · dias de fim de semana/feriado (listados) ·
 *      conflito de equipe/equipamento em qualquer dia do período ·
 *      relatório de inspeção ainda não aprovado/assinado · início ≠
 *      previsão de execução do agendamento de inspeção · equipamento do
 *      procedimento fora da lista · equipe sem liderança (funções com
 *      "Conta como liderança" em gp_funcoes — Coordenador/Engenheiro) ·
 *      checklist de segurança incompleto com a execução já começando */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { dataIsoValida } from "./formatos";
import { encontrarFuncao, FUNCOES_PADRAO, type FuncaoRef } from "./funcao";
import { duplicadosEmLista, nomesParecidos, normalizarTexto, semPontuacao } from "./texto";
import { normalizarEndereco } from "./projeto";
import { feriadoNacional, fimDeSemana } from "./feriados";
import { diasNaoUteis, duracaoDias, intersecao, Periodo, periodoDe, periodosSobrepoem, textoPeriodo } from "./periodo";

/** Itens de segurança que nascem no checklist do agendamento (COWORK-ASP §3.2). */
export const CHECKLIST_PADRAO = ["NR-33 (espaço confinado)", "NR-10 (elétrica)", "EPIs", "Permissão de Trabalho (PT)"];

/** Execução com mais dias que isto pede confirmação (⚠️). */
export const PERIODO_MAX_DIAS = 30;

export type TipoAgendamento = "inspecao" | "execucao";

export interface MembroEquipe {
  id: string;
  nome: string;
}

export interface DadosAgendamento {
  tipo: TipoAgendamento;
  /** "Data a definir": agendamento pendente, sem data da visita. */
  aDefinir?: boolean;
  dataVisita?: string | null;
  /** Só execução: último dia do período (vazio = um dia só). */
  dataFim?: string | null;
  hora?: string | null;
  dataExecucao?: string | null;
  /** Só com "data a definir": quando o aviso deve voltar a chamar atenção. */
  lembrarEm?: string | null;
  equipe?: MembroEquipe[];
  equipamentos?: string[];
  checklist?: { item: string; ok?: boolean }[];
}

/** Onde fica uma OS: o projeto e o endereço da obra. */
export interface LocalOS {
  projetoId: string | null;
  endereco: string | null;
}

/** Agendamento ATIVO já gravado (não substituído), com a OS e o local. */
export interface AgendamentoRef {
  id: string;
  inspecao_id: string;
  tipo: string;
  data_visita: string | null;
  /** Execução de vários dias: último dia (null = um dia). */
  data_fim?: string | null;
  /** Agendamento de inspeção: execução prevista (Fase 6 compara com o início). */
  data_execucao?: string | null;
  a_definir?: boolean;
  equipe: MembroEquipe[];
  equipamentos: string[];
  /** Identificação da OS. */
  os?: string | null;
  projeto_id?: string | null;
  /** Código (ou pedido) do projeto. */
  projeto?: string | null;
  endereco?: string | null;
}

export interface ContextoAgendamento {
  /** AAAA-MM-DD no fuso de Brasília. */
  hoje: string;
  inspecaoId: string;
  /** Abertura do projeto da OS. */
  dataAbertura?: string | null;
  local?: LocalOS;
  /** Edição: o agendamento como está gravado. */
  original?: { id: string; data_visita: string | null; data_fim?: string | null } | null;
  /** Agendamentos ativos DESTA OS (todas as datas). */
  daOS?: AgendamentoRef[];
  /** Agendamentos ativos de outras OSs que tocam algum dia da visita/período. */
  noDia?: AgendamentoRef[];
  /** Ids dos usuários ativos. undefined = não checado. */
  usuariosAtivos?: string[];
  /** Nomes de equipamento do Catálogo. */
  catalogo?: string[];
  // ── Fase 6 (execução) — undefined = não checado (não avisa sem saber) ──
  /** Relatórios de inspeção (não excluídos) desta OS. */
  relatoriosInspecao?: { versao: number; status: string }[];
  /** Funções do cadastro (gp_profiles.funcao) por id de usuário. */
  funcoes?: Record<string, string | null>;
  /** Funções cadastradas (gp_funcoes) — quais contam como liderança.
   * Sem a lista, vale a carga inicial (Coordenador e Engenheiro). */
  catalogoFuncoes?: CatalogoLideranca | null;
  /** Equipamentos previstos no procedimento da OS (nomes do Catálogo). */
  equipamentosProcedimento?: string[];
  /** Código do procedimento da OS (só para a mensagem). */
  procedimento?: string | null;
}

export const ROTULOS_AGENDAMENTO: Record<string, string> = {
  dataVisita: "Data da visita",
  dataFim: "Fim da execução",
  hora: "Hora",
  dataExecucao: "Execução prevista",
  lembrarEm: "Lembrar em",
  equipe: "Equipe",
  equipamentos: "Equipamentos",
  checklist: "Checklist",
};

/** "2026-11-05" → "05/11". */
export function dataCurta(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
}

/** "Remarcação" e conflitos falam do período: "05/11" ou "05/11 a 07/11". */
function periodoTexto(p: Periodo | null): string {
  return p ? textoPeriodo(p) : "data a definir";
}

export type CatalogoLideranca = Pick<FuncaoRef, "nome" | "lideranca_equipe" | "ativo">[];

/** A função (gp_profiles.funcao) conta como liderança da equipe? Marca
 * "lideranca_equipe" da função em gp_funcoes (sem acento/caixa). Sem
 * catálogo: carga inicial (Coordenador e Engenheiro). */
export function funcaoLideranca(funcao: string | null | undefined, catalogo?: CatalogoLideranca | null): boolean {
  return !!encontrarFuncao(funcao, catalogo || FUNCOES_PADRAO)?.lideranca_equipe;
}

/** "Coordenador ou Engenheiro" — funções ativas que contam como liderança
 * ("" = nenhuma: o aviso de equipe sem liderança não se aplica). */
export function textoLiderancas(catalogo?: CatalogoLideranca | null): string {
  const nomes = (catalogo || FUNCOES_PADRAO).filter((f) => f.lideranca_equipe && f.ativo !== false).map((f) => f.nome);
  if (nomes.length <= 1) return nomes[0] || "";
  return `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
}

/** Equipe da execução sem ninguém de liderança (só avisa se alguma função
 * conta como liderança e as funções dos usuários são conhecidas). */
export function equipeSemLideranca(
  equipe: { id: string }[],
  funcoes: Record<string, string | null> | undefined,
  catalogo?: CatalogoLideranca | null
): boolean {
  if (!funcoes || equipe.length === 0) return false;
  if (!(catalogo || FUNCOES_PADRAO).some((f) => f.lideranca_equipe)) return false;
  return !equipe.some((m) => funcaoLideranca(funcoes[m.id], catalogo));
}

export function msgSemLideranca(catalogo?: CatalogoLideranca | null): string {
  const t = textoLiderancas(catalogo);
  return `Nenhuma liderança${t ? ` (${t})` : ""} na equipe da execução`;
}

/** Nomes do Catálogo dos equipamentos previstos no procedimento (slugs, como
 *  o checklist de equipamentos lê de gp_procedimentos.equipamentos). */
export function nomesEquipamentosProcedimento(
  slugs: string[] | null | undefined,
  catalogo: { slug?: string | null; id?: string | null; nome?: string | null }[] = []
): string[] {
  return (slugs || []).flatMap((s) => {
    const e = catalogo.find((x) => (x.slug || x.id) === s);
    return e?.nome ? [e.nome] : [];
  });
}

/** Equipamentos do procedimento (nomes) que faltam na lista do agendamento. */
export function equipamentosFaltando(previstos: string[] = [], lista: string[] = []): string[] {
  const tem = new Set(lista.map(normalizarEquipamento));
  const vistos = new Set<string>();
  return previstos.filter((p) => {
    const n = normalizarEquipamento(p);
    if (!n || tem.has(n) || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

/** Itens de segurança (CHECKLIST_PADRAO) presentes no checklist e não marcados. */
export function segurancaPendente(checklist: { item: string; ok?: boolean }[] = []): string[] {
  const padrao = new Set(CHECKLIST_PADRAO.map(normalizarEquipamento));
  return checklist.filter((c) => padrao.has(normalizarEquipamento(c.item)) && !c.ok).map((c) => c.item);
}

/** Relatório de inspeção existe mas nenhum aprovado/assinado: o atual
 *  (versão mais alta), para a mensagem; null = nada a avisar. */
export function relatorioInspecaoPendente(rels: { versao: number; status: string }[] | undefined): { versao: number; status: string } | null {
  if (!rels || rels.length === 0) return null;
  if (rels.some((r) => r.status === "aprovado" || r.status === "assinado")) return null;
  return [...rels].sort((a, b) => b.versao - a.versao)[0];
}

const STATUS_REL: Record<string, string> = {
  rascunho: "rascunho", em_aprovacao: "em aprovação", ajustar: "reprovado — “Ajustar”", substituido: "substituído",
};

/** Previsão de execução: data_execucao do agendamento de INSPEÇÃO ativo. */
export function execucaoPrevista(daOS: AgendamentoRef[] | undefined): string | null {
  const v = (daOS || []).find((a) => a.tipo === "inspecao" && a.data_execucao)?.data_execucao;
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** Mudou o início ou o fim do período — é remarcação. */
export function periodoMudou(
  antes: { data_visita: string | null; data_fim?: string | null } | null | undefined,
  depois: { data_visita: string | null; data_fim?: string | null }
): boolean {
  if (!antes?.data_visita) return false;
  const a = periodoDe(antes);
  const b = periodoDe(depois);
  if (!b) return true;
  return !a || a.inicio !== b.inicio || a.fim !== b.fim;
}

/** Equipamento para comparação: sem acento, caixa e pontuação. */
export function normalizarEquipamento(s: string | null | undefined): string {
  return semPontuacao(normalizarTexto(s)).toLowerCase();
}

/** Mesmo local: mesmo projeto, ou endereços (preenchidos) iguais. */
export function mesmoLocal(a: LocalOS | undefined, b: LocalOS | undefined): boolean {
  if (!a || !b) return false;
  if (a.projetoId && a.projetoId === b.projetoId) return true;
  const ea = normalizarEndereco(a.endereco);
  return !!ea && ea === normalizarEndereco(b.endereco);
}

function localDe(a: AgendamentoRef): LocalOS {
  return { projetoId: a.projeto_id || null, endereco: a.endereco || null };
}

/** "OS “TQ-01” — projeto 07/MG/26 (Rua A, 100)". */
export function descreverOndeAgendado(a: AgendamentoRef): string {
  const proj = a.projeto ? ` — projeto ${a.projeto}` : "";
  const end = a.endereco ? ` (${a.endereco})` : "";
  return `OS “${a.os || "sem identificação"}”${proj}${end}`;
}

/** Nome do Catálogo parecido com o digitado (que não está no Catálogo), ou
 * null. Igual depois de normalizar não conta: já é o item do Catálogo. */
export function sugestaoCatalogo(nome: string | null | undefined, catalogo: string[] = []): string | null {
  const n = normalizarEquipamento(nome);
  if (!n || catalogo.some((c) => normalizarEquipamento(c) === n)) return null;
  return catalogo.find((c) => nomesParecidos(nome, c, normalizarEquipamento)) || null;
}

/** Nome como está no Catálogo, se o digitado for o mesmo item escrito de
 * outro jeito ("detector de gases" → "Detector de Gases"); senão o próprio. */
export function nomeDoCatalogo(nome: string, catalogo: string[] = []): string {
  const n = normalizarEquipamento(nome);
  return catalogo.find((c) => normalizarEquipamento(c) === n) || nome.trim();
}

/** Agendamentos ativos desta OS que o novo vai substituir (remarcação): os
 * do mesmo tipo. Na edição, nenhum — a própria linha é que muda. */
export function agendamentosSubstituidos(d: Pick<DadosAgendamento, "tipo" | "dataVisita" | "aDefinir">, ctx: Pick<ContextoAgendamento, "daOS" | "original">): AgendamentoRef[] {
  if (ctx.original) return [];
  const data = d.aDefinir ? null : d.dataVisita || null;
  return (ctx.daOS || []).filter((a) => a.tipo === d.tipo && !(data && a.data_visita === data));
}

export function validarAgendamento(d: DadosAgendamento, ctx: ContextoAgendamento): ResultadoValidacao {
  const r = novoResultado();
  const aDefinir = !!d.aDefinir;
  const execucao = d.tipo === "execucao";
  const data = aDefinir ? "" : (d.dataVisita || "").trim();
  const dataOriginal = ctx.original?.data_visita || "";
  const dataMudou = !ctx.original || data !== dataOriginal;
  const fimDigitado = aDefinir ? "" : (d.dataFim || "").trim();
  /** Período válido do que está sendo agendado (null sem data ou data inválida). */
  let periodo: Periodo | null = data && dataIsoValida(data) ? { inicio: data, fim: data } : null;

  // Data da visita
  if (!aDefinir) {
    if (!data) addErro(r, "dataVisita", "Informe a data da visita (ou marque “Data a definir”).");
    else if (!dataIsoValida(data)) addErro(r, "dataVisita", "Data inválida.");
    else {
      if (dataMudou && data < ctx.hoje) {
        addErro(r, "dataVisita", "A data da visita não pode estar no passado — o agendamento é sempre a PRÓXIMA visita.");
      }
      if (dataMudou && ctx.dataAbertura && data < ctx.dataAbertura) {
        addErro(r, "dataVisita", `A visita não pode ser antes da abertura do projeto (${dataCurta(ctx.dataAbertura)}/${ctx.dataAbertura.slice(0, 4)}).`);
      }
      const igual = (ctx.daOS || []).find((a) => a.id !== ctx.original?.id && a.tipo === d.tipo && a.data_visita === data);
      if (igual) {
        addErro(r, "dataVisita", `Já há agendamento de ${d.tipo === "execucao" ? "execução" : "inspeção"} desta OS em ${dataCurta(data)}. Edite o existente.`);
      }
    }
    if (data && !(d.hora || "").trim()) addAviso(r, "hora", "Hora em branco — a equipe não saberá o horário.");
  }

  // Fim da execução (período)
  if (fimDigitado) {
    if (!execucao) addErro(r, "dataFim", "Só a execução tem período — a inspeção é de um dia. Deixe o fim em branco.");
    else if (!dataIsoValida(fimDigitado)) addErro(r, "dataFim", "Data inválida.");
    else if (data && dataIsoValida(data) && fimDigitado < data) {
      addErro(r, "dataFim", "O fim da execução não pode ser antes do início.");
    } else if (periodo) {
      periodo = { inicio: data, fim: fimDigitado };
      const dias = duracaoDias(periodo);
      if (dias > PERIODO_MAX_DIAS) {
        addAviso(r, "dataFim", `Execução de ${dias} dias (mais de ${PERIODO_MAX_DIAS}) — confira o fim; se for isso mesmo, pode seguir.`);
      }
    }
  }

  // Fim de semana / feriado: o dia da visita ou cada dia do período
  if (periodo) {
    if (periodo.inicio === periodo.fim) {
      const fds = fimDeSemana(data);
      if (fds) addAviso(r, "dataVisita", `A visita cai num ${fds}.`);
      const feriado = feriadoNacional(data);
      if (feriado) addAviso(r, "dataVisita", `${dataCurta(data)} é feriado nacional (${feriado}).`);
    } else {
      const nu = diasNaoUteis(periodo);
      if (nu.length) {
        addAviso(r, "dataFim", `O período inclui ${nu.length} dia(s) sem expediente: ${nu.map((x) => `${dataCurta(x.dia)} (${x.motivo})`).join(", ")}.`);
      }
    }
  }

  // "Lembrar em" (só com data a definir)
  const lembrar = aDefinir ? (d.lembrarEm || "").trim() : "";
  if (lembrar) {
    if (!dataIsoValida(lembrar)) addErro(r, "lembrarEm", "Data inválida.");
    else if (lembrar < ctx.hoje) addErro(r, "lembrarEm", "O lembrete não pode ser no passado.");
  }

  // Execução prevista
  const exec = (d.dataExecucao || "").trim();
  if (exec) {
    if (!dataIsoValida(exec)) addErro(r, "dataExecucao", "Data inválida.");
    else if (data && dataIsoValida(data) && exec < data) {
      addErro(r, "dataExecucao", "A execução prevista não pode ser antes da data da visita.");
    }
  }

  // Remarcação: o agendamento atual do mesmo tipo sai de cena
  const novoPeriodo = { data_visita: periodo ? periodo.inicio : null, data_fim: periodo ? periodo.fim : null };
  if (ctx.original && dataOriginal && periodoMudou(ctx.original, novoPeriodo)) {
    addAviso(r, "dataVisita", `Remarcação: ${periodoTexto(periodoDe(ctx.original))} → ${periodoTexto(periodo)}. A data anterior fica no histórico.`);
  }
  const substituidos = agendamentosSubstituidos(d, ctx);
  substituidos.forEach((a) =>
    addAviso(r, "dataVisita", a.data_visita
      ? `O agendamento de ${periodoTexto(periodoDe(a))} será substituído (fica no histórico como remarcado).`
      : "O agendamento com data a definir será substituído por este.")
  );

  // ⛔ Dois agendamentos ATIVOS do mesmo tipo nesta OS com dias em comum. A
  // remarcação substitui o anterior; isto pega o que sobraria ativo (dado
  // antigo, edição de um enquanto outro segue ativo). O mesmo início já é
  // barrado acima ("Edite o existente").
  if (periodo) {
    (ctx.daOS || []).forEach((a) => {
      if (a.id === ctx.original?.id || a.tipo !== d.tipo || a.data_visita === data || substituidos.some((s) => s.id === a.id)) return;
      const p = periodoDe(a);
      if (p && periodosSobrepoem(p, periodo!)) {
        addErro(r, execucao ? "dataFim" : "dataVisita",
          `Já há ${execucao ? "execução" : "inspeção"} ativa desta OS em ${textoPeriodo(p)} — os períodos se cruzam. Edite ou remarque a existente.`);
      }
    });
  }

  // Conflito com OUTRO local em qualquer dia em comum
  const outrosLocais = (ctx.noDia || []).flatMap((a) => {
    if (aDefinir || !periodo || a.inspecao_id === ctx.inspecaoId || mesmoLocal(ctx.local, localDe(a))) return [];
    const p = periodoDe(a);
    const comum = p ? intersecao(p, periodo) : null;
    return comum ? [{ a, quando: textoPeriodo(comum) }] : [];
  });

  // Equipe
  const equipe = (d.equipe || []).filter((m) => m && m.id);
  if (!aDefinir && equipe.length === 0) addErro(r, "equipe", "Escolha ao menos uma pessoa para a equipe.");
  if (ctx.usuariosAtivos) {
    equipe.filter((m) => !ctx.usuariosAtivos!.includes(m.id)).forEach((m) =>
      addErro(r, "equipe", `${m.nome} não é um usuário ativo — tire da equipe.`)
    );
  }
  equipe.forEach((m) => {
    outrosLocais.filter(({ a }) => (a.equipe || []).some((x) => x.id === m.id)).forEach(({ a, quando }) =>
      addAviso(r, "equipe", `${m.nome} já está agendado(a) em ${quando} na ${descreverOndeAgendado(a)}.`)
    );
  });
  if (execucao && equipeSemLideranca(equipe, ctx.funcoes, ctx.catalogoFuncoes)) {
    addAviso(r, "equipe", `${msgSemLideranca(ctx.catalogoFuncoes)} — confira quem responde pelo serviço em campo.`);
  }

  // Equipamentos
  const equipamentos = (d.equipamentos || []).map((e) => (e || "").trim()).filter(Boolean);
  duplicadosEmLista(equipamentos, normalizarEquipamento).forEach(({ indice, primeiro }) =>
    addErro(r, "equipamentos", `“${equipamentos[indice]}” repetido (igual a “${equipamentos[primeiro]}”).`)
  );
  equipamentos.forEach((e) => {
    const s = sugestaoCatalogo(e, ctx.catalogo);
    if (s) addAviso(r, "equipamentos", `“${e}” não está no Catálogo — seria “${s}”?`);
    const n = normalizarEquipamento(e);
    outrosLocais.filter(({ a }) => (a.equipamentos || []).some((x) => normalizarEquipamento(x) === n)).forEach(({ a, quando }) =>
      addAviso(r, "equipamentos", `“${e}” já está agendado em ${quando} na ${descreverOndeAgendado(a)} — é uma unidade só?`)
    );
  });
  if (execucao) {
    const faltam = equipamentosFaltando(ctx.equipamentosProcedimento, equipamentos);
    if (faltam.length) {
      addAviso(r, "equipamentos", `Previsto(s) no procedimento${ctx.procedimento ? ` ${ctx.procedimento}` : ""} e fora desta lista: ${faltam.join(", ")}.`);
    }
  }

  // Checklist
  const itens = (d.checklist || []).map((c) => (c?.item || "").trim());
  duplicadosEmLista(itens, normalizarEquipamento).forEach(({ indice }) =>
    addErro(r, "checklist", `Item “${itens[indice]}” repetido no checklist.`)
  );
  if (execucao && periodo && periodo.inicio <= ctx.hoje) {
    const pend = segurancaPendente(d.checklist);
    if (pend.length) {
      addAviso(r, "checklist", `A execução ${periodo.inicio < ctx.hoje ? "já começou" : "começa hoje"} e há item(ns) de segurança sem marcar: ${pend.join(", ")}.`);
    }
  }

  // Execução: relatório de inspeção e previsão
  if (execucao) {
    const rel = relatorioInspecaoPendente(ctx.relatoriosInspecao);
    if (rel) {
      addAviso(r, "dataVisita", `O Relatório de Inspeção desta OS ainda não foi aprovado (v${rel.versao} — ${STATUS_REL[rel.status] || rel.status}). Confira antes de mobilizar a equipe.`);
    }
    const previsao = execucaoPrevista(ctx.daOS);
    if (previsao && periodo && periodo.inicio !== previsao) {
      addAviso(r, "dataVisita", `O início (${dataCurta(periodo.inicio)}) difere da execução prevista no agendamento da inspeção (${dataCurta(previsao)}).`);
    }
  }

  return r;
}
