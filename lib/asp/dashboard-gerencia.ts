/** Dashboard de Gerência — visão geral da operação (agregações puras).
 *
 * Usa os mesmos dados do Dashboard de Operações (lib/asp/dashboard-dados.ts)
 * mais a calibração dos equipamentos. Reaproveita o montarDashboard para o
 * que já é calculado lá (reprovação, fases, campo, laudos) e acrescenta a
 * visão de resultado: série de 12 meses, prazo total, ocupação média e dias
 * em campo. Filtros: período, cliente e procedimento. */
import { diaBrasilia, periodoDe, intersecao, normalizarEquipamento, situacaoCalibracao, somarDias, vencimentoCalibracao, type UnidadeEquipamento } from "../validacao";
import {
  diferencaDias, estatistica, LIMITE_PARADA_DIAS, montarDashboard, noIntervalo, porChave,
  type ChavePeriodo, type DadosDashboard, type Estatistica, type FiltrosDashboard, type Intervalo, type RefOS, type Taxa,
} from "./dashboard";
import { aberturaOS, entregaFinal, fimExecucao, mesAnoAnterior, mesDe, mediana, ossDoRecorte, periodoAnterior, rotuloMes, ultimos12Meses, variacao } from "./dashboard-comum";

export interface CalibracaoDashboard {
  equipamentos: { id: string; nome: string; ativo: boolean; exige_calibracao: boolean }[];
  unidades: UnidadeEquipamento[];
  erro?: string;
}

/** Janela da ocupação: hoje + 29 dias. Equipe/frota = quem esteve em algum
 *  agendamento de 90 dias atrás até o fim da janela. */
export const JANELA_OCUPACAO = 30;
export const BASE_EQUIPE_DIAS = 90;

export interface PainelGerencia {
  geradoEm: string;
  hoje: string;
  periodo: Intervalo & { chave: ChavePeriodo };
  anterior: Intervalo;
  filtros: FiltrosDashboard;
  opcoes: { clientes: { id: string; nome: string }[]; procedimentos: { codigo: string; nome: string }[] };
  base: { oss: number };
  kpis: {
    concluidas: { periodo: number; anterior: number; variacao: number | null };
    prazoTotal: Estatistica | null;
    carteira: { abertas: number; paradas: number; maisAntigaDias: number | null };
    retrabalho: Taxa;
    pendencias: { rdo: number; fotos: number; medicoes: number; encerramento: number; encerradasComPendencia: number };
    ocupacao: { equipe: number | null; pessoas: number; equipamentos: number | null; nEquipamentos: number };
    calibracao: { vencidas: number; venceBreve: number; total: number; erro?: string };
    aguaConforme: { avaliados: number; conformes: number; taxa: number | null };
    diasCampo: Estatistica | null;
  };
  mensal: {
    mes: string; rotulo: string;
    concluidas: number; concluidasAnoAnterior: number;
    prazoMediano: number | null; entregas: number;
    avaliacoes: number; reprovacoes: number; taxaReprovacao: number | null;
  }[];
  motivos: { rotulo: string; total: number }[];
  carteiraPorFase: { fase: number; titulo: string; abertas: number; paradas: number }[];
  maisAntigas: (RefOS & { dias: number })[];
  ocupacaoPessoas: { nome: string; dias: number }[];
  ocupacaoEquipamentos: { nome: string; dias: number }[];
  calibracaoItens: { equipamento: string; identificacao: string; venceEm: string | null; situacao: "vencida" | "vence_breve" }[];
}

