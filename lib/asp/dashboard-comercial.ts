/** Dashboard Comercial — operação vista pelo cliente e funil do Follow-up
 * (agregações puras). Filtros: período, cliente e procedimento.
 *
 * Procedimento: OSs pelo código (inspecoes.procedimento); oportunidades do
 * Follow-up pelo procedimento_id (o id do mesmo procedimento no Catálogo);
 * projetos que têm alguma OS do procedimento. Renovações não dependem dele
 * (a recorrência é do cliente).
 *
 * Follow-up (CRM): gp_processos.etapa é o índice em ETAPAS_FLUXO (etapas
 * comerciais, 0 = Prospecção) e resultado diz se a oportunidade está em
 * aberto, ganha ou perdida (resultado_em = dia do fechamento).
 * historico_etapas guarda cada troca com a data informada por quem trocou. */
import { ETAPAS_FLUXO } from "../processos/etapas";
import { diasParaValidade, rotuloMotivoPerda, rotuloOrigem, situacaoPropostaVista, situacaoProximaAcao, TEMPERATURAS, temperaturaDe, valorPonderado, type Temperatura } from "../validacao/crm";
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
  /** Antes da migração do CRM: ausente (= aberta). */
  resultado?: "aberta" | "ganha" | "perdida" | null;
  resultado_em?: string | null;
  /** Procedimento do título (Catálogo). Nulo = "Outros" ou antes da migração. */
  procedimento_id?: string | null;
  /** Dados da oportunidade (CRM). Ausentes antes da migração. */
  valor?: number | null;
  origem?: string | null;
  motivo_perda?: string | null;
  previsao_fechamento?: string | null;
  /** Projeto aberto a partir da oportunidade ganha (Abrir projeto). */
  projeto_id?: string | null;
  responsavel_id?: string | null;
  responsavel_nome?: string | null;
  proxima_acao?: string | null;
  proxima_acao_em?: string | null;
  /** Versão mais nova da proposta (validade e situação). Nula sem proposta ou antes da migração. */
  proposta?: { versao: number; validade: string | null; situacao: string } | null;
  /** Escolhida na ficha (nula = automática). */
  temperatura?: string | null;
}

const aberta = (p: ProcessoBruto) => !p.resultado || p.resultado === "aberta";

export interface DadosComercial extends DadosDashboard {
  processos: ProcessoBruto[];
}

/** Cliente sem serviço há mais que isto entra em "para reativar". */
export const MESES_INATIVO = 12;
/** Processo do Follow-up parado: mais que isto (dias) na etapa atual. */
export const LIMITE_PROCESSO_PARADO_DIAS = 30;

