/** Tipos e formatação comuns às telas do Follow-up (CRM). */
import type { ProcessoDocs } from "./DocumentosProcesso";

export interface Orgao { id: string; razao_social: string; tipo_ente?: string; cidade?: string; uf?: string }
export interface Usuario { id: string; nome: string; perfil: string }
export interface EventoHistorico {
  etapa?: number; nome?: string; data_autenticacao?: string; alterado_em?: string; alterado_por?: string;
  evento?: "resultado"; resultado?: "aberta" | "ganha" | "perdida"; anterior?: string; data?: string; motivo?: string | null;
  etapa_antiga?: number;
}

export interface Oportunidade extends ProcessoDocs {
  titulo: string;
  orgao: Orgao | null;
  data: string;
  atualizado_em: string;
  etapa: number;
  historico_etapas: EventoHistorico[];
  resultado: "aberta" | "ganha" | "perdida";
  resultado_em: string | null;
  motivo_perda: string | null;
  motivo_perda_detalhe: string | null;
  valor: number | null;
  origem: string | null;
  responsavel_id: string | null;
  contato_id: string | null;
  previsao_fechamento: string | null;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  migrado: boolean;
  criado_por: { id: string; nome: string } | null;
}

const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtMoedaCentavos = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const moeda = (v: number | null | undefined, centavos = false) => (v == null ? "—" : (centavos ? fmtMoedaCentavos : fmtMoeda).format(v));
/** "AAAA-MM-DD" → "dd/mm/aaaa". */
export const dataBr = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
/** "AAAA-MM-DD" → "dd/mm". */
export const dataCurta = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
export const iniciais = (nome: string | null | undefined) =>
  (nome || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join("") || "?";

/** Valor digitado ("12.500,00") a partir do número. */
export const valorParaCampo = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
