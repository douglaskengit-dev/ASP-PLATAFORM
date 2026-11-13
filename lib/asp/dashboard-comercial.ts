/** Dashboard Comercial — operação vista pelo cliente e funil do Follow-up
 * (agregações puras). Filtros: período e cliente.
 *
 * Follow-up: gp_processos.etapa é o índice em ETAPAS_FLUXO (0 = Abertura,
 * última = Finalizado). historico_etapas guarda cada troca com a data de
 * autenticação (dia informado por quem trocou). */
import { ETAPAS_FLUXO } from "../processos/etapas";
import { diaBrasilia, fimDaOS } from "../validacao";
import {
  diferencaDias, estatistica, intervaloDoPeriodo, montarRecorrencia, noIntervalo, porChave,
  type ChavePeriodo, type DadosDashboard, type Estatistica, type FiltrosDashboard, type Intervalo, type ItemRecorrencia,
} from "./dashboard";
import { aberturaOS, entregaFinal, fimExecucao, mesDe, mediana, ossDoRecorte, periodoAnterior, rotuloMes, ultimos12Meses, variacao } from "./dashboard-comum";

export interface ProcessoBruto {
  id: string;
  titulo: string;
  orgao_id: string | null;
  orgao_nome: string | null;
  etapa: number;
  created_at: string;
  historico_etapas: { etapa?: number | null; data_autenticacao?: string | null; alterado_em?: string | null }[] | null;
}

export interface DadosComercial extends DadosDashboard {
  processos: ProcessoBruto[];
}

/** Cliente sem serviço há mais que isto entra em "para reativar". */
export const MESES_INATIVO = 12;
/** Processo do Follow-up parado: mais que isto (dias) na etapa atual. */
export const LIMITE_PROCESSO_PARADO_DIAS = 30;
const ULTIMA_ETAPA = ETAPAS_FLUXO.length - 1;

export interface PainelComercial {
  geradoEm: string;
  hoje: string;
  periodo: Intervalo & { chave: ChavePeriodo };
  filtros: FiltrosDashboard;
  opcoes: { clientes: { id: string; nome: string }[] };
  kpis: {
    renovacoes: { vencidas: number; ate30: number; ate60: number; ate90: number; recorrentes: number };
    inativos: { total: number; semServico: number };
    prazoEntrega: Estatistica | null;
    andamento: { oss: number; clientes: number };
    funil: { ativos: number; finalizadosPeriodo: number; criadosPeriodo: number };
    conversao: { criados: number; finalizados: number; taxa: number | null };
    parados: number;
    projetosNovos: { periodo: number; anterior: number; variacao: number | null; clientesNovos: number; recorrentes: number };
    recompra: { base: number; recompraram: number; taxa: number | null };
  };
  renovacoes: (ItemRecorrencia & { faixa: "vencido" | "30" | "60" | "90" })[];
  inativos: { clienteId: string; cliente: string; ultimoServico: string; meses: number }[];
  andamento: { clienteId: string | null; cliente: string; oss: number; fases: string; maisAntigaDias: number; proximaExecucao: string | null }[];
  funil: { etapa: number; nome: string; ativos: number; alcancaram: number; conversao: number | null; tempoMediano: number | null; passagens: number; parados: number }[];
  parados: { id: string; titulo: string; cliente: string | null; etapa: string; dias: number }[];
  mensal: { mes: string; rotulo: string; novos: number; clientesNovos: number; recorrentes: number }[];
}

/** Entradas do processo em cada etapa, em ordem: [{etapa, dia}]. A abertura
 *  (created_at) é a entrada na etapa 0. */
export function entradasDoProcesso(p: ProcessoBruto): { etapa: number; dia: string }[] {
  const out: { etapa: number; dia: string }[] = [{ etapa: 0, dia: diaBrasilia(p.created_at) || p.created_at.slice(0, 10) }];
  const hist = (Array.isArray(p.historico_etapas) ? p.historico_etapas : [])
    .filter((h) => Number.isInteger(Number(h?.etapa)))
    .map((h) => ({ etapa: Number(h.etapa), dia: (h.data_autenticacao || diaBrasilia(h.alterado_em) || "").slice(0, 10), ord: h.alterado_em || "" }))
    .filter((h) => h.dia)
    .sort((a, b) => a.ord.localeCompare(b.ord));
  for (const h of hist) if (h.etapa !== out[out.length - 1].etapa) out.push({ etapa: h.etapa, dia: h.dia });
  return out;
}

