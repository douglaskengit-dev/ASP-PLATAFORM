/** Dashboard de Operações — agregações PURAS (sem Supabase), testáveis.
 *
 * O carregamento fica em lib/asp/dashboard-dados.ts (route client, RLS); a
 * rota /api/dashboard só junta os dois. Convenções:
 *  · Datas "dia" (AAAA-MM-DD) no fuso de Brasília; timestamptz é convertido
 *    com diaBrasilia() antes de comparar com o período.
 *  · O loader já tira o que está na lixeira (excluido_em), agendamentos
 *    substituídos por remarcação (substituido_em) e o que não é da OS ativa.
 *    Aqui, OS cujo projeto não veio (projeto na lixeira) também sai.
 *  · Dois tipos de indicador: "estado atual" (fotografia de agora, ignora o
 *    período) e "no período" (eventos com data dentro do período). */
import {
  dataIsoValida, diaBrasilia, diasSemRdo, execucaoAtiva, foraDoLimite, hojeBrasil, intersecao, mesmoLocal,
  normalizarEquipamento, pendenciasEncerramento, periodoDe, procedimentoUsaLaudo, relatorioAtual,
  rotuloCategoria, somarDias, type Periodo, type SecaoPendencia,
} from "../validacao";
import { pendenciasColeta, progressoColeta, registroVazio, type RegistroFotosExecucao } from "./fotos-execucao";
import { FASES, PRIMEIRA_FASE_INSPECAO, ULTIMA_FASE } from "./fases";

// ── Entrada (o que o loader traz) ────────────────────────────────────────────

export interface ProjetoBruto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco?: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  data_abertura: string | null;
  criado_em: string;
  concluido_em: string | null;
}
export interface OsBruta {
  id: string;
  projeto_id: string;
  identificacao: string;
  fase: number;
  procedimento: string | null;
  criado_em: string;
  /** Data (dia) do encerramento — escolhida por quem encerra. */
  encerrada_em: string | null;
  encerramento_manual?: boolean | null;
}
export interface HistoricoBruto {
  inspecao_id: string;
  fase_de: number | null;
  fase_para: number | null;
  acao: string;
  motivo_categoria: string | null;
  criado_em: string;
}
export interface RelatorioBruto {
  id: string;
  inspecao_id: string;
  tipo: string;
  versao: number;
  status: string;
  enviado_em: string | null;
  avaliado_em: string | null;
  assinado_em: string | null;
  criado_em: string;
  laudo_pdf?: { caminho?: string | null } | null;
  laudo_depois?: string[][] | null;
}
export interface AgendamentoBruto {
  id: string;
  inspecao_id: string;
  tipo: string;
  data_visita: string | null;
  data_fim: string | null;
  hora: string | null;
  equipe: { id: string; nome: string }[] | null;
  equipamentos: string[] | null;
  a_definir: boolean;
  lembrar_em: string | null;
}
export interface RdoBruto {
  id: string;
  projeto_id: string;
  numero: number;
  data: string;
  inspecoes: string[] | null;
  arquivo_path: string | null;
  arquivo_em: string | null;
  atualizado_em: string;
}
export interface FotosBruto extends RegistroFotosExecucao {
  inspecao_id: string;
}
export interface ColetaBruta {
  inspecao_id: string;
  tipo: string;
  aprovada_em: string | null;
}
export interface EntregaBruta {
  inspecao_id: string;
  data: string;
}
export interface ProcedimentoBruto {
  codigo: string;
  nome: string | null;
  agua_potavel?: boolean | null;
  limpeza_robotizada?: boolean | null;
}
export interface DadosDashboard {
  projetos: ProjetoBruto[];
  oss: OsBruta[];
  historico: HistoricoBruto[];
  relatorios: RelatorioBruto[];
  agendamentos: AgendamentoBruto[];
  rdos: RdoBruto[];
  /** Só das OSs que precisam (fase ≥ 7, abertas) — ver dashboard-dados.ts. */
  fotos: FotosBruto[];
  coletas: ColetaBruta[];
  entregas: EntregaBruta[];
  procedimentos: ProcedimentoBruto[];
}

// ── Filtros e período ────────────────────────────────────────────────────────

export type ChavePeriodo = "7" | "30" | "90" | "ano" | "personalizado";
export const PERIODOS: { chave: ChavePeriodo; rotulo: string }[] = [
  { chave: "7", rotulo: "Últimos 7 dias" },
  { chave: "30", rotulo: "Últimos 30 dias" },
  { chave: "90", rotulo: "Últimos 90 dias" },
  { chave: "ano", rotulo: "Este ano" },
  { chave: "personalizado", rotulo: "Personalizado" },
];

export interface FiltrosDashboard {
  periodo: ChavePeriodo;
  /** Só no personalizado. */
  de?: string | null;
  ate?: string | null;
  cliente?: string | null;
  procedimento?: string | null;
  /** Id do usuário na equipe de algum agendamento ativo da OS. */
  pessoa?: string | null;
}

