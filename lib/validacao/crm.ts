/** Follow-up como CRM: listas fixas, quem pode usar e validação dos dados da
 * oportunidade, do resultado e das atividades. Puro (sem Supabase). */

export type ResultadoProcesso = "aberta" | "ganha" | "perdida";

export const ROTULO_RESULTADO: Record<ResultadoProcesso, string> = { aberta: "Em aberto", ganha: "Ganha", perdida: "Perdida" };

export const ORIGENS = [
  { valor: "licitacao", rotulo: "Licitação" },
  { valor: "indicacao", rotulo: "Indicação" },
  { valor: "recorrencia", rotulo: "Cliente recorrente" },
  { valor: "site", rotulo: "Site / redes sociais" },
  { valor: "prospeccao", rotulo: "Prospecção ativa" },
  { valor: "outro", rotulo: "Outro" },
] as const;
export type Origem = (typeof ORIGENS)[number]["valor"];

export const MOTIVOS_PERDA = [
  { valor: "preco", rotulo: "Preço" },
  { valor: "prazo", rotulo: "Prazo" },
  { valor: "concorrente", rotulo: "Escolheu concorrente" },
  { valor: "sem_orcamento", rotulo: "Sem orçamento" },
  { valor: "licitacao", rotulo: "Licitação perdida ou cancelada" },
  { valor: "desistencia", rotulo: "Cliente desistiu" },
  { valor: "sem_retorno", rotulo: "Sem retorno do cliente" },
  { valor: "outro", rotulo: "Outro" },
] as const;
export type MotivoPerda = (typeof MOTIVOS_PERDA)[number]["valor"];

export const TIPOS_ATIVIDADE = [
  { valor: "ligacao", rotulo: "Ligação", icone: "📞" },
  { valor: "email", rotulo: "E-mail", icone: "✉️" },
  { valor: "whatsapp", rotulo: "WhatsApp", icone: "💬" },
  { valor: "reuniao", rotulo: "Reunião", icone: "👥" },
  { valor: "visita", rotulo: "Visita", icone: "📍" },
  { valor: "nota", rotulo: "Anotação", icone: "📝" },
] as const;
export type TipoAtividade = (typeof TIPOS_ATIVIDADE)[number]["valor"];

/** Perfis que usam o Follow-up (aba, leitura e edição). */
export const PERFIS_CRM = ["admin", "gerencia", "comercial"];
export const podeUsarCrm = (perfil: string | null | undefined) => !!perfil && PERFIS_CRM.includes(perfil);

export const rotuloOrigem = (v: string | null | undefined) => ORIGENS.find((o) => o.valor === v)?.rotulo || null;
export const rotuloMotivoPerda = (v: string | null | undefined) => MOTIVOS_PERDA.find((o) => o.valor === v)?.rotulo || null;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (s: unknown): s is string => typeof s === "string" && DIA.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const VALOR_MAXIMO = 1e12;
export const TAM_TEXTO_ACAO = 200;
export const TAM_DESCRICAO_ATIVIDADE = 2000;