export interface PainelComercial {
  geradoEm: string;
  hoje: string;
  periodo: Intervalo & { chave: ChavePeriodo };
  filtros: FiltrosDashboard;
  opcoes: { clientes: { id: string; nome: string }[]; procedimentos: { codigo: string; nome: string }[] };
  kpis: {
    renovacoes: { vencidas: number; ate30: number; ate60: number; ate90: number; recorrentes: number };
    inativos: { total: number; semServico: number };
    prazoEntrega: Estatistica | null;
    andamento: { oss: number; clientes: number };
    funil: { ativos: number; ganhasPeriodo: number; perdidasPeriodo: number; criadosPeriodo: number };
    conversao: { criados: number; ganhas: number; taxa: number | null };
    parados: number;
    projetosNovos: { periodo: number; anterior: number; variacao: number | null; clientesNovos: number; recorrentes: number };
    recompra: { base: number; recompraram: number; taxa: number | null };
    /** Em aberto agora: soma dos valores; previsto30 = previsão de fechamento até hoje + 30 dias (inclui as atrasadas). */
    /** Em aberto agora, pela próxima ação: atrasada (data < hoje), para hoje ou sem próxima ação. */
    followups: { abertas: number; atrasadas: number; hoje: number; semAcao: number };
    /** Em aberto agora, pela versão mais nova da proposta: aguardando resposta (enviada,
     *  inclui as vencidas), vencidas, que vencem em até 7 dias e aceitas ainda sem Fechar ganho. */
    propostas: { aguardando: number; vencidas: number; vencem7: number; aceitas: number };
    pipeline: { valor: number; abertas: number; semValor: number; previsto30: number; qtdPrevisto30: number };
    /** Previsão de Vendas Ponderada: soma de valor × probabilidade da temperatura (em aberto agora). */
    previsao: { ponderado: number; valor: number; comTemperatura: number; semTemperatura: number; manuais: number };
    /** Fechadas no período (data do resultado). taxa = ganhas / (ganhas + perdidas). */
    ganho: { ganhas: number; perdidas: number; taxa: number | null; valorGanho: number; valorPerdido: number; ticketMedio: number | null; cicloMediano: number | null };
  };
  /** Próximas ações atrasadas (a mais antiga primeiro). */
  followupsAtrasados: { id: string; titulo: string; cliente: string | null; responsavel: string | null; acao: string | null; em: string; dias: number }[];
  /** Previsão ponderada por temperatura (Frio, Morno, Quente e "sem temperatura", 0%). */
  previsaoTemperatura: { temperatura: Temperatura | null; rotulo: string; pct: number; n: number; valor: number; ponderado: number; semValor: number }[];
  /** Previsão ponderada pelo mês da previsão de fechamento (atrasadas e sem data à parte). */
  previsaoMes: { chave: string; rotulo: string; n: number; valor: number; ponderado: number }[];
  /** Propostas para agir: vencidas, que vencem em até 7 dias e aceitas sem Fechar ganho. */
  propostasAcao: { id: string; titulo: string; cliente: string | null; responsavel: string | null; versao: number;
    tipo: "vencida" | "vence" | "aceita"; validade: string | null; dias: number | null }[];
  /** Por responsável: abertas, atrasadas e sem próxima ação (mais atrasadas primeiro). */
  followupsPorResponsavel: { responsavelId: string | null; nome: string; abertas: number; atrasadas: number; semAcao: number }[];
  /** Perdidas no período, por motivo (mais frequente primeiro). */
  motivosPerda: { motivo: string; rotulo: string; n: number; valor: number }[];
  /** Abertas no período, por origem; ganhas/perdidas = desfecho dessas mesmas oportunidades. */
  /** Histórico: oportunidades ganhas (todas as datas) e o projeto que saiu de cada uma. */
  projetosFollowup: {
    total: number; comProjeto: number; semProjeto: number;
    itens: { id: string; titulo: string; clienteId: string | null; cliente: string | null; valor: number | null; ganhaEm: string | null;
      projeto: { id: string; codigo: string | null; situacao: "concluido" | "andamento" | "sem_os"; oss: number; ossAbertas: number } | null }[];
  };
  origens: { origem: string; rotulo: string; criadas: number; ganhas: number; perdidas: number; taxa: number | null; valorGanho: number }[];
  renovacoes: (ItemRecorrencia & { faixa: "vencido" | "30" | "60" | "90" })[];
  inativos: { clienteId: string; cliente: string; ultimoServico: string; meses: number }[];
  andamento: { clienteId: string | null; cliente: string; oss: number; fases: string; maisAntigaDias: number; proximaExecucao: string | null }[];
  funil: { etapa: number; nome: string; ativos: number; alcancaram: number; conversao: number | null; tempoMediano: number | null; passagens: number; parados: number }[];
  parados: { id: string; titulo: string; cliente: string | null; etapa: string; dias: number }[];
  mensal: { mes: string; rotulo: string; novos: number; clientesNovos: number; recorrentes: number }[];
}

/** Entradas do processo em cada etapa, em ordem: [{etapa, dia}]. A abertura
 *  (created_at) é a entrada na etapa 0. Fechada (ganha/perdida), termina com
 *  { etapa: -1, dia: resultado_em } — a saída da última etapa. */
