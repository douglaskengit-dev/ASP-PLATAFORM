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
  /** Procedimento do Catálogo; vazio = "Outros" (título livre). */
  procedimentoId?: string | null;
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
  if (tem("procedimentoId")) c.procedimento_id = texto(b.procedimentoId) || null;
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
  if (tem("temperatura")) {
    const t = texto(b.temperatura);
    if (t && !ehTemperatura(t)) return { erro: "Temperatura inválida." };
    c.temperatura = t || null;
  }
  if (tem("probabilidade")) {
    const bruto = texto(b.probabilidade).replace("%", "").replace(",", ".").trim();
    if (!bruto) c.probabilidade = null;
    else {
      const n = Number(bruto);
      if (!Number.isFinite(n) || n < 0 || n > 100) return { erro: "Probabilidade inválida: use de 0 a 100%." };
      c.probabilidade = Math.round(n * 100) / 100;
    }
  }
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

/** Arquivo da proposta: extensões aceitas e tamanho máximo. */
export const EXTENSOES_PROPOSTA = ["pdf", "docx", "doc", "xlsx", "xls"] as const;
export const TAM_MAX_PROPOSTA = 20 * 1024 * 1024;
export const TAM_OBS_PROPOSTA = 2000;

/** Nova versão da proposta: data de envio (até hoje), valor e observação
 *  opcionais. O arquivo é conferido à parte (validarArquivoProposta). */
export function validarProposta(b: Record<string, unknown>, hoje: string): { data: string; validade: string | null; valor: number | null; observacao: string | null } | { erro: string } {
  const data = typeof b.data === "string" ? b.data : "";
  if (!diaValido(data)) return { erro: "Informe a data da proposta." };
  if (data > hoje) return { erro: "A data da proposta não pode ser futura." };
  const validade = typeof b.validade === "string" && b.validade.trim() ? b.validade.trim() : null;
  if (validade !== null && !diaValido(validade)) return { erro: "Validade da proposta inválida." };
  if (validade !== null && validade < data) return { erro: "A validade não pode ser antes do envio da proposta." };
  const valor = lerValorMonetario(b.valor);
  if (valor !== null && (Number.isNaN(valor) || valor < 0 || valor > VALOR_MAXIMO)) return { erro: "Valor da proposta inválido." };
  const observacao = typeof b.observacao === "string" ? b.observacao.trim() : "";
  if (observacao.length > TAM_OBS_PROPOSTA) return { erro: `Observação muito longa (máximo ${TAM_OBS_PROPOSTA} caracteres).` };
  if (valor === null && !observacao && !b.temArquivo) return { erro: "Informe o valor, anexe o arquivo ou escreva uma observação." };
  return { data, validade, valor, observacao: observacao || null };
}

/** Previsão de Vendas Ponderada: valor ponderado = valor × probabilidade da
 *  temperatura. A temperatura é a escolhida na ficha ou, sem escolha, a
 *  automática (pela proposta e pela etapa). */
export const TEMPERATURAS = [
  { valor: "frio", rotulo: "Frio", pct: 0.15, icone: "❄️", descricao: "proposta enviada, sem retorno" },
  { valor: "morno", rotulo: "Morno", pct: 0.5, icone: "🌤️", descricao: "em negociação, dúvidas respondidas" },
  { valor: "quente", rotulo: "Quente", pct: 0.85, icone: "🔥", descricao: "aprovação verbal ou proposta aceita, aguardando assinatura" },
] as const;
export type Temperatura = (typeof TEMPERATURAS)[number]["valor"];
/** Índices em ETAPAS_FLUXO (lib/processos/etapas.ts). */
export const ETAPA_PROPOSTA = 3;
export const ETAPA_NEGOCIACAO = 4;

export function ehTemperatura(v: unknown): v is Temperatura {
  return TEMPERATURAS.some((x) => x.valor === v);
}
export const infoTemperatura = (t: Temperatura) => TEMPERATURAS.find((x) => x.valor === t)!;

/** Automática: proposta aceita → quente; Negociação (ou depois) → morno;
 *  Proposta, ou qualquer etapa com proposta registrada → frio; antes disso,
 *  nula (fora da previsão). */
export function temperaturaAutomatica(o: { etapa?: number | null; propostaSituacao?: string | null }): Temperatura | null {
  if (o.propostaSituacao === "aceita") return "quente";
  const etapa = Number(o.etapa) || 0;
  if (etapa >= ETAPA_NEGOCIACAO) return "morno";
  if (etapa === ETAPA_PROPOSTA || o.propostaSituacao) return "frio";
  return null;
}

/** Faixa de um percentual próprio: abaixo de 35% Frio, abaixo de 70% Morno,
 *  daí para cima Quente. */
export function faixaTemperatura(pct: number): Temperatura {
  return pct < 0.35 ? "frio" : pct < 0.7 ? "morno" : "quente";
}

/** Probabilidade gravada (0 a 100) → fração; nula se ausente ou inválida. */
export function probabilidadePropria(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
}

/** O que vale para a previsão, nesta ordem: percentual próprio da ficha;
 *  temperatura escolhida na ficha; automática. pct = fração (0,15 = 15%). */