export interface Intervalo {
  de: string;
  ate: string;
}

const isoValido = (s: unknown): s is string => typeof s === "string" && dataIsoValida(s);

/** Dias corridos de `a` até `b` (b − a). */
export function diferencaDias(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/** Período (dias inclusos, Brasília). "7" = hoje e os 6 dias anteriores;
 *  "ano" = 01/01 do ano corrente até hoje; personalizado inválido cai em 30. */
export function intervaloDoPeriodo(f: Pick<FiltrosDashboard, "periodo" | "de" | "ate">, hoje: string): Intervalo {
  if (f.periodo === "ano") return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje };
  if (f.periodo === "personalizado" && isoValido(f.de) && isoValido(f.ate)) {
    return f.de <= f.ate ? { de: f.de, ate: f.ate } : { de: f.ate, ate: f.de };
  }
  const n = f.periodo === "7" ? 7 : f.periodo === "90" ? 90 : 30;
  return { de: somarDias(hoje, -(n - 1)), ate: hoje };
}

/** Lê os filtros da query string (?periodo=&de=&ate=&cliente=&procedimento=&pessoa=). */
export function lerFiltros(sp: URLSearchParams): FiltrosDashboard {
  const p = sp.get("periodo") || "30";
  const periodo = (PERIODOS.some((x) => x.chave === p) ? p : "30") as ChavePeriodo;
  const limpo = (k: string) => {
    const v = (sp.get(k) || "").trim();
    return v && v.length <= 200 ? v : null;
  };
  return {
    periodo,
    de: periodo === "personalizado" && isoValido(sp.get("de")) ? sp.get("de") : null,
    ate: periodo === "personalizado" && isoValido(sp.get("ate")) ? sp.get("ate") : null,
    cliente: limpo("cliente"),
    procedimento: limpo("procedimento"),
    pessoa: limpo("pessoa"),
  };
}

export function noIntervalo(dia: string | null | undefined, i: Intervalo): boolean {
  return !!dia && dia >= i.de && dia <= i.ate;
}

// ── Estatística ──────────────────────────────────────────────────────────────

export interface Estatistica {
  n: number;
  media: number;
  mediana: number;
}

export function estatistica(valores: number[]): Estatistica | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const meio = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  return { n: v.length, media: v.reduce((s, x) => s + x, 0) / v.length, mediana };
}

// ── Histórico de fases → permanências ────────────────────────────────────────

export interface Permanencia {
  fase: number;
  /** ISO (timestamptz) de entrada e saída. */
  inicio: string;
  fim: string;
}

/** Entrada na fase atual e as permanências já encerradas de uma OS, a partir
 *  do histórico. A OS nasce na fase 2 (criado_em). Cada linha com mudança de
 *  fase (fase_de ≠ fase_para) fecha a permanência na fase_de; "encerrar" fecha
 *  a fase 10 e "reabrir" a reabre. Se a corrente quebra (fase_de diferente da
 *  fase em que a OS estava, dado legado), a permanência é descartada — não dá
 *  para saber quando ela começou — e a contagem recomeça dali. */
export function permanenciasDaOS(
  os: Pick<OsBruta, "fase" | "criado_em" | "encerrada_em">,
  hist: Pick<HistoricoBruto, "fase_de" | "fase_para" | "acao" | "criado_em">[],
): { fechadas: Permanencia[]; entradaAtual: string } {
  const ord = [...hist].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  const fechadas: Permanencia[] = [];
  let cur: { fase: number; desde: string } | null = { fase: PRIMEIRA_FASE_INSPECAO, desde: os.criado_em };
  for (const h of ord) {
    const de = Number(h.fase_de), para = Number(h.fase_para);
    if (h.acao === "encerrar") {
      if (cur && cur.fase === ULTIMA_FASE) fechadas.push({ fase: ULTIMA_FASE, inicio: cur.desde, fim: h.criado_em });
      cur = null;
      continue;
    }
    if (h.acao === "reabrir") {
      cur = { fase: Number.isFinite(para) ? para : ULTIMA_FASE, desde: h.criado_em };
      continue;
    }
    if (!Number.isFinite(para) || de === para) continue;
    if (cur && cur.fase === de) fechadas.push({ fase: de, inicio: cur.desde, fim: h.criado_em });
    cur = { fase: para, desde: h.criado_em };
  }
  // Fase atual: a última entrada registrada nela (ou a abertura da OS).
  const entradaAtual = cur && cur.fase === os.fase ? cur.desde : ultimaEntrada(os, ord);
  return { fechadas, entradaAtual };
}

