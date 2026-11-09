/** Recomendações padrão do relatório de limpeza (POP 001; referência:
 * relatório da Syngenta de 26/08/2026). Puras: o formulário chama.
 *
 * Cada bloco é um texto que o técnico liga e desliga. A origem da água, no
 * cadastro do tanque, decide só o que já nasce marcado — quem recebe da
 * concessionária não recebe o texto de poço artesiano, e vice-versa. */
import { normalizarTexto } from "./texto";

export interface BlocoRecomendacao {
  id: string;
  /** Rótulo da caixa de seleção. */
  titulo: string;
  /** Parágrafos (texto puro). */
  paragrafos: string[];
  /** Já nasce marcado em qualquer tanque. */
  padrao?: boolean;
  /** Já nasce marcado quando a água vem desta origem. */
  origem?: string;
}

export const BLOCOS_RECOMENDACAO: BlocoRecomendacao[] = [
  {
    id: "repintura", titulo: "Preparação de superfície e repintura",
    paragrafos: ["Recomenda-se a realização de preparação de superfície conforme padrão técnico aplicável, seguida da reaplicação de sistema de pintura adequado nas regiões de teto, costado e fundo, visando interromper o processo corrosivo e restabelecer a proteção do reservatório."],
  },
  {
    id: "ultrassom", titulo: "Monitoramento por ultrassom (API 653)",
    paragrafos: ["Adicionalmente, recomenda-se o monitoramento contínuo das áreas com presença de corrosão no teto, costado e fundo, por meio da execução de ensaios ultrassônicos periódicos para verificação da espessura das chapas, em conformidade com os critérios estabelecidos pela API 653."],
  },
  {
    id: "cvs36", titulo: "Limpeza a cada seis meses (CVS 36)", padrao: true,
    paragrafos: ["Conforme o Comunicado CVS 36, de 27/06/1991, do Centro de Vigilância Sanitária, é indicado que a limpeza de reservatórios de água potável seja realizada periodicamente, com um intervalo máximo de seis meses entre as lavagens, como medida preventiva. Essa prática visa evitar o acúmulo de sedimentos e outros materiais que possam comprometer a qualidade da água armazenada."],
  },
  {
    id: "artigo11", titulo: "Reparo do revestimento (Artigo 11)", padrao: true,
    paragrafos: [
      "Além disso, devido ao estado do piso e das paredes do reservatório observado durante a inspeção, recomendamos que sejam feitos reparos no revestimento, aplicando um acabamento antiaderente e atóxico, em conformidade com o Decreto Estadual nº 12.342/78, que estabelece:",
      "Artigo 11 – Os reservatórios prediais deverão:",
      "I – Ser construídos e revestidos com materiais que não possam contaminar a água;",
      "II – Ter a superfície lisa, resistente e impermeável.",
      "Esses reparos são essenciais para garantir que o reservatório atenda aos padrões de qualidade exigidos para o armazenamento de água potável, prevenindo a contaminação por partículas soltas, infiltrações ou outros materiais.",
    ],
  },
  {
    id: "calafetacao", titulo: "Calafetação das aberturas no teto",
    paragrafos: ["Além disso, é recomendada a calafetação nos pontos de abertura no teto em volta dos tubos de saída da água, visando evitar a entrada de elementos estranhos e contaminação."],
  },
  {
    id: "placa", titulo: "Instalação de placa de identificação do tanque",
    paragrafos: ["Não foi identificada placa de identificação no reservatório. Recomenda-se a instalação de placa com os dados do tanque (identificação, capacidade e ano de fabricação), para facilitar a rastreabilidade e a manutenção."],
  },
  {
    id: "potabilidade", titulo: "Análise de potabilidade semestral (água da concessionária)", origem: "concessionaria",
    paragrafos: ["Além da limpeza e desinfecção do reservatório a cada seis meses e da manutenção da sua integridade estrutural, recomendamos também a realização de uma análise de potabilidade semestral em ponto de consumo. Essa medida é uma boa prática para assegurar que a água que chega da concessionária mantém suas características de potabilidade após passar pelo reservatório e pela rede interna do imóvel, garantindo a segurança dos usuários."],
  },
  {
    id: "poco", titulo: "Monitoramento de cloro e análises mensais (poço artesiano)", origem: "poco",
    paragrafos: [
      "Como boa prática, também recomendamos o monitoramento regular dos níveis de cloro residual livre, que devem ser mantidos no mínimo em 0,2 mg/L (para cloro livre) ou entre 2 mg/L para cloro residual combinado, ou 0,2 mg/L de dióxido de cloro, conforme aplicável, em todo o sistema de distribuição (incluindo o reservatório e a rede de distribuição) e nos pontos de consumo. Essa medida é fundamental para garantir a manutenção da potabilidade da água e a segurança dos usuários.",
      "De acordo com a Resolução Estadual n°SS 65/2005 e a Portaria GM/MS nº 05/2017, o monitoramento regular da qualidade da água é obrigatório, especialmente para sistemas de Soluções Alternativas Coletivas (SAC) de abastecimento, como é o caso de água proveniente de poço artesiano. Além do monitoramento diário dos níveis de cloro residual, também devem ser realizadas análises mensais dos seguintes parâmetros para assegurar a potabilidade da água: Cor, Turbidez, pH, Cloro Residual Livre e Análises Microbiológicas (coliformes totais e Escherichia coli).",
      "Essas análises são essenciais para garantir que a água continue em conformidade com os padrões de potabilidade estabelecidos pelas legislações, assegurando a qualidade da água para consumo humano e a proteção da saúde pública.",
    ],
  },
];