/** "R$ 12.500,00", "12500,5", "12.500" → 12500.5. Vazio = null; inválido = NaN. */
export function lerValorMonetario(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let s = String(v).replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export interface DadosOportunidade {
  titulo?: string;
  orgaoId?: string;
  contatoId?: string | null;
  valor?: number | null;
  origem?: string | null;
  responsavelId?: string | null;
  previsaoFechamento?: string | null;
  proximaAcao?: string | null;
  proximaAcaoEm?: string | null;
}

/** Valida e normaliza os campos enviados (só os presentes). Devolve as
 *  colunas do banco ou o primeiro erro. */
export function validarOportunidade(b: Record<string, unknown>, hoje: string): { colunas: Record<string, unknown> } | { erro: string } {
  const c: Record<string, unknown> = {};
  const tem = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (tem("titulo")) {
    const t = texto(b.titulo);
    if (!t) return { erro: "Informe o título da oportunidade." };
    if (t.length > 200) return { erro: "Título muito longo (máximo 200 caracteres)." };
    c.titulo = t;
  }
  if (tem("orgaoId")) {
    const o = texto(b.orgaoId);
    if (!o) return { erro: "Selecione o cliente da oportunidade." };
    c.orgao_id = o;
  }
  if (tem("contatoId")) c.contato_id = texto(b.contatoId) || null;
  if (tem("valor")) {
    const v = lerValorMonetario(b.valor);
    if (v !== null && (Number.isNaN(v) || v < 0 || v > VALOR_MAXIMO)) return { erro: "Valor inválido." };
    c.valor = v;
  }
  if (tem("origem")) {
    const o = texto(b.origem);
    if (o && !ORIGENS.some((x) => x.valor === o)) return { erro: "Origem inválida." };
    c.origem = o || null;
  }
  if (tem("responsavelId")) c.responsavel_id = texto(b.responsavelId) || null;
  if (tem("previsaoFechamento")) {
    const d = texto(b.previsaoFechamento);
    if (d && !diaValido(d)) return { erro: "Previsão de fechamento inválida." };
    c.previsao_fechamento = d || null;
  }
  if (tem("proximaAcao") || tem("proximaAcaoEm")) {
    const a = texto(b.proximaAcao), d = texto(b.proximaAcaoEm);
    if (a.length > TAM_TEXTO_ACAO) return { erro: `Próxima ação muito longa (máximo ${TAM_TEXTO_ACAO} caracteres).` };
    if (d && !diaValido(d)) return { erro: "Data da próxima ação inválida." };
    if (a && !d) return { erro: "Informe a data da próxima ação." };
    if (d && !a) return { erro: "Descreva a próxima ação." };
    if (d && d < hoje) return { erro: "A próxima ação não pode ter data no passado." };
    c.proxima_acao = a || null;
    c.proxima_acao_em = d || null;
  }
  return { colunas: c };
}

/** Resultado (ganha/perdida/reaberta). Perdida exige o motivo. */
export function validarResultado(b: Record<string, unknown>, hoje: string): { resultado: ResultadoProcesso; data: string | null; motivo: string | null; detalhe: string | null } | { erro: string } {
  const r = b.resultado;
  if (r !== "aberta" && r !== "ganha" && r !== "perdida") return { erro: "Resultado inválido." };
  if (r === "aberta") return { resultado: "aberta", data: null, motivo: null, detalhe: null };
  const data = typeof b.data === "string" ? b.data : "";
  if (!diaValido(data)) return { erro: "Informe a data do resultado." };
  if (data > hoje) return { erro: "A data do resultado não pode ser futura." };
  if (r === "ganha") return { resultado: "ganha", data, motivo: null, detalhe: null };
  const motivo = typeof b.motivo === "string" ? b.motivo : "";
  if (!MOTIVOS_PERDA.some((m) => m.valor === motivo)) return { erro: "Escolha o motivo da perda." };
  const detalhe = typeof b.detalhe === "string" ? b.detalhe.trim().slice(0, 500) : "";
  if (motivo === "outro" && !detalhe) return { erro: "Descreva o motivo da perda." };
  return { resultado: "perdida", data, motivo, detalhe: detalhe || null };
}

export function validarAtividade(b: Record<string, unknown>, hoje: string): { tipo: TipoAtividade; data: string; descricao: string } | { erro: string } {
  const tipo = b.tipo;
  if (!TIPOS_ATIVIDADE.some((t) => t.valor === tipo)) return { erro: "Tipo de atividade inválido." };
  const data = typeof b.data === "string" ? b.data : "";
  if (!diaValido(data)) return { erro: "Informe a data da atividade." };
  if (data > hoje) return { erro: "A atividade não pode ter data futura — use a próxima ação para o que ainda vai acontecer." };
  const descricao = typeof b.descricao === "string" ? b.descricao.trim() : "";
  if (!descricao) return { erro: "Descreva a atividade." };
  if (descricao.length > TAM_DESCRICAO_ATIVIDADE) return { erro: `Descrição muito longa (máximo ${TAM_DESCRICAO_ATIVIDADE} caracteres).` };
  return { tipo: tipo as TipoAtividade, data, descricao };
}

/** Situação da próxima ação de uma oportunidade aberta. */
export type SituacaoAcao = "atrasada" | "hoje" | "futura" | "sem_acao";
export function situacaoProximaAcao(p: { resultado?: string | null; proxima_acao_em?: string | null }, hoje: string): SituacaoAcao | null {
  if ((p.resultado || "aberta") !== "aberta") return null;
  const d = p.proxima_acao_em;
  if (!d) return "sem_acao";
  return d < hoje ? "atrasada" : d === hoje ? "hoje" : "futura";
}