export function entradasDoProcesso(p: ProcessoBruto): { etapa: number; dia: string }[] {
  const out: { etapa: number; dia: string }[] = [{ etapa: 0, dia: diaBrasilia(p.created_at) || p.created_at.slice(0, 10) }];
  const hist = (Array.isArray(p.historico_etapas) ? p.historico_etapas : [])
    .filter((h) => Number.isInteger(Number(h?.etapa)))
    .map((h) => ({ etapa: Number(h.etapa), dia: (h.data_autenticacao || diaBrasilia(h.alterado_em) || "").slice(0, 10), ord: h.alterado_em || "" }))
    .filter((h) => h.dia)
    .sort((a, b) => a.ord.localeCompare(b.ord));
  for (const h of hist) if (h.etapa !== out[out.length - 1].etapa) out.push({ etapa: h.etapa, dia: h.dia });
  if (!aberta(p) && p.resultado_em) out.push({ etapa: -1, dia: p.resultado_em.slice(0, 10) });
  return out;
}

export function montarComercial(d: DadosComercial, f: FiltrosDashboard, hoje: string, agora: string = new Date().toISOString()): PainelComercial {
  const filtros: FiltrosDashboard = { periodo: f.periodo, de: f.de, ate: f.ate, cliente: f.cliente, procedimento: f.procedimento || null, pessoa: null };
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
  // Procedimentos: os usados em OSs ou em oportunidades do Follow-up.
  const procPorCodigo = new Map(d.procedimentos.map((p) => [p.codigo, p]));
  const codigoDoId = new Map(d.procedimentos.filter((p) => p.id).map((p) => [p.id!, p.codigo]));
  const projetoVivo = new Set(d.projetos.map((p) => p.id));
  const usados = new Set<string>();
  d.oss.forEach((o) => { if (o.procedimento && projetoVivo.has(o.projeto_id)) usados.add(o.procedimento); });
  d.processos.forEach((p) => { const c = p.procedimento_id ? codigoDoId.get(p.procedimento_id) : null; if (c) usados.add(c); });
  const opcoes = {
    clientes: Array.from(mapaCli, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    procedimentos: Array.from(usados).map((codigo) => ({ codigo, nome: procPorCodigo.get(codigo)?.nome || codigo }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR")),
  };
  const proc = filtros.procedimento;
  const doProc = (codigo: string | null | undefined) => !proc || codigo === proc;

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
    if (!cli || (filtros.cliente && cli !== filtros.cliente) || !doProc(o.procedimento)) continue;
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
  const procs = d.processos.filter((p) => (!filtros.cliente || p.orgao_id === filtros.cliente)
    && doProc(p.procedimento_id ? codigoDoId.get(p.procedimento_id) : null));
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
    if (aberta(p)) {
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
    // Última etapa: "seguinte" = ganha.
    const seguinte = i < ETAPAS_FLUXO.length - 1
      ? criadosPeriodo.filter((p) => maiorEtapa(p) >= i + 1).length
      : criadosPeriodo.filter((p) => p.resultado === "ganha").length;
    const dur = duracoes.get(i) || [];
    return {
      etapa: i, nome: e.nome,
      ativos: procs.filter((p) => aberta(p) && (Number(p.etapa) || 0) === i).length,
      alcancaram,
      conversao: seguinte == null || !alcancaram ? null : seguinte / alcancaram,
      tempoMediano: mediana(dur), passagens: dur.length,
      parados: (paradosPorEtapa.get(e.nome) || []).length,
    };
  });
  const fechadasNoPeriodo = (r: "ganha" | "perdida") => procs.filter((p) => p.resultado === r && noIntervalo(p.resultado_em?.slice(0, 10), periodo)).length;
  const criadosGanhos = criadosPeriodo.filter((p) => p.resultado === "ganha").length;

  // ── Valores, taxa de ganho, motivos de perda e origem ────────────────────
  const valorDe = (p: ProcessoBruto) => (Number.isFinite(Number(p.valor)) && p.valor != null ? Number(p.valor) : 0);
  const soma = (l: ProcessoBruto[]) => l.reduce((a, p) => a + valorDe(p), 0);
  const emAberto = procs.filter(aberta);
  const limite30 = somarDias(hoje, 30);
  const previstas = emAberto.filter((p) => p.previsao_fechamento && p.previsao_fechamento.slice(0, 10) <= limite30);
  const fechadas = (r: "ganha" | "perdida") => procs.filter((p) => p.resultado === r && noIntervalo(p.resultado_em?.slice(0, 10), periodo));
  const ganhasPer = fechadas("ganha"), perdidasPer = fechadas("perdida");
  const ganhasComValor = ganhasPer.filter((p) => valorDe(p) > 0);
  const ciclos = ganhasPer.map((p) => diferencaDias(diaBrasilia(p.created_at) || p.created_at.slice(0, 10), p.resultado_em!.slice(0, 10))).filter((n) => n >= 0);
  const motivos = new Map<string, { n: number; valor: number }>();
  for (const p of perdidasPer) {
    const k = p.motivo_perda || "nao_informado";
    const m = motivos.get(k) || { n: 0, valor: 0 };
    m.n++; m.valor += valorDe(p);
    motivos.set(k, m);
  }
  const motivosPerda = Array.from(motivos, ([motivo, m]) => ({ motivo, rotulo: rotuloMotivoPerda(motivo) || "Não informado", ...m }))
    .sort((a, b) => b.n - a.n || b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const porOrigem = porChave(criadosPeriodo, (p) => p.origem || "nao_informada");
  const origens = Array.from(porOrigem, ([origem, l]) => {
    const g = l.filter((p) => p.resultado === "ganha"), pe = l.filter((p) => p.resultado === "perdida").length;
    return { origem, rotulo: rotuloOrigem(origem) || "Não informada", criadas: l.length, ganhas: g.length, perdidas: pe,
      taxa: g.length + pe ? g.length / (g.length + pe) : null, valorGanho: soma(g) };
  }).sort((a, b) => b.criadas - a.criadas || b.ganhas - a.ganhas || a.rotulo.localeCompare(b.rotulo, "pt-BR"));

  // ── Follow-ups (próxima ação) ─────────────────────────────────────────────
  const sit = new Map(emAberto.map((p) => [p.id, situacaoProximaAcao({ resultado: "aberta", proxima_acao_em: p.proxima_acao_em?.slice(0, 10) || null }, hoje)]));
  const followupsAtrasados = emAberto.filter((p) => sit.get(p.id) === "atrasada").map((p) => ({
    id: p.id, titulo: p.titulo, cliente: p.orgao_nome, responsavel: p.responsavel_nome || null, acao: p.proxima_acao || null,
    em: p.proxima_acao_em!.slice(0, 10), dias: diferencaDias(p.proxima_acao_em!.slice(0, 10), hoje),
  })).sort((a, b) => b.dias - a.dias || a.titulo.localeCompare(b.titulo, "pt-BR"));
  const porResp = new Map<string, { responsavelId: string | null; nome: string; abertas: number; atrasadas: number; semAcao: number }>();
  for (const p of emAberto) {
    const k = p.responsavel_id || "__sem";
    const r = porResp.get(k) || { responsavelId: p.responsavel_id || null, nome: p.responsavel_id ? p.responsavel_nome || "Usuário" : "Sem responsável", abertas: 0, atrasadas: 0, semAcao: 0 };
    r.abertas++;
    if (sit.get(p.id) === "atrasada") r.atrasadas++;
    if (sit.get(p.id) === "sem_acao") r.semAcao++;
    porResp.set(k, r);
  }
  // ── Previsão de Vendas Ponderada ──────────────────────────────────────────
  const tempOp = new Map(emAberto.map((p) => [p.id, temperaturaDe({ temperatura: p.temperatura, etapa: p.etapa, propostaSituacao: p.proposta?.situacao || null })]));
  const pondDe = (p: ProcessoBruto) => valorPonderado(p.valor ?? null, tempOp.get(p.id)!.temperatura) || 0;
  const previsaoTemperatura: PainelComercial["previsaoTemperatura"] = [...TEMPERATURAS.slice().reverse(), null].map((t) => {
    const l = emAberto.filter((p) => tempOp.get(p.id)!.temperatura === (t ? t.valor : null));
    return {
      temperatura: t ? t.valor : null, rotulo: t ? t.rotulo : "Sem temperatura (antes da proposta)", pct: t ? t.pct : 0,
      n: l.length, valor: soma(l), ponderado: l.reduce((a, p) => a + pondDe(p), 0), semValor: l.filter((p) => !(valorDe(p) > 0)).length,
    };
  });
  const mesHoje = hoje.slice(0, 7);
  const prevPorMes = new Map<string, ProcessoBruto[]>();
  for (const p of emAberto) {
    if (!tempOp.get(p.id)!.temperatura) continue;
    const dia = p.previsao_fechamento?.slice(0, 10);
    const k = !dia ? "sem" : dia < hoje ? "atrasada" : dia.slice(0, 7);
    prevPorMes.set(k, [...(prevPorMes.get(k) || []), p]);
  }
  const chavesMes = Array.from(prevPorMes.keys()).filter((k) => k !== "sem" && k !== "atrasada").sort();
  const previsaoMes: PainelComercial["previsaoMes"] = [
    ...(prevPorMes.has("atrasada") ? ["atrasada"] : []), ...chavesMes, ...(prevPorMes.has("sem") ? ["sem"] : []),
  ].map((k) => {
    const l = prevPorMes.get(k)!;
    const rotulo = k === "atrasada" ? "Previsão já passou" : k === "sem" ? "Sem previsão de fechamento" : `${rotuloMes(k)}${k === mesHoje ? " (este mês)" : ""}`;
    return { chave: k, rotulo, n: l.length, valor: soma(l), ponderado: l.reduce((a, p) => a + pondDe(p), 0) };
  });

  // ── Propostas (versão mais nova de cada oportunidade em aberto) ──────────
  const propostasAcao: PainelComercial["propostasAcao"] = [];
  let aguardando = 0;
  for (const p of emAberto) {
    if (!p.proposta) continue;
    const vista = situacaoPropostaVista(p.proposta, true, hoje);
    const dias = diasParaValidade(p.proposta.validade, hoje);
    if (vista === "enviada" || vista === "vencida") aguardando++;
    const tipo = vista === "aceita" ? "aceita" : vista === "vencida" ? "vencida" : vista === "enviada" && dias != null && dias <= 7 ? "vence" : null;
    if (!tipo) continue;
    propostasAcao.push({ id: p.id, titulo: p.titulo, cliente: p.orgao_nome, responsavel: p.responsavel_nome || null,
      versao: p.proposta.versao, tipo, validade: p.proposta.validade, dias });
  }
  const ordemTipo = { aceita: 0, vencida: 1, vence: 2 } as const;
  propostasAcao.sort((a, b) => ordemTipo[a.tipo] - ordemTipo[b.tipo] || (a.dias ?? 0) - (b.dias ?? 0) || a.titulo.localeCompare(b.titulo, "pt-BR"));
  const contaTipo = (t: "vencida" | "vence" | "aceita") => propostasAcao.filter((x) => x.tipo === t).length;

  const followupsPorResponsavel = Array.from(porResp.values())
    .sort((a, b) => b.atrasadas - a.atrasadas || b.semAcao - a.semAcao || b.abertas - a.abertas || a.nome.localeCompare(b.nome, "pt-BR"));

  // ── Histórico: ganhas → projeto ───────────────────────────────────────────
  const ossPorProjeto = porChave(d.oss, (o) => o.projeto_id);
  const historico = procs.filter((p) => p.resultado === "ganha").map((p) => {
    const pj = p.projeto_id ? projetos.get(p.projeto_id) : undefined;   // na lixeira = sem projeto
    const lista = pj ? ossPorProjeto.get(pj.id) || [] : [];
    const ossAbertas = lista.filter((o) => !o.encerrada_em).length;
    return {
      id: p.id, titulo: p.titulo, clienteId: p.orgao_id, cliente: p.orgao_nome, valor: p.valor ?? null, ganhaEm: p.resultado_em?.slice(0, 10) || null,
      projeto: pj ? {
        id: pj.id, codigo: pj.codigo_projeto, oss: lista.length, ossAbertas,
        situacao: (pj.concluido_em || (lista.length && !ossAbertas) ? "concluido" : lista.length ? "andamento" : "sem_os") as "concluido" | "andamento" | "sem_os",
      } : null,
    };
  }).sort((a, b) => (b.ganhaEm || "").localeCompare(a.ganhaEm || "") || a.titulo.localeCompare(b.titulo, "pt-BR"));
  const comProjetoHist = historico.filter((x) => x.projeto).length;

  // ── Projetos novos e recompra ─────────────────────────────────────────────
  const projetosDoProc = proc ? new Set(d.oss.filter((o) => o.procedimento === proc).map((o) => o.projeto_id)) : null;
  const projsCli = d.projetos.filter((p) => (!filtros.cliente || p.cliente_id === filtros.cliente) && (!projetosDoProc || projetosDoProc.has(p.id)))
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
      funil: { ativos: procs.filter(aberta).length, ganhasPeriodo: fechadasNoPeriodo("ganha"), perdidasPeriodo: fechadasNoPeriodo("perdida"), criadosPeriodo: criadosPeriodo.length },
      conversao: { criados: criadosPeriodo.length, ganhas: criadosGanhos, taxa: criadosPeriodo.length ? criadosGanhos / criadosPeriodo.length : null },
      parados: paradosLista.length,
      projetosNovos: {
        periodo: noPer.length, anterior: noAnt, variacao: variacao(noPer.length, noAnt),
        clientesNovos: noPer.filter(ehNovo).length, recorrentes: noPer.filter((p) => !ehNovo(p)).length,
      },
      recompra: { base: baseRecompra, recompraram, taxa: baseRecompra ? recompraram / baseRecompra : null },
      followups: {
        abertas: emAberto.length, atrasadas: followupsAtrasados.length,
        hoje: emAberto.filter((p) => sit.get(p.id) === "hoje").length,
        semAcao: emAberto.filter((p) => sit.get(p.id) === "sem_acao").length,
      },
      previsao: {
        ponderado: emAberto.reduce((a, p) => a + pondDe(p), 0),
        valor: soma(emAberto.filter((p) => tempOp.get(p.id)!.temperatura)),
        comTemperatura: emAberto.filter((p) => tempOp.get(p.id)!.temperatura).length,
        semTemperatura: emAberto.filter((p) => !tempOp.get(p.id)!.temperatura).length,
        manuais: emAberto.filter((p) => !tempOp.get(p.id)!.automatica).length,
      },
      propostas: { aguardando, vencidas: contaTipo("vencida"), vencem7: contaTipo("vence"), aceitas: contaTipo("aceita") },
      pipeline: {
        valor: soma(emAberto), abertas: emAberto.length, semValor: emAberto.filter((p) => !(valorDe(p) > 0)).length,
        previsto30: soma(previstas), qtdPrevisto30: previstas.length,
      },
      ganho: {
        ganhas: ganhasPer.length, perdidas: perdidasPer.length,
        taxa: ganhasPer.length + perdidasPer.length ? ganhasPer.length / (ganhasPer.length + perdidasPer.length) : null,
        valorGanho: soma(ganhasPer), valorPerdido: soma(perdidasPer),
        ticketMedio: ganhasComValor.length ? soma(ganhasComValor) / ganhasComValor.length : null,
        cicloMediano: mediana(ciclos),
      },
    },
    motivosPerda,
    origens,
    followupsAtrasados: followupsAtrasados.slice(0, 30),
    followupsPorResponsavel,
    propostasAcao: propostasAcao.slice(0, 40),
    previsaoTemperatura,
    previsaoMes,
    projetosFollowup: { total: historico.length, comProjeto: comProjetoHist, semProjeto: historico.length - comProjetoHist, itens: historico.slice(0, 100) },
    renovacoes: renovacoes.slice(0, 30),
    inativos: inativos.slice(0, 30),
    andamento: andamento.slice(0, 20),
    funil,
    parados: paradosLista.slice(0, 25),
    mensal,
  };
}

// ── Auxiliares ───────────────────────────────────────────────────────────────

/** Soma dias a um dia AAAA-MM-DD. */
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