/** Parágrafos padrão da Conclusão: nenhum nasce marcado, o técnico escolhe. */
export const BLOCOS_CONCLUSAO: BlocoRecomendacao[] = [
  {
    id: "sucesso", titulo: "Limpeza realizada com sucesso",
    paragrafos: ["A limpeza foi realizada com sucesso, atendendo todas as expectativas, removendo eficientemente os sedimentos e expondo o fundo do tanque."],
  },
  {
    id: "reparos", titulo: "Revestimento exige reparos",
    paragrafos: ["No entanto, é importante ressaltar que, apesar de a limpeza ter sido bem-sucedida, a condição do revestimento do piso e das paredes do reservatório exigem reparos para garantir que a integridade estrutural e sanitária seja mantida, conforme detalhado nas recomendações a seguir."],
  },
];

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const htmlDoBloco = (b: BlocoRecomendacao) => b.paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("");

/** Parágrafos do HTML do editor, cada um com o seu texto normalizado. */
function paragrafosDoHtml(html: string): { xml: string; chave: string }[] {
  return (html.match(/<(p|div|li)\b[^>]*>[\s\S]*?<\/\1>/gi) || []).map((xml) => ({
    xml,
    chave: normalizarTexto(xml.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")),
  }));
}

/** O bloco está no texto? Basta o 1º parágrafo, sem depender de formatação. */
export function blocoNoTexto(html: string | null | undefined, b: BlocoRecomendacao): boolean {
  const chave = normalizarTexto(b.paragrafos[0]);
  return paragrafosDoHtml(html || "").some((p) => p.chave === chave);
}

/** Liga ou desliga um bloco. Desligar tira só os parágrafos que continuam
 *  iguais ao padrão: o que o técnico reescreveu fica. */
export function alternarBloco(html: string | null | undefined, b: BlocoRecomendacao, ligar: boolean): string {
  const atual = html || "";
  if (ligar) return blocoNoTexto(atual, b) ? atual : atual + htmlDoBloco(b);
  const fora = new Set(b.paragrafos.map((p) => normalizarTexto(p)));
  return paragrafosDoHtml(atual).reduce((h, p) => (fora.has(p.chave) ? h.replace(p.xml, "") : h), atual);
}

/** Texto inicial das Recomendações para a origem da água do tanque. */
export function recomendacoesIniciais(origem: string | null | undefined): string {
  return BLOCOS_RECOMENDACAO.filter((b) => b.padrao || (origem && b.origem === origem)).map(htmlDoBloco).join("");
}