function ultimaEntrada(os: Pick<OsBruta, "fase" | "criado_em">, ord: Pick<HistoricoBruto, "fase_de" | "fase_para" | "acao" | "criado_em">[]): string {
  for (let i = ord.length - 1; i >= 0; i--) {
    const h = ord[i];
    if ((Number(h.fase_para) === os.fase && Number(h.fase_de) !== os.fase) || (h.acao === "reabrir" && Number(h.fase_para) === os.fase)) return h.criado_em;
  }
  return os.criado_em;
}

const DIA_MS = 86400000;
const duracaoEmDias = (p: Permanencia) => (Date.parse(p.fim) - Date.parse(p.inicio)) / DIA_MS;

// ── Saída ────────────────────────────────────────────────────────────────────

/** OS parada: mais que isto (dias corridos) na fase atual. */
export const LIMITE_PARADA_DIAS = 15;
/** Janela da agenda e da ocupação (dias a partir de hoje, inclusive). */
export const JANELA_AGENDA_DIAS = 30;
const MAX_LISTA = 25;

export interface RefOS {
  id: string;
  identificacao: string;
  fase: number;
  projetoId: string;
  projeto: string;
  cliente: string | null;
}

export interface Taxa {
  avaliacoes: number;
  reprovacoes: number;
  /** 0..1; null sem avaliações. */
  taxa: number | null;
}

export interface ItemFila {
  os: RefOS;
  relatorioId: string;
  tipo: string;
  versao: number;
  desde: string | null;
  dias: number | null;
}

export interface ItemAgenda {
  id: string;
  os: RefOS;
  tipo: string;
  inicio: string;
  fim: string;
  hora: string | null;
  equipe: string[];
  equipamentos: string[];
}

export interface Conflito {
  inicio: string;
  fim: string;
  pessoas: string[];
  equipamentos: string[];
  a: { os: RefOS; tipo: string };
  b: { os: RefOS; tipo: string };
}

export interface Dashboard {
  geradoEm: string;
  hoje: string;
  periodo: Intervalo & { chave: ChavePeriodo };
  filtros: FiltrosDashboard;
  opcoes: {
    clientes: { id: string; nome: string }[];
    procedimentos: { codigo: string; nome: string }[];
    pessoas: { id: string; nome: string }[];
  };
  /** Base do recorte: quantas OSs/projetos entraram depois dos filtros. */
  base: { oss: number; projetos: number };
  kpis: {
    osAndamento: number;
    osAbertasPeriodo: number;
    osEncerradasPeriodo: number;
    encerradasManualPeriodo: number;
    projetosConcluidosPeriodo: number;
    projetosAtivos: number;
    leadTime: Estatistica | null;
    reprovacao: { inspecao: Taxa; execucao: Taxa; total: Taxa };
    aguardandoAprovacao: { total: number; maisAntigoDias: number | null };
    aguardandoAssinatura: { total: number; maisAntigoDias: number | null };
    encerramento: { naFase10: number; comPendencia: number };
    paradas: number;
    entregasPeriodo: number;
  };
  funil: {
    fase: number;
    titulo: string;
    area: string;
    abertas: number;
    paradas: number;
    idadeMediana: number | null;
    oss: (RefOS & { dias: number })[];
  }[];
  duracaoFases: { fase: number; titulo: string; n: number; media: number | null; mediana: number | null }[];
  motivos: { categoria: string; rotulo: string; inspecao: number; execucao: number; total: number }[];
  filas: { aprovacao: ItemFila[]; assinatura: ItemFila[] };
  encerramento: { os: RefOS; dias: number; entregas: number; pendencias: { texto: string; secao: SecaoPendencia }[] }[];
  agenda: {
    ate7: string;
    ate30: string;
    proximos: ItemAgenda[];
    proximosTotal: number;
    aDefinir: {
      total: number; vencidos: number; hoje: number; semLembrete: number;
      itens: { id: string; os: RefOS; tipo: string; lembrar_em: string | null }[];
    };
    ocupacaoPessoas: { id: string; nome: string; dias: number }[];
    ocupacaoEquipamentos: { nome: string; dias: number }[];
    conflitos: Conflito[];
  };
  campo: {
    rdoFaltando: { os: RefOS; dias: string[] }[];
    rdoDiasFaltando: number;
    fotosIncompletas: { os: RefOS; feitos: number; total: number; pendencias: string[] }[];
    medicoesSemAprovacao: { os: RefOS; medicoes: number }[];
    laudosForaDoLimite: { os: RefOS; relatorioId: string; versao: number; enviado: string | null; parametros: string[] }[];
    laudosAvaliados: number;
    /** Tamanho real de cada lista (as listas vêm cortadas). */
    totais: { rdo: number; fotos: number; medicoes: number; laudos: number };
  };
  clientes: {
    id: string | null; nome: string; projetos: number; osAbertas: number;
    osAbertasPeriodo: number; osEncerradasPeriodo: number; entregasPeriodo: number;
  }[];
}

