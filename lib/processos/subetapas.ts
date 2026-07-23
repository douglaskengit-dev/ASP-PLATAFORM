/**
 * Subetapas de revisão/aprovação dentro das macrofases "Relatório" e
 * "Relatório de Limpeza" (ETAPAS_FLUXO).
 *
 * Sequência normal: envio → revisão → aprovação → aprovado.
 * Se a Revisão reprovar, o grupo vai para "reenvio_necessario" (dispara
 * notificação) até ser reenviado, o que volta o estado para "envio".
 *
 * Ao chegar em "aprovado", o processo avança sozinho para a próxima
 * macrofase (ver app/api/processos/[id]/subetapa/route.ts).
 */
export type SubetapaChave = "envio" | "revisao" | "reenvio_necessario" | "aprovacao" | "aprovado";

export interface SubetapaDef {
  chave: SubetapaChave;
  nome: string;
}

/** Passos "normais" da sequência — não inclui reenvio_necessario, que é um
 * desvio condicional exibido só quando ativo. */
export const SUBETAPAS: SubetapaDef[] = [
  { chave: "envio", nome: "Envio p/ revisão" },
  { chave: "revisao", nome: "Revisão" },
  { chave: "aprovacao", nome: "Aprovação" },
  { chave: "aprovado", nome: "Aprovado" },
];

export function nomeSubetapa(chave: SubetapaChave | null | undefined): string {
  if (!chave) return "Não iniciado";
  if (chave === "reenvio_necessario") return "Reenvio necessário";
  return SUBETAPAS.find((s) => s.chave === chave)?.nome || "—";
}

/** Nomes das macrofases (ETAPAS_FLUXO) que têm subetapas de revisão. */
const NOMES_ETAPAS_COM_SUBETAPAS = new Set(["Relatório", "Relatório de Limpeza"]);

export function etapaTemSubetapas(nomeEtapa: string | undefined): boolean {
  return !!nomeEtapa && NOMES_ETAPAS_COM_SUBETAPAS.has(nomeEtapa);
}

export interface HistoricoSubetapa {
  de: SubetapaChave | null;
  para: SubetapaChave;
  responsavel_id: string;
  responsavel_nome: string;
  em: string;
  motivo?: string;
}

export interface GrupoSubetapas {
  atual: SubetapaChave | null;
  historico: HistoricoSubetapa[];
}

/** subetapas do processo, indexado pelo número da macrofase (etapa) —
 * assim "Relatório" e "Relatório de Limpeza" têm progresso independente. */
export type SubetapasProcesso = Record<string, GrupoSubetapas>;

export const GRUPO_VAZIO: GrupoSubetapas = { atual: null, historico: [] };

export type AcaoSubetapa = "enviar" | "revisar_aprovar" | "revisar_reprovar" | "aprovar";

const PERMISSAO_ACAO: Record<AcaoSubetapa, Array<"admin" | "editor">> = {
  enviar: ["admin", "editor"],
  revisar_aprovar: ["admin"],
  revisar_reprovar: ["admin"],
  aprovar: ["admin"],
};

export function podeExecutarAcao(perfil: "admin" | "editor" | "visualizador", acao: AcaoSubetapa): boolean {
  return perfil !== "visualizador" && PERMISSAO_ACAO[acao].includes(perfil);
}

/** Valida se a ação é aplicável ao estado atual do grupo; retorna o novo
 * estado, ou null se a transição não é permitida a partir desse estado. */
export function transicaoValida(atual: SubetapaChave | null, acao: AcaoSubetapa): SubetapaChave | null {
  switch (acao) {
    // "enviar" vale tanto do zero (ainda não iniciado) quanto para reenviar
    // depois de um "reenvio_necessario".
    case "enviar":
      return atual === null || atual === "reenvio_necessario" ? "envio" : null;
    case "revisar_aprovar":
      return atual === "envio" ? "aprovacao" : null;
    case "revisar_reprovar":
      return atual === "envio" ? "reenvio_necessario" : null;
    case "aprovar":
      return atual === "aprovacao" ? "aprovado" : null;
    default:
      return null;
  }
}
