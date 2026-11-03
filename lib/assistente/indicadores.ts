/**
 * Consulta "indicadores" do robô: os mesmos números do Dashboard de Operações
 * (montarDashboard), lidos com a sessão de quem pergunta. Cada assunto devolve
 * só a parte do painel que responde a pergunta, para caber no contexto da IA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIMITE_PARADA_DIAS, montarDashboard, type ChavePeriodo, type RefOS } from "@/lib/asp/dashboard";
import { carregarDadosDashboard } from "@/lib/asp/dashboard-dados";
import { ROTULO_STATUS_RECORRENCIA } from "@/lib/validacao/recorrencia";
import { hojeBrasil } from "@/lib/validacao/formatos";
import { normalizar } from "./manual-busca";

export const ASSUNTOS = ["geral", "paradas", "clientes", "recorrencia", "aprovacoes", "campo"] as const;

export const FERRAMENTA_INDICADORES = {
  name: "indicadores",
  description:
    "Números e listas do Dashboard de Operações. assunto: " +
    "geral = totais do período e quantas OS há em cada fase; " +
    "paradas = OS paradas na fase há mais de dias_parada dias (padrão 15); " +
    "clientes = OS e projetos por cliente; " +
    "recorrencia = clientes recorrentes com serviço vencido ou vencendo; " +
    "aprovacoes = relatórios aguardando aprovação e assinatura; " +
    "campo = RDOs faltando, fotos incompletas, medições sem aprovação e laudos fora do limite. " +
    "Use para \"quantas\", \"quais estão paradas\", \"por cliente\", \"vencendo este mês\".",
  input_schema: {
    type: "object" as const,
    properties: {
      assunto: { type: "string", enum: [...ASSUNTOS] },
      periodo: { type: "string", enum: ["7", "30", "90", "ano"], description: "Período dos totais (padrão 30 dias)." },
      de: { type: "string", description: "Início AAAA-MM-DD (período personalizado, com ate)." },
      ate: { type: "string", description: "Fim AAAA-MM-DD." },
      cliente: { type: "string", description: "Nome (ou trecho) do cliente para filtrar." },
      dias_parada: { type: "integer", minimum: 1, description: "Só para assunto=paradas." },
    },
    required: ["assunto"],
    additionalProperties: false,
  },
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const os = (o: RefOS) => ({ identificacao: o.identificacao, projeto: o.projeto, cliente: o.cliente, fase: o.fase, link: `/inspecoes/${o.id}` });

export async function consultarIndicadores(sb: SupabaseClient, e: Record<string, unknown>): Promise<unknown> {
  const assunto = ASSUNTOS.includes(e.assunto as any) ? (e.assunto as (typeof ASSUNTOS)[number]) : "geral";
  const personalizado = typeof e.de === "string" && ISO.test(e.de) && typeof e.ate === "string" && ISO.test(e.ate);
  const periodo = (personalizado ? "personalizado" : ["7", "30", "90", "ano"].includes(String(e.periodo)) ? String(e.periodo) : "30") as ChavePeriodo;

  const dados = await carregarDadosDashboard(sb);
  // cliente por nome → id (o painel filtra por id)
  let cliente: string | null = null;
  if (typeof e.cliente === "string" && e.cliente.trim()) {
    const alvo = normalizar(e.cliente.trim());
    const achados = (dados.orgaos || []).filter((o: any) => normalizar(o.razao_social || "").includes(alvo));
    if (!achados.length) return { erro: `Nenhum cliente encontrado com "${e.cliente}".` };
    if (achados.length > 1) return { erro: "Mais de um cliente com esse nome; peça o nome completo.", clientes: achados.slice(0, 10).map((o: any) => o.razao_social) };
    cliente = (achados[0] as any).id;
  }
  const hoje = hojeBrasil();
  const p = montarDashboard(dados, { periodo, de: personalizado ? (e.de as string) : null, ate: personalizado ? (e.ate as string) : null, cliente }, hoje);
  const base = { periodo: { de: p.periodo.de, ate: p.periodo.ate }, ...(cliente ? { cliente: e.cliente } : {}) };

  switch (assunto) {
    case "geral": {
      const k = p.kpis;
      return {
        ...base,
        os_em_andamento: k.osAndamento, os_abertas_no_periodo: k.osAbertasPeriodo, os_encerradas_no_periodo: k.osEncerradasPeriodo,
        projetos_ativos: k.projetosAtivos, projetos_concluidos_no_periodo: k.projetosConcluidosPeriodo,
        lead_time_dias_mediana: k.leadTime?.mediana ?? null, os_paradas_mais_de_15_dias: k.paradas,
        aguardando_aprovacao: k.aguardandoAprovacao.total, aguardando_assinatura: k.aguardandoAssinatura.total,
        entregas_no_periodo: k.entregasPeriodo,
        reprovacao_pct: k.reprovacao.total.taxa == null ? null : Math.round(k.reprovacao.total.taxa * 100),
        os_por_fase: p.funil.map((f) => ({ fase: f.fase, titulo: f.titulo, abertas: f.abertas, paradas: f.paradas })),
      };
    }
    case "paradas": {
      const min = Math.max(1, Number(e.dias_parada) || LIMITE_PARADA_DIAS);
      const lista = p.funil.flatMap((f) => f.oss.filter((o) => o.dias >= min).map((o) => ({ ...os(o), fase_titulo: f.titulo, dias_na_fase: o.dias })))
        .sort((a, b) => b.dias_na_fase - a.dias_na_fase);
      return { ...base, parada_ha_mais_de_dias: min, total: lista.length, os: lista.slice(0, 30) };
    }
    case "clientes":
      return { ...base, clientes: p.clientes.slice(0, 30).map((c) => ({
        cliente: c.nome, projetos: c.projetos, os_abertas: c.osAbertas, os_abertas_no_periodo: c.osAbertasPeriodo,
        os_encerradas_no_periodo: c.osEncerradasPeriodo, entregas_no_periodo: c.entregasPeriodo,
        ...(c.id ? { link: `/orgaos/${c.id}` } : {}),
      })) };
    case "recorrencia":
      return {
        ...base, total: p.recorrencia.total, vencidos: p.recorrencia.vencidos, em_breve: p.recorrencia.emBreve, sem_historico: p.recorrencia.semHistorico,
        clientes: p.recorrencia.itens.map((r) => ({
          cliente: r.cliente, situacao: ROTULO_STATUS_RECORRENCIA[r.status], periodicidade_meses: r.periodicidadeMeses,
          ultima_execucao: r.ultimaExecucao, vencimento: r.vencimento, link: `/orgaos/${r.clienteId}`,
        })),
      };
    case "aprovacoes":
      return {
        ...base,
        aguardando_aprovacao: p.filas.aprovacao.map((f) => ({ ...os(f.os), relatorio: f.tipo, versao: f.versao, ha_dias: f.dias })),
        aguardando_assinatura: p.filas.assinatura.map((f) => ({ ...os(f.os), relatorio: f.tipo, versao: f.versao, ha_dias: f.dias })),
      };
    case "campo":
      return {
        ...base,
        rdo_faltando: p.campo.rdoFaltando.map((r) => ({ ...os(r.os), dias: r.dias })),
        fotos_incompletas: p.campo.fotosIncompletas.map((r) => ({ ...os(r.os), feitos: r.feitos, total: r.total })),
        medicoes_sem_aprovacao: p.campo.medicoesSemAprovacao.map((r) => ({ ...os(r.os), medicoes: r.medicoes })),
        laudos_fora_do_limite: p.campo.laudosForaDoLimite.map((r) => ({ ...os(r.os), parametros: r.parametros })),
        totais: p.campo.totais,
      };
  }
}
