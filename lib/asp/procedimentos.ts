/**
 * Catálogo de apoio ao Relatório Técnico: materiais de tanque, procedimentos
 * e equipamentos com especificação.
 *
 * Hoje é uma lista local (o cadastro de procedimentos ainda será mapeado no
 * banco). A forma dos dados já é a de uma tabela, então a troca por consulta
 * ao Supabase depois é direta: basta substituir estas constantes por um fetch
 * e manter os mesmos campos.
 */

/** Materiais usuais de tanques de água/combate a incêndio. */
export const MATERIAIS_TANQUE = [
  "Aço carbono",
  "Aço carbono com revestimento epóxi",
  "Aço inoxidável AISI 304",
  "Aço inoxidável AISI 316",
  "Aço galvanizado",
  "Concreto armado",
  "Fibra de vidro (PRFV)",
  "Polietileno de alta densidade (PEAD)",
  "Alvenaria",
];

export interface Equipamento {
  id: string;
  nome: string;
  /** Especificação técnica que entra no relatório junto do nome. */
  especificacao: string;
}

/** Equipamentos da ASP com a especificação usada no relatório. */
export const EQUIPAMENTOS: Equipamento[] = [
  { id: "rov", nome: "ROV de inspeção visual", especificacao: "veículo submersível operado remotamente, com câmera de alta definição e iluminação LED" },
  { id: "sonar", nome: "Sonar batimétrico", especificacao: "transdutor acoplado ao ROV para medição da distância até o sedimento" },
  { id: "regua", nome: "Régua graduada de conferência", especificacao: "com peso de 0,15 m na extremidade, para validação das leituras do sonar" },
  { id: "umbilical", nome: "Cabo umbilical", especificacao: "transmissão de dados e energia entre o ROV e a estação de superfície" },
  { id: "estacao", nome: "Estação de superfície", especificacao: "console de comando com monitor e gravação das imagens" },
  { id: "trena", nome: "Trena eletrônica", especificacao: "medição das dimensões do tanque" },
  { id: "epi", nome: "EPIs de espaço confinado", especificacao: "conforme NR-33, incluindo detector de gases e cinto de segurança" },
];

export interface Procedimento {
  codigo: string;
  nome: string;
  /** Texto sugerido para o tópico "Métodos". */
  metodos: string;
  /** Equipamentos previstos por este procedimento. */
  equipamentos: string[];
}

export const PROCEDIMENTOS: Procedimento[] = [
  {
    codigo: "PR-BAT-001",
    nome: "Batimetria por ROV com sonar",
    metodos:
      "O levantamento batimétrico foi executado por veículo submersível operado remotamente (ROV) equipado com sonar, sem necessidade de esvaziamento do reservatório.\n" +
      "O ROV percorreu vetores paralelos ao longo do fundo do tanque; em cada ponto foram registradas três leituras de sonar (esquerda, centro e direita) e uma medição de régua para conferência da coluna de água.\n" +
      "A espessura de sedimento em cada ponto corresponde à altura real da régua menos a altura real do sonar, aplicadas as constantes de compensação do ROV e do peso da régua.\n" +
      "O volume total foi obtido por interpolação da superfície entre os pontos medidos e integração sobre a área do fundo.",
    equipamentos: ["rov", "sonar", "regua", "umbilical", "estacao", "epi"],
  },
  {
    codigo: "PR-INSP-002",
    nome: "Inspeção visual submersa",
    metodos:
      "A inspeção visual foi executada por veículo submersível operado remotamente (ROV), com registro em vídeo do costado e do fundo do reservatório.\n" +
      "O percurso cobriu a totalidade da superfície acessível, com registro fotográfico dos pontos de interesse.",
    equipamentos: ["rov", "umbilical", "estacao", "epi"],
  },
];

/** Monta o texto do tópico "Equipamentos utilizados" a partir dos IDs. */
export function textoEquipamentos(ids: string[]): string {
  return EQUIPAMENTOS.filter((e) => ids.includes(e.id))
    .map((e) => `${e.nome} — ${e.especificacao}.`)
    .join("\n");
}