export function montarGerencia(
  d: DadosDashboard, cal: CalibracaoDashboard | null, f: FiltrosDashboard, hoje: string, agora: string = new Date().toISOString(),
): PainelGerencia {
  const filtros: FiltrosDashboard = { ...f, pessoa: null };
  const op = montarDashboard(d, filtros, hoje, agora);
  const periodo = op.periodo;
  const anterior = periodoAnterior(periodo);
  const oss = ossDoRecorte(d, filtros);
  const ids = new Set(oss.map((o) => o.id));
  const projetos = new Map(d.projetos.map((p) => [p.id, p]));
  const agsPorOS = porChave(d.agendamentos.filter((a) => ids.has(a.inspecao_id)), (a) => a.inspecao_id);
  const entregasPorOS = porChave(d.entregas.filter((e) => ids.has(e.inspecao_id)), (e) => e.inspecao_id);

  // ── Concluídas (no período × período anterior) ────────────────────────────
  const encerradaNo = (i: Intervalo) => oss.filter((o) => noIntervalo(diaBrasilia(o.encerrada_em), i)).length;
  const concluidas = encerradaNo(periodo), concluidasAnt = encerradaNo(anterior);

  // ── Prazo total: abertura → entrega final ao cliente ──────────────────────
  const prazos: { dia: string; dias: number }[] = [];
  for (const o of oss) {
    const ent = entregaFinal(entregasPorOS.get(o.id) || [], fimExecucao(agsPorOS.get(o.id) || []));
    const ab = aberturaOS(o);
    if (!ent || !ab) continue;
    const n = diferencaDias(ab, ent);
    if (n >= 0) prazos.push({ dia: ent, dias: n });
  }

  // ── Carteira (estado atual) ───────────────────────────────────────────────
  const abertas = oss.filter((o) => !o.encerrada_em);
  const idadeAbertura = (o: (typeof oss)[number]) => Math.max(0, diferencaDias(aberturaOS(o) || hoje, hoje));
  const maisAntigas = abertas.map((o) => {
    const p = projetos.get(o.projeto_id)!;
    return {
      id: o.id, identificacao: o.identificacao, fase: o.fase, comInspecao: o.com_inspecao !== false, projetoId: p.id,
      projeto: p.codigo_projeto || p.pedido_compra || "Projeto", cliente: p.cliente_nome, dias: idadeAbertura(o),
    };
  }).sort((a, b) => b.dias - a.dias);

  // ── Série de 12 meses ─────────────────────────────────────────────────────
  const meses = ultimos12Meses(hoje);
  const encPorMes = new Map<string, number>();
  for (const o of oss) {
    const m = mesDe(diaBrasilia(o.encerrada_em));
    if (m) encPorMes.set(m, (encPorMes.get(m) || 0) + 1);
  }
  const prazoPorMes = porChave(prazos, (x) => mesDe(x.dia));
  const avalPorMes = new Map<string, { av: number; rep: number }>();
  for (const h of d.historico) {
    if (!ids.has(h.inspecao_id) || (h.acao !== "aprovar" && h.acao !== "reprovar")) continue;
    if (Number(h.fase_de) !== 5 && Number(h.fase_de) !== 9) continue;
    const m = mesDe(diaBrasilia(h.criado_em));
    if (!m) continue;
    const x = avalPorMes.get(m) || { av: 0, rep: 0 };
    x.av++; if (h.acao === "reprovar") x.rep++;
    avalPorMes.set(m, x);
  }
  const mensal = meses.map((mes) => {
    const pz = (prazoPorMes.get(mes) || []).map((x) => x.dias);
    const av = avalPorMes.get(mes) || { av: 0, rep: 0 };
    return {
      mes, rotulo: rotuloMes(mes),
      concluidas: encPorMes.get(mes) || 0, concluidasAnoAnterior: encPorMes.get(mesAnoAnterior(mes)) || 0,
      prazoMediano: mediana(pz), entregas: pz.length,
      avaliacoes: av.av, reprovacoes: av.rep, taxaReprovacao: av.av ? av.rep / av.av : null,
    };
  });

  // ── Ocupação média (próximos 30 dias) ─────────────────────────────────────
  const janela = { inicio: hoje, fim: somarDias(hoje, JANELA_OCUPACAO - 1) };
  const baseEquipe = { inicio: somarDias(hoje, -BASE_EQUIPE_DIAS), fim: janela.fim };
  const pessoas = new Map<string, { nome: string; dias: Set<string> }>();
  const equips = new Map<string, { nome: string; dias: Set<string> }>();
  for (const a of d.agendamentos) {
    if (!ids.has(a.inspecao_id) || a.a_definir) continue;
    const p = periodoDe(a);
    if (!p || !intersecao(p, baseEquipe)) continue;
    const comum = intersecao(p, janela);
    const dias: string[] = [];
    if (comum) for (let x = comum.inicio; x <= comum.fim; x = somarDias(x, 1)) dias.push(x);
    for (const m of a.equipe || []) {
      if (!m?.id) continue;
      const e = pessoas.get(m.id) || { nome: m.nome || "Sem nome", dias: new Set<string>() };
      dias.forEach((x) => e.dias.add(x));
      pessoas.set(m.id, e);
    }
    for (const nome of a.equipamentos || []) {
      const k = normalizarEquipamento(nome);
      if (!k) continue;
      const e = equips.get(k) || { nome, dias: new Set<string>() };
      dias.forEach((x) => e.dias.add(x));
      equips.set(k, e);
    }
  }
  const media = (m: Map<string, { dias: Set<string> }>) =>
    m.size ? Array.from(m.values()).reduce((s, e) => s + e.dias.size, 0) / (m.size * JANELA_OCUPACAO) : null;
  const lista = (m: Map<string, { nome: string; dias: Set<string> }>) =>
    Array.from(m.values(), (e) => ({ nome: e.nome, dias: e.dias.size })).sort((a, b) => b.dias - a.dias || a.nome.localeCompare(b.nome, "pt-BR"));

  // ── Dias em campo (OSs encerradas no período, pelos RDOs) ─────────────────
  const diasRdo = new Map<string, Set<string>>();
  for (const r of d.rdos) {
    for (const id of r.inspecoes || []) {
      if (!ids.has(id)) continue;
      const s = diasRdo.get(id) || new Set<string>();
      s.add(String(r.data).slice(0, 10));
      diasRdo.set(id, s);
    }
  }
  const diasCampo = oss.filter((o) => noIntervalo(diaBrasilia(o.encerrada_em), periodo))
    .map((o) => diasRdo.get(o.id)?.size || 0).filter((n) => n > 0);

  // ── Calibração (estado atual; não depende dos filtros) ────────────────────
  const calibracaoItens: PainelGerencia["calibracaoItens"] = [];
  let totalUnidades = 0;
  if (cal && !cal.erro) {
    const eqs = new Map(cal.equipamentos.filter((e) => e.ativo && e.exige_calibracao).map((e) => [e.id, e]));
    for (const u of cal.unidades) {
      const eq = eqs.get(u.equipamento_id);
      if (!eq || u.ativo === false) continue;
      totalUnidades++;
      const vence = vencimentoCalibracao(u);
      const sit = situacaoCalibracao(vence, hoje);
      if (sit === "vencida" || sit === "vence_breve" || sit === "sem_calibracao") {
        calibracaoItens.push({ equipamento: eq.nome, identificacao: u.identificacao, venceEm: vence, situacao: sit === "vence_breve" ? "vence_breve" : "vencida" });
      }
    }
    calibracaoItens.sort((a, b) => (a.venceEm || "").localeCompare(b.venceEm || ""));
  }

  const avaliados = op.campo.laudosAvaliados;
  const forasDoLimite = op.campo.totais.laudos;
  return {
    geradoEm: agora,
    hoje,
    periodo,
    anterior,
    filtros,
    opcoes: { clientes: op.opcoes.clientes, procedimentos: op.opcoes.procedimentos },
    base: { oss: oss.length },
    kpis: {
      concluidas: { periodo: concluidas, anterior: concluidasAnt, variacao: variacao(concluidas, concluidasAnt) },
      prazoTotal: estatistica(prazos.filter((x) => noIntervalo(x.dia, periodo)).map((x) => x.dias)),
      carteira: { abertas: abertas.length, paradas: op.kpis.paradas, maisAntigaDias: maisAntigas[0]?.dias ?? null },
      retrabalho: op.kpis.reprovacao.total,
      pendencias: {
        rdo: op.campo.totais.rdo, fotos: op.campo.totais.fotos, medicoes: op.campo.totais.medicoes,
        encerramento: op.kpis.encerramento.comPendencia, encerradasComPendencia: op.kpis.encerradasManualPeriodo,
      },
      ocupacao: { equipe: media(pessoas), pessoas: pessoas.size, equipamentos: media(equips), nEquipamentos: equips.size },
      calibracao: {
        vencidas: calibracaoItens.filter((x) => x.situacao === "vencida").length,
        venceBreve: calibracaoItens.filter((x) => x.situacao === "vence_breve").length,
        total: totalUnidades,
        ...(cal?.erro ? { erro: cal.erro } : {}),
      },
      aguaConforme: { avaliados, conformes: avaliados - forasDoLimite, taxa: avaliados ? (avaliados - forasDoLimite) / avaliados : null },
      diasCampo: estatistica(diasCampo),
    },
    mensal,
    motivos: op.motivos.map((m) => ({ rotulo: m.rotulo, total: m.total })),
    carteiraPorFase: op.funil.filter((x) => x.abertas > 0).map((x) => ({ fase: x.fase, titulo: x.titulo, abertas: x.abertas, paradas: x.paradas })),
    maisAntigas: maisAntigas.slice(0, 10),
    ocupacaoPessoas: lista(pessoas).slice(0, 15),
    ocupacaoEquipamentos: lista(equips).slice(0, 15),
    calibracaoItens: calibracaoItens.slice(0, 25),
  };
}

export { LIMITE_PARADA_DIAS };