const taxa = (avaliacoes: number, reprovacoes: number): Taxa => ({ avaliacoes, reprovacoes, taxa: avaliacoes ? reprovacoes / avaliacoes : null });

function porChave<T, K>(lista: T[], chave: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of lista) {
    const k = chave(x);
    const l = m.get(k);
    if (l) l.push(x); else m.set(k, [x]);
  }
  return m;
}

/** Monta o Dashboard inteiro. `hoje` = dia em Brasília; `agora` = ISO. */
export function montarDashboard(d: DadosDashboard, f: FiltrosDashboard, hoje: string = hojeBrasil(), agora: string = new Date().toISOString()): Dashboard {
  const periodo = intervaloDoPeriodo(f, hoje);
  const projetos = new Map(d.projetos.map((p) => [p.id, p]));
  const procs = new Map(d.procedimentos.map((p) => [p.codigo, p]));
  const agsPorOS = porChave(d.agendamentos, (a) => a.inspecao_id);

  // OSs vivas (projeto fora da lixeira) — base das opções dos filtros.
  const vivas = d.oss.filter((o) => projetos.has(o.projeto_id));

  // ── Opções dos filtros (de tudo o que o usuário vê, sem o recorte) ────────
  const mapaCli = new Map<string, string>();
  d.projetos.forEach((p) => { if (p.cliente_id) mapaCli.set(p.cliente_id, p.cliente_nome || "Cliente sem nome"); });
  const usados = new Set(vivas.map((o) => o.procedimento).filter(Boolean) as string[]);
  const mapaPessoas = new Map<string, string>();
  const idsVivas = new Set(vivas.map((o) => o.id));
  d.agendamentos.forEach((a) => {
    if (!idsVivas.has(a.inspecao_id)) return;
    (a.equipe || []).forEach((m) => { if (m?.id && !mapaPessoas.has(m.id)) mapaPessoas.set(m.id, m.nome || "Sem nome"); });
  });
  const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, "pt-BR");
  const opcoes = {
    clientes: Array.from(mapaCli, ([id, nome]) => ({ id, nome })).sort(porNome),
    procedimentos: Array.from(usados).map((codigo) => ({ codigo, nome: procs.get(codigo)?.nome || codigo }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR")),
    pessoas: Array.from(mapaPessoas, ([id, nome]) => ({ id, nome })).sort(porNome),
  };

  // ── Recorte ───────────────────────────────────────────────────────────────
  const naEquipe = (a: AgendamentoBruto) => !f.pessoa || (a.equipe || []).some((m) => m?.id === f.pessoa);
  const oss = vivas.filter((o) => {
    const p = projetos.get(o.projeto_id)!;
    if (f.cliente && p.cliente_id !== f.cliente) return false;
    if (f.procedimento && o.procedimento !== f.procedimento) return false;
    if (f.pessoa && !(agsPorOS.get(o.id) || []).some(naEquipe)) return false;
    return true;
  });
  const ids = new Set(oss.map((o) => o.id));
  const projetosRecorte = d.projetos.filter((p) =>
    (!f.cliente || p.cliente_id === f.cliente) && (!(f.procedimento || f.pessoa) || oss.some((o) => o.projeto_id === p.id)));

  const ref = (o: OsBruta): RefOS => {
    const p = projetos.get(o.projeto_id)!;
    return {
      id: o.id, identificacao: o.identificacao, fase: o.fase, projetoId: p.id,
      projeto: p.codigo_projeto || p.pedido_compra || "Projeto", cliente: p.cliente_nome,
    };
  };
  const abertas = oss.filter((o) => !o.encerrada_em);
  const histPorOS = porChave(d.historico.filter((h) => ids.has(h.inspecao_id)), (h) => h.inspecao_id);
  const relsPorOS = porChave(d.relatorios.filter((r) => ids.has(r.inspecao_id)), (r) => r.inspecao_id);
  const rdosPorOS = new Map<string, RdoBruto[]>();
  d.rdos.forEach((r) => (r.inspecoes || []).forEach((id) => {
    if (!ids.has(id)) return;
    const l = rdosPorOS.get(id);
    if (l) l.push(r); else rdosPorOS.set(id, [r]);
  }));
  const fotosPorOS = new Map(d.fotos.map((x) => [x.inspecao_id, x]));
  const coletasPorOS = porChave(d.coletas.filter((c) => ids.has(c.inspecao_id)), (c) => c.inspecao_id);
  const entregasRecorte = d.entregas.filter((e) => ids.has(e.inspecao_id));
  const entregasPorOS = porChave(entregasRecorte, (e) => e.inspecao_id);

  // ── Funil (estado atual) e permanências (no período) ──────────────────────
  const duracoes = new Map<number, number[]>();
  const idadePorOS = new Map<string, number>();
  for (const o of oss) {
    const { fechadas, entradaAtual } = permanenciasDaOS(o, histPorOS.get(o.id) || []);
    for (const p of fechadas) {
      if (!noIntervalo(diaBrasilia(p.fim), periodo)) continue;
      const dur = duracaoEmDias(p);
      if (dur < 0) continue;
      const l = duracoes.get(p.fase);
      if (l) l.push(dur); else duracoes.set(p.fase, [dur]);
    }
    if (!o.encerrada_em) idadePorOS.set(o.id, Math.max(0, diferencaDias(diaBrasilia(entradaAtual) || hoje, hoje)));
  }
  const funil = FASES.map((fd) => {
    const naFase = abertas.filter((o) => o.fase === fd.numero)
      .map((o) => ({ ...ref(o), dias: idadePorOS.get(o.id) ?? 0 }))
      .sort((a, b) => b.dias - a.dias);
    const est = estatistica(naFase.map((x) => x.dias));
    return {
      fase: fd.numero, titulo: fd.titulo, area: fd.area, abertas: naFase.length,
      paradas: naFase.filter((x) => x.dias > LIMITE_PARADA_DIAS).length,
      idadeMediana: est ? est.mediana : null, oss: naFase.slice(0, MAX_LISTA),
    };
  });
  const duracaoFases = FASES.map((fd) => {
    const est = estatistica(duracoes.get(fd.numero) || []);
    return { fase: fd.numero, titulo: fd.titulo, n: est?.n || 0, media: est ? est.media : null, mediana: est ? est.mediana : null };
  });

  // ── Encerradas / lead time (no período) ───────────────────────────────────
  const encerradasPeriodo = oss.filter((o) => noIntervalo(diaBrasilia(o.encerrada_em), periodo));
  const leads = encerradasPeriodo.map((o) => diferencaDias(diaBrasilia(o.criado_em)!, diaBrasilia(o.encerrada_em)!)).filter((x) => x >= 0);

  // ── Reprovação (no período, pelo histórico) ───────────────────────────────
  let avI = 0, repI = 0, avE = 0, repE = 0;
  const motivos = new Map<string, { inspecao: number; execucao: number }>();
  for (const h of d.historico) {
    if (!ids.has(h.inspecao_id) || (h.acao !== "aprovar" && h.acao !== "reprovar")) continue;
    if (!noIntervalo(diaBrasilia(h.criado_em), periodo)) continue;
    const tipo = Number(h.fase_de) === 9 ? "execucao" : Number(h.fase_de) === 5 ? "inspecao" : null;
    if (!tipo) continue;
    const rep = h.acao === "reprovar";
    if (tipo === "inspecao") { avI++; if (rep) repI++; } else { avE++; if (rep) repE++; }
    if (rep) {
      const cat = h.motivo_categoria || "sem_categoria";
      const m = motivos.get(cat) || { inspecao: 0, execucao: 0 };
      m[tipo]++;
      motivos.set(cat, m);
    }
  }
  const listaMotivos = Array.from(motivos, ([categoria, m]) => ({
    categoria, rotulo: categoria === "sem_categoria" ? "Sem categoria (registro antigo)" : rotuloCategoria(categoria) || categoria,
    inspecao: m.inspecao, execucao: m.execucao, total: m.inspecao + m.execucao,
  })).sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, "pt-BR"));

  // ── Filas de aprovação e assinatura (estado atual, OSs abertas) ───────────
  const idade = (iso: string | null) => {
    const dia = diaBrasilia(iso);
    return dia ? Math.max(0, diferencaDias(dia, hoje)) : null;
  };
  const filaAprov: ItemFila[] = [];
  const filaAssin: ItemFila[] = [];
  for (const o of abertas) {
    const rels = relsPorOS.get(o.id) || [];
    for (const r of rels) {
      if (r.status === "em_aprovacao") {
        const desde = r.enviado_em || r.criado_em;
        filaAprov.push({ os: ref(o), relatorioId: r.id, tipo: r.tipo, versao: r.versao, desde: diaBrasilia(desde), dias: idade(desde) });
      } else if (r.status === "aprovado" && !rels.some((x) => x.tipo === r.tipo && x.status === "assinado")) {
        const desde = r.avaliado_em || r.enviado_em || r.criado_em;
        filaAssin.push({ os: ref(o), relatorioId: r.id, tipo: r.tipo, versao: r.versao, desde: diaBrasilia(desde), dias: idade(desde) });
      }
    }
  }
  const porIdade = (a: ItemFila, b: ItemFila) => (b.dias ?? -1) - (a.dias ?? -1);
  filaAprov.sort(porIdade);
  filaAssin.sort(porIdade);

  // ── Encerramento (OSs abertas na fase 10) ─────────────────────────────────
  const execucaoDe = (osId: string) => periodoDe(execucaoAtiva((agsPorOS.get(osId) || []).map((a) => ({
    tipo: a.tipo, data_visita: a.data_visita, data_fim: a.data_fim, a_definir: a.a_definir, substituido_em: null,
  }))));
  const encerramento = abertas.filter((o) => o.fase >= ULTIMA_FASE).map((o) => {
    const proc = o.procedimento ? procs.get(o.procedimento) : undefined;
    const pend = pendenciasEncerramento({
      relatorios: (relsPorOS.get(o.id) || []).map((r) => ({
        id: r.id, tipo: r.tipo, versao: Number(r.versao) || 0, status: r.status,
        dados: { laudoPdf: r.laudo_pdf || null }, avaliado_em: r.avaliado_em, assinado_em: r.assinado_em,
      })),
      usaLaudo: procedimentoUsaLaudo(proc as any),
      rdos: (rdosPorOS.get(o.id) || []).map((r) => ({
        numero: r.numero, data: String(r.data).slice(0, 10), arquivo_path: r.arquivo_path, arquivo_em: r.arquivo_em, atualizado_em: r.atualizado_em,
      })),
      periodo: execucaoDe(o.id), hoje,
      coleta: fotosPorOS.get(o.id) || registroVazio(!!proc?.agua_potavel),
    });
    return {
      os: ref(o), dias: idadePorOS.get(o.id) ?? 0, entregas: (entregasPorOS.get(o.id) || []).length,
      pendencias: pend.map((p) => ({ texto: p.texto, secao: p.secao })),
    };
  }).sort((a, b) => b.pendencias.length - a.pendencias.length || b.dias - a.dias);

  // ── Agenda (estado atual: hoje → +29 dias) ────────────────────────────────
  const janela: Periodo = { inicio: hoje, fim: somarDias(hoje, JANELA_AGENDA_DIAS - 1) };
  const ossPorId = new Map(oss.map((o) => [o.id, o]));
  const agsRecorte = d.agendamentos.filter((a) => ossPorId.has(a.inspecao_id) && naEquipe(a));
  const datados = agsRecorte.map((a) => ({ a, p: periodoDe(a.a_definir ? null : a) })).filter((x) => !!x.p) as { a: AgendamentoBruto; p: Periodo }[];
  const naJanela = datados.filter((x) => !!intersecao(x.p, janela))
    .sort((x, y) => x.p.inicio.localeCompare(y.p.inicio) || (x.a.hora || "").localeCompare(y.a.hora || ""));
  const proximos: ItemAgenda[] = naJanela.slice(0, 60).map(({ a, p }) => ({
    id: a.id, os: ref(ossPorId.get(a.inspecao_id)!), tipo: a.tipo, inicio: p.inicio, fim: p.fim, hora: a.hora,
    equipe: (a.equipe || []).map((m) => m.nome).filter(Boolean), equipamentos: (a.equipamentos || []).filter(Boolean),
  }));

  const diasPessoa = new Map<string, { nome: string; dias: Set<string> }>();
  const diasEquip = new Map<string, { nome: string; dias: Set<string> }>();
  for (const { a, p } of naJanela) {
    const comum = intersecao(p, janela)!;
    const dias: string[] = [];
    for (let dd = comum.inicio; dd <= comum.fim; dd = somarDias(dd, 1)) dias.push(dd);
    (a.equipe || []).forEach((m) => {
      if (!m?.id || (f.pessoa && m.id !== f.pessoa)) return;
      const e = diasPessoa.get(m.id) || { nome: m.nome || "Sem nome", dias: new Set<string>() };
      dias.forEach((x) => e.dias.add(x));
      diasPessoa.set(m.id, e);
    });
    (a.equipamentos || []).forEach((nome) => {
      const k = normalizarEquipamento(nome);
      if (!k) return;
      const e = diasEquip.get(k) || { nome, dias: new Set<string>() };
      dias.forEach((x) => e.dias.add(x));
      diasEquip.set(k, e);
    });
  }
  const ocupacaoPessoas = Array.from(diasPessoa, ([id, e]) => ({ id, nome: e.nome, dias: e.dias.size }))
    .sort((a, b) => b.dias - a.dias || a.nome.localeCompare(b.nome, "pt-BR"));
  const ocupacaoEquipamentos = Array.from(diasEquip.values(), (e) => ({ nome: e.nome, dias: e.dias.size }))
    .sort((a, b) => b.dias - a.dias || a.nome.localeCompare(b.nome, "pt-BR"));

  // Conflitos: mesma pessoa ou equipamento em locais diferentes com dia em
  // comum (de hoje em diante) — a mesma regra do aviso do agendamento.
  const futuros = datados.filter((x) => x.p.fim >= hoje);
  const localDe = (osId: string) => {
    const p = projetos.get(ossPorId.get(osId)!.projeto_id)!;
    return { projetoId: p.id, endereco: p.endereco || null };
  };
  const conflitos: Conflito[] = [];
  for (let i = 0; i < futuros.length; i++) {
    for (let j = i + 1; j < futuros.length; j++) {
      const x = futuros[i], y = futuros[j];
      if (x.a.inspecao_id === y.a.inspecao_id || mesmoLocal(localDe(x.a.inspecao_id), localDe(y.a.inspecao_id))) continue;
      const comum = intersecao(x.p, y.p);
      if (!comum || comum.fim < hoje) continue;
      const idsY = new Set((y.a.equipe || []).map((m) => m.id));
      const pessoas = (x.a.equipe || []).filter((m) => m?.id && idsY.has(m.id)).map((m) => m.nome);
      const eqY = new Set((y.a.equipamentos || []).map(normalizarEquipamento));
      const equipamentos = (x.a.equipamentos || []).filter((e) => eqY.has(normalizarEquipamento(e)));
      if (!pessoas.length && !equipamentos.length) continue;
      conflitos.push({
        inicio: comum.inicio < hoje ? hoje : comum.inicio, fim: comum.fim, pessoas, equipamentos,
        a: { os: ref(ossPorId.get(x.a.inspecao_id)!), tipo: x.a.tipo },
        b: { os: ref(ossPorId.get(y.a.inspecao_id)!), tipo: y.a.tipo },
      });
    }
  }
  conflitos.sort((a, b) => a.inicio.localeCompare(b.inicio));

  // "Data a definir": só OSs abertas (OS encerrada não aceita agendamento).
  const aDef = agsRecorte.filter((a) => a.a_definir && !ossPorId.get(a.inspecao_id)!.encerrada_em);
  const pesoADef = (a: AgendamentoBruto) => (!a.lembrar_em ? 1 : a.lembrar_em <= hoje ? 0 : 2);
  const aDefinir = {
    total: aDef.length,
    vencidos: aDef.filter((a) => a.lembrar_em && a.lembrar_em < hoje).length,
    hoje: aDef.filter((a) => a.lembrar_em === hoje).length,
    semLembrete: aDef.filter((a) => !a.lembrar_em).length,
    itens: [...aDef].sort((a, b) => pesoADef(a) - pesoADef(b) || (a.lembrar_em || "").localeCompare(b.lembrar_em || ""))
      .slice(0, MAX_LISTA).map((a) => ({ id: a.id, os: ref(ossPorId.get(a.inspecao_id)!), tipo: a.tipo, lembrar_em: a.lembrar_em })),
  };

  // ── Qualidade de campo (estado atual, OSs abertas; laudo no período) ──────
  const rdoFaltando: { os: RefOS; dias: string[] }[] = [];
  const fotosIncompletas: Dashboard["campo"]["fotosIncompletas"] = [];
  const medicoesSemAprovacao: Dashboard["campo"]["medicoesSemAprovacao"] = [];
  for (const o of abertas) {
    const per = execucaoDe(o.id);
    if (per && per.inicio <= hoje) {
      const faltam = diasSemRdo(per, (rdosPorOS.get(o.id) || []).map((r) => String(r.data).slice(0, 10)), hoje, hoje);
      if (faltam.length) rdoFaltando.push({ os: ref(o), dias: faltam.map((x) => x.dia) });
    }
    if (o.fase >= 8) {
      const proc = o.procedimento ? procs.get(o.procedimento) : undefined;
      const reg = fotosPorOS.get(o.id) || registroVazio(!!proc?.agua_potavel);
      const pend = pendenciasColeta(reg);
      if (pend.length) fotosIncompletas.push({ os: ref(o), ...progressoColeta(reg), pendencias: pend.slice(0, 4) });
    }
    if (o.fase >= 3 && o.fase <= 5) {
      const meds = (coletasPorOS.get(o.id) || []).filter((c) => c.tipo !== "anexo");
      if (meds.length && !meds.some((c) => !!c.aprovada_em)) medicoesSemAprovacao.push({ os: ref(o), medicoes: meds.length });
    }
  }
  rdoFaltando.sort((a, b) => b.dias.length - a.dias.length);
  fotosIncompletas.sort((a, b) => (a.feitos / (a.total || 1)) - (b.feitos / (b.total || 1)));

  const laudosForaDoLimite: Dashboard["campo"]["laudosForaDoLimite"] = [];
  let laudosAvaliados = 0;
  for (const o of oss) {
    const rels = relsPorOS.get(o.id) || [];
    const atual = relatorioAtual(rels.map((r) => ({ ...r, versao: Number(r.versao) || 0 })), "execucao") as RelatorioBruto | null;
    if (!atual || !noIntervalo(diaBrasilia(atual.enviado_em), periodo)) continue;
    const grade = atual.laudo_depois;
    if (!grade || !grade.some((l) => (l?.[0] || "").trim())) continue;
    laudosAvaliados++;
    const fora = foraDoLimite("laudoDepois", grade);
    if (fora.length) {
      laudosForaDoLimite.push({
        os: ref(o), relatorioId: atual.id, versao: atual.versao, enviado: diaBrasilia(atual.enviado_em),
        parametros: fora.map((x) => `${x.nome}: ${x.valor}${x.unidade && !x.pa ? ` ${x.unidade}` : ""} (limite ${x.limite})`),
      });
    }
  }

  // ── Clientes ──────────────────────────────────────────────────────────────
  const cli = new Map<string, Dashboard["clientes"][number]>();
  const linhaCli = (p: ProjetoBruto) => {
    const k = p.cliente_id || "__sem";
    let l = cli.get(k);
    if (!l) {
      l = { id: p.cliente_id, nome: p.cliente_nome || "Sem cliente", projetos: 0, osAbertas: 0, osAbertasPeriodo: 0, osEncerradasPeriodo: 0, entregasPeriodo: 0 };
      cli.set(k, l);
    }
    return l;
  };
  projetosRecorte.forEach((p) => { linhaCli(p).projetos++; });
  for (const o of oss) {
    const l = linhaCli(projetos.get(o.projeto_id)!);
    if (!o.encerrada_em) l.osAbertas++;
    if (noIntervalo(diaBrasilia(o.criado_em), periodo)) l.osAbertasPeriodo++;
    if (noIntervalo(diaBrasilia(o.encerrada_em), periodo)) l.osEncerradasPeriodo++;
  }
  let entregasPeriodo = 0;
  for (const e of entregasRecorte) {
    if (!noIntervalo(e.data, periodo)) continue;
    entregasPeriodo++;
    linhaCli(projetos.get(ossPorId.get(e.inspecao_id)!.projeto_id)!).entregasPeriodo++;
  }
  const clientes = Array.from(cli.values()).sort((a, b) =>
    b.osAbertas - a.osAbertas || b.osEncerradasPeriodo - a.osEncerradasPeriodo || a.nome.localeCompare(b.nome, "pt-BR"));

  const naFase10 = encerramento.length;
  return {
    geradoEm: agora,
    hoje,
    periodo: { ...periodo, chave: f.periodo },
    filtros: f,
    opcoes,
    base: { oss: oss.length, projetos: projetosRecorte.length },
    kpis: {
      osAndamento: abertas.length,
      osAbertasPeriodo: oss.filter((o) => noIntervalo(diaBrasilia(o.criado_em), periodo)).length,
      osEncerradasPeriodo: encerradasPeriodo.length,
      encerradasManualPeriodo: encerradasPeriodo.filter((o) => !!o.encerramento_manual).length,
      projetosConcluidosPeriodo: projetosRecorte.filter((p) => noIntervalo(diaBrasilia(p.concluido_em), periodo)).length,
      projetosAtivos: projetosRecorte.filter((p) => !p.concluido_em).length,
      leadTime: estatistica(leads),
      reprovacao: { inspecao: taxa(avI, repI), execucao: taxa(avE, repE), total: taxa(avI + avE, repI + repE) },
      aguardandoAprovacao: { total: filaAprov.length, maisAntigoDias: filaAprov[0]?.dias ?? null },
      aguardandoAssinatura: { total: filaAssin.length, maisAntigoDias: filaAssin[0]?.dias ?? null },
      encerramento: { naFase10, comPendencia: encerramento.filter((x) => x.pendencias.length > 0).length },
      paradas: funil.reduce((s, x) => s + x.paradas, 0),
      entregasPeriodo,
    },
    funil,
    duracaoFases,
    motivos: listaMotivos,
    filas: { aprovacao: filaAprov.slice(0, MAX_LISTA), assinatura: filaAssin.slice(0, MAX_LISTA) },
    encerramento: encerramento.slice(0, MAX_LISTA),
    agenda: {
      ate7: somarDias(hoje, 6),
      ate30: janela.fim,
      proximos,
      proximosTotal: naJanela.length,
      aDefinir,
      ocupacaoPessoas: ocupacaoPessoas.slice(0, 15),
      ocupacaoEquipamentos: ocupacaoEquipamentos.slice(0, 15),
      conflitos: conflitos.slice(0, MAX_LISTA),
    },
    campo: {
      rdoFaltando: rdoFaltando.slice(0, MAX_LISTA),
      rdoDiasFaltando: rdoFaltando.reduce((s, x) => s + x.dias.length, 0),
      fotosIncompletas: fotosIncompletas.slice(0, MAX_LISTA),
      medicoesSemAprovacao: medicoesSemAprovacao.slice(0, MAX_LISTA),
      laudosForaDoLimite: laudosForaDoLimite.slice(0, MAX_LISTA),
      laudosAvaliados,
      totais: { rdo: rdoFaltando.length, fotos: fotosIncompletas.length, medicoes: medicoesSemAprovacao.length, laudos: laudosForaDoLimite.length },
    },
    clientes: clientes.slice(0, 20),
  };
}
