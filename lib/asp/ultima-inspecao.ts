/** "Última inspeção" — o histórico de inspeção que uma OS SEM inspeção usa
 * como referência (backlog). Puro: a rota /api/inspecoes/[id]/ultima-inspecao
 * lê do banco e chama `escolherUltimaInspecao`.
 *
 * Regra: entre as OSs ativas do MESMO cliente (todos os projetos ativos),
 * fora a própria, as que tiveram inspeção de fato (com inspeção e com
 * relatório de inspeção, medição aprovada ou visita de inspeção com data).
 * Se alguma tem a mesma identificação normalizada ("TQ-01" = "tq 01") é o
 * MESMO TANQUE — vale a mais recente delas; senão, a mais recente do
 * cliente. Mais recente = maior data entre o relatório de inspeção
 * (assinado/avaliado/enviado), a medição aprovada e a visita de inspeção. */
import { normalizarIdentificacaoOS } from "../validacao/ordemServico";

export interface RelInspecaoRef {
  id: string;
  versao: number;
  status: string;
  enviado_em?: string | null;
  avaliado_em?: string | null;
  assinado_em?: string | null;
  assinado_path?: string | null;
}
export interface ColetaRef {
  id: string;
  tipo: string;
  aprovada_em?: string | null;
  data_coleta?: string | null;
  pdf_path?: string | null;
}
export interface CandidataInspecao {
  id: string;
  identificacao: string;
  comInspecao: boolean;
  projetoId: string;
  projetoCodigo: string;
  tanque?: unknown;
  /** Relatórios de INSPEÇÃO não excluídos. */
  relatorios: RelInspecaoRef[];
  coletas: ColetaRef[];
  /** Agendamentos de INSPEÇÃO ativos (não substituídos). */
  visitas: { data_visita: string | null }[];
}

export interface UltimaInspecao {
  escopo: "tanque" | "cliente";
  os: { id: string; identificacao: string };
  projeto: { id: string; codigo: string };
  /** Dia (AAAA-MM-DD) da inspeção mais recente encontrada. */
  data: string | null;
  /** Última versão aprovada ou assinada do relatório de inspeção. */
  relatorio: { id: string; versao: number; status: string; href: string } | null;
  /** Medição aprovada (link para #coletas da OS de origem). */
  medicao: { id: string; data: string | null; href: string; pdf: string | null } | null;
  tanque: unknown;
}

const dia = (s: string | null | undefined) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const maior = (...xs: (string | null)[]) => xs.filter(Boolean).sort().pop() || null;

/** Relatório de inspeção que vale: o assinado de maior versão; senão o aprovado. */
export function relatorioValido(rels: RelInspecaoRef[]): RelInspecaoRef | null {
  const ok = rels.filter((r) => r.status === "assinado" || r.status === "aprovado")
    .sort((a, b) => (a.status === "assinado" ? 0 : 1) - (b.status === "assinado" ? 0 : 1) || b.versao - a.versao);
  return ok[0] || null;
}

/** Data da inspeção da OS (null = não houve inspeção registrada). */
export function dataDaInspecao(c: CandidataInspecao): string | null {
  const rels = c.relatorios.filter((r) => r.status !== "substituido");
  const med = c.coletas.filter((x) => x.tipo !== "anexo" && x.aprovada_em);
  return maior(
    ...rels.map((r) => maior(dia(r.assinado_em), dia(r.avaliado_em), dia(r.enviado_em))),
    ...med.map((m) => dia(m.data_coleta) || dia(m.aprovada_em)),
    ...c.visitas.map((v) => dia(v.data_visita)),
  );
}

export function escolherUltimaInspecao(
  identificacao: string,
  candidatas: CandidataInspecao[],
  excluirId?: string | null,
): UltimaInspecao | null {
  const comData = candidatas
    .filter((c) => c.id !== excluirId && c.comInspecao)
    .map((c) => ({ c, data: dataDaInspecao(c) }))
    .filter((x) => !!x.data)
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  if (!comData.length) return null;
  const chave = normalizarIdentificacaoOS(identificacao);
  const mesmoTanque = chave ? comData.filter((x) => normalizarIdentificacaoOS(x.c.identificacao) === chave) : [];
  const escolhida = (mesmoTanque[0] || comData[0]);
  const { c } = escolhida;
  const rel = relatorioValido(c.relatorios);
  const med = c.coletas.filter((x) => x.tipo !== "anexo" && x.aprovada_em)
    .sort((a, b) => (b.aprovada_em || "").localeCompare(a.aprovada_em || ""))[0] || null;
  return {
    escopo: mesmoTanque.length ? "tanque" : "cliente",
    os: { id: c.id, identificacao: c.identificacao },
    projeto: { id: c.projetoId, codigo: c.projetoCodigo },
    data: escolhida.data,
    relatorio: rel ? {
      id: rel.id, versao: rel.versao, status: rel.status,
      href: rel.status === "assinado" && rel.assinado_path ? `/api/relatorios/${rel.id}/download?arquivo=assinado` : `/api/relatorios/${rel.id}/download`,
    } : null,
    medicao: med ? {
      id: med.id, data: dia(med.data_coleta) || dia(med.aprovada_em), href: `/inspecoes/${c.id}#coletas`,
      pdf: med.pdf_path ? `/api/coletas/${med.id}/download` : null,
    } : null,
    tanque: c.tanque ?? null,
  };
}
