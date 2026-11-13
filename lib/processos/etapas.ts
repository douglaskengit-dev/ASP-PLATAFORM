/**
 * Etapas comerciais do Follow-up (CRM). O processo é uma oportunidade de
 * venda: anda pelas etapas abaixo e termina com um resultado — ganha ou
 * perdida (gp_processos.resultado). Depois de ganha, a execução segue nas OSs.
 *
 * Até a migração 20261114100000_asp_crm_followup, eram 8 macrofases que
 * misturavam venda e operação; a migração converteu etapa e histórico
 * (gp_processos.etapas_versao = 2). Todas as etapas são manuais.
 */
export type TipoEtapa = "auto" | "manual";

export interface EtapaFluxo {
  nome: string;
  tipo: TipoEtapa;
}

export const ETAPAS_FLUXO: EtapaFluxo[] = [
  { nome: "Prospecção", tipo: "manual" },
  { nome: "Qualificação", tipo: "manual" },
  { nome: "Visita técnica", tipo: "manual" },
  { nome: "Proposta", tipo: "manual" },
  { nome: "Negociação", tipo: "manual" },
];

/** Documentos essenciais anexáveis manualmente ao processo. */
export const DOCS_FOLLOWUP = ["oficio"] as const;

/** A etapa "Visita técnica" tem a ferramenta Medidor de Sedimento
 * disponível (public/ferramentas/medidor-sedimento.html), embutida por
 * iframe num modal. */
export function etapaTemMedidorSedimento(nomeEtapa: string | undefined): boolean {
  return nomeEtapa === "Visita técnica";
}