export function montarComercial(d: DadosComercial, f: FiltrosDashboard, hoje: string, agora: string = new Date().toISOString()): PainelComercial {
  const filtros: FiltrosDashboard = { periodo: f.periodo, de: f.de, ate: f.ate, cliente: f.cliente, procedimento: null, pessoa: null };
  const periodo = { ...intervaloDoPeriodo(filtros, hoje), chave: f.periodo };
  const anterior = periodoAnterior(periodo);
  const projetos = new Map(d.projetos.map((p) => [p.id, p]));
  const oss = ossDoRecorte(d, filtros);
  const ids = new Set(oss.map((o) => o.id));
  const agsPorOS = porChave(d.agendamentos.filter((a) => ids.has(a.inspecao_id)), (a) => a.inspecao_id);
  const entregasPorOS = porChave(d.entregas.filter((e) => ids.has(e.inspecao_id)), (e) => e.inspecao_id);

  // Opções: clientes com projeto ou processo no Follow-up.
  const mapaCli = new Map<string, string>();
  d.projetos.forEach((p) => { if (p.cliente_id) mapaCli.set(p.cliente_id, p.cliente_nome || "Cliente sem nome"); });
  d.processos.forEach((p) => { if (p.orgao_id && !mapaCli.has(p.orgao_id)) mapaCli.set(p.orgao_id, p.orgao_nome || "Cliente sem nome"); });
  const opcoes = { clientes: Array.from(mapaCli, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) };

  // ── Renovações (recorrência, estado atual) ────────────────────────────────
  const rec = montarRecorrencia(d, hoje, filtros.cliente);
  const todosRec = [...montarRecorrencia(d, hoje, filtros.cliente, Infinity).itens].sort((a, b) => (a.dias ?? 99999) - (b.dias ?? 99999));
  const faixa = (x: ItemRecorrencia): "vencido" | "30" | "60" | "90" | null =>
    x.status === "vencido" ? "vencido" : x.status === "em_andamento" || x.dias == null || x.dias < 0 ? null
      : x.dias <= 30 ? "30" : x.dias <= 60 ? "60" : x.dias <= 90 ? "90" : null;
  const renovacoes = todosRec.map((x) => ({ ...x, faixa: faixa(x) })).filter((x) => x.faixa) as PainelComercial["renovacoes"];

  // ── Clientes sem serviço há mais de 12 meses ──────────────────────────────
  const corte = somarMeses(hoje, -MESES_INATIVO);
  const ossPorCliente = new Map<string, typeof oss>();
  for (const o of d.oss) {
    const cli = projetos.get(o.projeto_id)?.cliente_id;
    if (!cli || (filtros.cliente && cli !== filtros.cliente)) continue;
    const l = ossPorCliente.get(cli) || [];
    l.push(o);
    ossPorCliente.set(cli, l);
  }
  const agsTodas = porChave(d.agendamentos, (a) => a.inspecao_id);
  const inativos: PainelComercial["inativos"] = [];
  for (const [cli, lista] of ossPorCliente) {
    if (lista.some((o) => !o.encerrada_em)) continue;
    let ultimo: string | null = null;
    for (const o of lista) {
      const fim = fimDaOS({ id: o.id, criadaEm: aberturaOS(o), encerradaEm: o.encerrada_em, agendamentos: agsTodas.get(o.id) || [] });
      if (fim && (!ultimo || fim > ultimo)) ultimo = fim;
    }
    if (!ultimo || ultimo >= corte) continue;
    inativos.push({ clienteId: cli, cliente: mapaCli.get(cli) || "Cliente sem nome", ultimoServico: ultimo, meses: mesesEntre(ultimo, hoje) });
  }
  inativos.sort((a, b) => a.ultimoServico.localeCompare(b.ultimoServico));
  const comProjeto = new Set(d.projetos.map((p) => p.cliente_id).filter(Boolean));
  const semServico = (d.orgaos || []).filter((o) => !comProjeto.has(o.id) && (!filtros.cliente || o.id === filtros.cliente)).length;

  // ── Prazo de entrega: fim da execução → entrega final (entregas no período)
  const prazos: number[] = [];
  for (const o of oss) {
    const fim = fimExecucao(agsPorOS.get(o.id) || []);
    if (!fim) continue;
    const ent = entregaFinal(entregasPorOS.get(o.id) || [], fim);
    if (ent && noIntervalo(ent, periodo)) prazos.push(diferencaDias(fim, ent));
  }

  // ── OSs em andamento por cliente ──────────────────────────────────────────
  const abertas = oss.filter((o) => !o.encerrada_em);
  const porCli = new Map<string, PainelComercial["andamento"][number] & { _fases: number[] }>();
  for (const o of abertas) {
    const p = projetos.get(o.projeto_id)!;
    const k = p.cliente_id || "__sem";
    const l = porCli.get(k) || { clienteId: p.cliente_id, cliente: p.cliente_nome || "Sem cliente", oss: 0, fases: "", maisAntigaDias: 0, proximaExecucao: null, _fases: [] };
    l.oss++;
    l._fases.push(o.fase);
    l.maisAntigaDias = Math.max(l.maisAntigaDias, Math.max(0, diferencaDias(aberturaOS(o) || hoje, hoje)));
    const fim = fimExecucao(agsPorOS.get(o.id) || []);
    const ini = (agsPorOS.get(o.id) || []).filter((a) => a.tipo === "execucao" && !a.a_definir && a.data_visita && (a.data_fim || a.data_visita)! >= hoje)
      .map((a) => String(a.data_visita).slice(0, 10)).sort()[0];
    if (ini && fim && (!l.proximaExecucao || ini < l.proximaExecucao)) l.proximaExecucao = ini;
    porCli.set(k, l);
  }
  const andamento = Array.from(porCli.values()).map(({ _fases, ...l }) => {
    const u = Array.from(new Set(_fases)).sort((a, b) => a - b);
    return { ...l, fases: u.length === 1 ? `fase ${u[0]}` : `fases ${u.join(", ")}` };
  }).sort((a, b) => b.oss - a.oss || b.maisAntigaDias - a.maisAntigaDias);

  // ── Follow-up ─────────────────────────────────────────────────────────────
  const procs = d.processos.filter((p) => !filtros.cliente || p.orgao_id === filtros.cliente);
  const entradas = new Map(procs.map((p) => [p.id, entradasDoProcesso(p)]));
  const criadosPeriodo = procs.filter((p) => noIntervalo(diaBrasilia(p.created_at), periodo));
  const maiorEtapa = (p: ProcessoBruto) => Math.max(Number(p.etapa) || 0, ...(entradas.get(p.id) || []).map((e) => e.etapa));
  const duracoes = new Map<number, number[]>();
  const paradosLista: PainelComercial["parados"] = [];
  for (const p of procs) {
    const ent = entradas.get(p.id)!;
    for (let i = 0; i < ent.length - 1; i++) {
      if (!noIntervalo(ent[i + 1].dia, periodo)) continue;
      const n = diferencaDias(ent[i].dia, ent[i + 1].dia);
      if (n < 0) continue;
      const l = duracoes.get(ent[i].etapa) || [];
      l.push(n);
      duracoes.set(ent[i].etapa, l);
    }
    const atual = Number(p.etapa) || 0;
    if (atual < ULTIMA_ETAPA) {
      const desde = [...ent].reverse().find((e) => e.etapa === atual)?.dia || ent[0].dia;
      const dias = Math.max(0, diferencaDias(desde, hoje));
      if (dias > LIMITE_PROCESSO_PARADO_DIAS) {
        paradosLista.push({ id: p.id, titulo: p.titulo, cliente: p.orgao_nome, etapa: ETAPAS_FLUXO[atual]?.nome || `Etapa ${atual + 1}`, dias });
      }
    }
  }
  paradosLista.sort((a, b) => b.dias - a.dias);
  const paradosPorEtapa = porChave(paradosLista, (x) => x.etapa);
  const funil = ETAPAS_FLUXO.map((e, i) => {
    const alcancaram = criadosPeriodo.filter((p) => maiorEtapa(p) >= i).length;
    const seguinte = i < ULTIMA_ETAPA ? criadosPeriodo.filter((p) => maiorEtapa(p) >= i + 1).length : null;
    const dur = duracoes.get(i) || [];
    return {
      etapa: i, nome: e.nome,
      ativos: procs.filter((p) => (Number(p.etapa) || 0) === i).length,
      alcancaram,
      conversao: seguinte == null || !alcancaram ? null : seguinte / alcancaram,
      tempoMediano: mediana(dur), passagens: dur.length,
      parados: (paradosPorEtapa.get(e.nome) || []).length,
    };
  });
  const finalizadosPeriodo = procs.filter((p) => (Number(p.etapa) || 0) === ULTIMA_ETAPA
    && noIntervalo((entradas.get(p.id) || []).filter((e) => e.etapa === ULTIMA_ETAPA).pop()?.dia, periodo)).length;
  const criadosFinalizados = criadosPeriodo.filter((p) => maiorEtapa(p) >= ULTIMA_ETAPA).length;

  // ── Projetos novos e recompra ─────────────────────────────────────────────
  const projsCli = d.projetos.filter((p) => !filtros.cliente || p.cliente_id === filtros.cliente)
    .map((p) => ({ ...p, dia: p.data_abertura || diaBrasilia(p.criado_em) || "" }))
    .filter((p) => p.dia)
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.id.localeCompare(b.id));
  const primeiroDo = new Map<string, string>();
  for (const p of projsCli) if (p.cliente_id && !primeiroDo.has(p.cliente_id)) primeiroDo.set(p.cliente_id, p.id);
  const ehNovo = (p: (typeof projsCli)[number]) => !p.cliente_id || primeiroDo.get(p.cliente_id) === p.id;
  const noPer = projsCli.filter((p) => noIntervalo(p.dia, periodo));
  const noAnt = projsCli.filter((p) => noIntervalo(p.dia, anterior)).length;
  const meses = ultimos12Meses(hoje);
  const porMes = porChave(projsCli, (p) => mesDe(p.dia));
  const mensal = meses.map((mes) => {
    const l = porMes.get(mes) || [];
    const novos = l.filter(ehNovo).length;
    return { mes, rotulo: rotuloMes(mes), novos: l.length, clientesNovos: novos, recorrentes: l.length - novos };
  });

  const projsPorCli = porChave(projsCli.filter((p) => p.cliente_id), (p) => p.cliente_id!);
  let baseRecompra = 0, recompraram = 0;
  for (const [, lista] of projsPorCli) {
    const primeiro = lista[0].dia;
    if (somarMeses(primeiro, 12) > hoje) continue;
    baseRecompra++;
    const limite = somarMeses(primeiro, 12);
    if (lista.slice(1).some((p) => p.dia <= limite)) recompraram++;
  }

  return {
    geradoEm: agora,
    hoje,
    periodo,
    filtros,
    opcoes,
    kpis: {
      renovacoes: {
        vencidas: renovacoes.filter((x) => x.faixa === "vencido").length,
        ate30: renovacoes.filter((x) => x.faixa === "30").length,
        ate60: renovacoes.filter((x) => x.faixa === "60").length,
        ate90: renovacoes.filter((x) => x.faixa === "90").length,
        recorrentes: rec.total,
      },
      inativos: { total: inativos.length, semServico },
      prazoEntrega: estatistica(prazos.filter((n) => n >= 0)),
      andamento: { oss: abertas.length, clientes: andamento.length },
      funil: { ativos: procs.filter((p) => (Number(p.etapa) || 0) < ULTIMA_ETAPA).length, finalizadosPeriodo, criadosPeriodo: criadosPeriodo.length },
      conversao: { criados: criadosPeriodo.length, finalizados: criadosFinalizados, taxa: criadosPeriodo.length ? criadosFinalizados / criadosPeriodo.length : null },
      parados: paradosLista.length,
      projetosNovos: {
        periodo: noPer.length, anterior: noAnt, variacao: variacao(noPer.length, noAnt),
        clientesNovos: noPer.filter(ehNovo).length, recorrentes: noPer.filter((p) => !ehNovo(p)).length,
      },
      recompra: { base: baseRecompra, recompraram, taxa: baseRecompra ? recompraram / baseRecompra : null },
    },
    renovacoes: renovacoes.slice(0, 30),
    inativos: inativos.slice(0, 30),
    andamento: andamento.slice(0, 20),
    funil,
    parados: paradosLista.slice(0, 25),
    mensal,
  };
}

// ── Auxiliares ───────────────────────────────────────────────────────────────

/** Soma meses a um dia AAAA-MM-DD (dia que não existe vira o último do mês). */
function somarMeses(dia: string, meses: number): string {
  const a = Number(dia.slice(0, 4)), m = Number(dia.slice(5, 7)) - 1 + meses, dd = Number(dia.slice(8, 10));
  const ano = a + Math.floor(m / 12), mes = ((m % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(dd, ultimo)).padStart(2, "0")}`;
}

function mesesEntre(de: string, ate: string): number {
  let n = (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + Number(ate.slice(5, 7)) - Number(de.slice(5, 7));
  if (Number(ate.slice(8, 10)) < Number(de.slice(8, 10))) n--;
  return Math.max(0, n);
}

