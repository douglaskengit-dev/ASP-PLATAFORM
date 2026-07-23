/**
 * Macrofases do fluxo de processos (Fluxograma Macro).
 *
 * tipo "auto": fase coberta pela automação de documentos — avança sozinha
 * conforme os documentos entram. Não pode ser selecionada manualmente.
 * tipo "manual": fase conduzida pela equipe, avançada manualmente pelo sistema.
 *
 * Todas as fases do fluxo atual são manuais — não há automação de documentos
 * disparando o avanço de etapa.
 */
export type TipoEtapa = "auto" | "manual";

export interface EtapaFluxo {
  nome: string;
  tipo: TipoEtapa;
}

export const ETAPAS_FLUXO: EtapaFluxo[] = [
  { nome: "Abertura", tipo: "manual" },
  { nome: "Dados Iniciais do Cliente", tipo: "manual" },
  { nome: "Agendar visita", tipo: "manual" },
  { nome: "Coleta de dados de Campo", tipo: "manual" },
  { nome: "Relatório", tipo: "manual" },
  { nome: "Agendar execução", tipo: "manual" },
  { nome: "Relatório de Limpeza", tipo: "manual" },
  { nome: "Finalizado", tipo: "manual" },
];

/** Documentos essenciais anexáveis manualmente ao processo. */
export const DOCS_FOLLOWUP = ["oficio"] as const;
