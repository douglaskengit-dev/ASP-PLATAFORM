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
 * o mesmo local (vários tanques no mesmo site não conflitam). */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { dataIsoValida } from "./formatos";
import { duplicadosEmLista, nomesParecidos, normalizarTexto, semPontuacao } from "./texto";
import { normalizarEndereco } from "./projeto";
import { feriadoNacional, fimDeSemana } from "./feriados";

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
  original?: { id: string; data_visita: string | null } | null;
  /** Agendamentos ativos DESTA OS (todas as datas). */
  daOS?: AgendamentoRef[];
  /** Agendamentos ativos de outras OSs na data da visita. */
  noDia?: AgendamentoRef[];
  /** Ids dos usuários ativos. undefined = não checado. */
  usuariosAtivos?: string[];
  /** Nomes de equipamento do Catálogo. */
  catalogo?: string[];
}

export const ROTULOS_AGENDAMENTO: Record<string, string> = {
  dataVisita: "Data da visita",
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
  const data = aDefinir ? "" : (d.dataVisita || "").trim();
  const dataOriginal = ctx.original?.data_visita || "";
  const dataMudou = !ctx.original || data !== dataOriginal;

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
      const fds = fimDeSemana(data);
      if (fds) addAviso(r, "dataVisita", `A visita cai num ${fds}.`);
      const feriado = feriadoNacional(data);
      if (feriado) addAviso(r, "dataVisita", `${dataCurta(data)} é feriado nacional (${feriado}).`);
      const igual = (ctx.daOS || []).find((a) => a.id !== ctx.original?.id && a.tipo === d.tipo && a.data_visita === data);
      if (igual) {
        addErro(r, "dataVisita", `Já há agendamento de ${d.tipo === "execucao" ? "execução" : "inspeção"} desta OS em ${dataCurta(data)}. Edite o existente.`);
      }
    }
    if (data && !(d.hora || "").trim()) addAviso(r, "hora", "Hora em branco — a equipe não saberá o horário.");
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
  if (ctx.original && dataOriginal && dataMudou) {
    addAviso(r, "dataVisita", `Remarcação: ${dataCurta(dataOriginal)} → ${data ? dataCurta(data) : "data a definir"}. A data anterior fica no histórico.`);
  }
  agendamentosSubstituidos(d, ctx).forEach((a) =>
    addAviso(r, "dataVisita", a.data_visita
      ? `O agendamento de ${dataCurta(a.data_visita)} será substituído (fica no histórico como remarcado).`
      : "O agendamento com data a definir será substituído por este.")
  );

  const outrosLocais = (ctx.noDia || []).filter((a) =>
    !aDefinir && !!data && a.data_visita === data && a.inspecao_id !== ctx.inspecaoId && !mesmoLocal(ctx.local, localDe(a))
  );

  // Equipe
  const equipe = (d.equipe || []).filter((m) => m && m.id);
  if (!aDefinir && equipe.length === 0) addErro(r, "equipe", "Escolha ao menos uma pessoa para a equipe.");
  if (ctx.usuariosAtivos) {
    equipe.filter((m) => !ctx.usuariosAtivos!.includes(m.id)).forEach((m) =>
      addErro(r, "equipe", `${m.nome} não é um usuário ativo — tire da equipe.`)
    );
  }
  equipe.forEach((m) => {
    outrosLocais.filter((a) => (a.equipe || []).some((x) => x.id === m.id)).forEach((a) =>
      addAviso(r, "equipe", `${m.nome} já está agendado(a) em ${dataCurta(data)} na ${descreverOndeAgendado(a)}.`)
    );
  });

  // Equipamentos
  const equipamentos = (d.equipamentos || []).map((e) => (e || "").trim()).filter(Boolean);
  duplicadosEmLista(equipamentos, normalizarEquipamento).forEach(({ indice, primeiro }) =>
    addErro(r, "equipamentos", `“${equipamentos[indice]}” repetido (igual a “${equipamentos[primeiro]}”).`)
  );
  equipamentos.forEach((e) => {
    const s = sugestaoCatalogo(e, ctx.catalogo);
    if (s) addAviso(r, "equipamentos", `“${e}” não está no Catálogo — seria “${s}”?`);
    const n = normalizarEquipamento(e);
    outrosLocais.filter((a) => (a.equipamentos || []).some((x) => normalizarEquipamento(x) === n)).forEach((a) =>
      addAviso(r, "equipamentos", `“${e}” já está agendado em ${dataCurta(data)} na ${descreverOndeAgendado(a)} — é uma unidade só?`)
    );
  });

  // Checklist
  const itens = (d.checklist || []).map((c) => (c?.item || "").trim());
  duplicadosEmLista(itens, normalizarEquipamento).forEach(({ indice }) =>
    addErro(r, "checklist", `Item “${itens[indice]}” repetido no checklist.`)
  );

  return r;
}