export function temperaturaDe(o: { temperatura?: string | null; probabilidade?: number | string | null; etapa?: number | null; propostaSituacao?: string | null }):
  { temperatura: Temperatura | null; pct: number | null; automatica: boolean; percentualProprio: boolean } {
  const propria = probabilidadePropria(o.probabilidade);
  if (propria != null) return { temperatura: faixaTemperatura(propria), pct: propria, automatica: false, percentualProprio: true };
  const t = ehTemperatura(o.temperatura) ? o.temperatura : temperaturaAutomatica(o);
  return { temperatura: t, pct: t ? infoTemperatura(t).pct : null, automatica: !ehTemperatura(o.temperatura), percentualProprio: false };
}

/** Valor × probabilidade (fração, ou a da temperatura); nulo sem valor ou sem probabilidade. */
export function valorPonderado(valor: number | null | undefined, p: Temperatura | number | null): number | null {
  const pct = typeof p === "number" ? p : p ? infoTemperatura(p).pct : null;
  if (valor == null || !Number.isFinite(Number(valor)) || pct == null) return null;
  return Math.round(Number(valor) * pct * 100) / 100;
}

/** "15%" ou "72,5%". */
export const rotuloPct = (pct: number) => `${(Math.round(pct * 1000) / 10).toLocaleString("pt-BR")}%`;

/** Situação de uma versão da proposta. "vencida" e "substituida" não são
 *  gravadas: saem da validade e de existir versão mais nova. */
export const SITUACOES_PROPOSTA = [
  { valor: "enviada", rotulo: "Enviada" },
  { valor: "aceita", rotulo: "Aceita" },
  { valor: "recusada", rotulo: "Recusada" },
] as const;
export type SituacaoProposta = (typeof SITUACOES_PROPOSTA)[number]["valor"];
export type SituacaoPropostaVista = SituacaoProposta | "vencida" | "substituida";

export function ehSituacaoProposta(v: unknown): v is SituacaoProposta {
  return SITUACOES_PROPOSTA.some((x) => x.valor === v);
}

/** O que a tela mostra para a versão: aceita/recusada como gravado; enviada
 *  vira "substituida" se há versão mais nova e "vencida" se a validade passou. */
export function situacaoPropostaVista(
  p: { situacao?: string | null; validade?: string | null },
  maisNova: boolean,
  hoje: string,
): SituacaoPropostaVista {
  const s = ehSituacaoProposta(p.situacao) ? p.situacao : "enviada";
  if (s !== "enviada") return s;
  if (!maisNova) return "substituida";
  if (p.validade && p.validade.slice(0, 10) < hoje) return "vencida";
  return "enviada";
}

/** Dias até a validade (negativo = vencida há N dias); nulo sem validade. */
export function diasParaValidade(validade: string | null | undefined, hoje: string): number | null {
  if (!validade || !diaValido(validade.slice(0, 10))) return null;
  const a = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10));
  const v = Date.UTC(+validade.slice(0, 4), +validade.slice(5, 7) - 1, +validade.slice(8, 10));
  return Math.round((v - a) / 86400000);
}

export function validarArquivoProposta(nome: string, tamanho: number): string | null {
  const ext = (nome.split(".").pop() || "").toLowerCase();
  if (!(EXTENSOES_PROPOSTA as readonly string[]).includes(ext)) return "Anexe a proposta em PDF, Word ou Excel.";
  if (tamanho > TAM_MAX_PROPOSTA) return "Arquivo muito grande (máximo 20 MB).";
  if (tamanho === 0) return "O arquivo está vazio.";
  return null;
}

/** Resumo comercial do cliente (ficha 360°): oportunidades em aberto, ganhas
 *  e perdidas, com valores, e a taxa de ganho (ganhas / fechadas). */
export function resumoComercialCliente(ops: { resultado?: string | null; valor?: number | null }[]) {
  const soma = (l: typeof ops) => l.reduce((a, o) => a + (Number(o.valor) || 0), 0);
  const abertas = ops.filter((o) => (o.resultado || "aberta") === "aberta");
  const ganhas = ops.filter((o) => o.resultado === "ganha");
  const perdidas = ops.filter((o) => o.resultado === "perdida");
  const fechadas = ganhas.length + perdidas.length;
  return {
    abertas: abertas.length, valorAberto: soma(abertas),
    ganhas: ganhas.length, valorGanho: soma(ganhas),
    perdidas: perdidas.length,
    taxaGanho: fechadas ? ganhas.length / fechadas : null,
  };
}

/** Situação da próxima ação de uma oportunidade aberta. */
export type SituacaoAcao = "atrasada" | "hoje" | "futura" | "sem_acao";
export function situacaoProximaAcao(p: { resultado?: string | null; proxima_acao_em?: string | null }, hoje: string): SituacaoAcao | null {
  if ((p.resultado || "aberta") !== "aberta") return null;
  const d = p.proxima_acao_em;
  if (!d) return "sem_acao";
  return d < hoje ? "atrasada" : d === hoje ? "hoje" : "futura";
}
