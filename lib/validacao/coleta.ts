/** Regras da Fase 3 — o REGISTRO da coleta (gp_coletas) de uma OS. Puras: a
 * página chama com o que já tem; a API (lib/asp/coleta-api.ts) com o que
 * leu do banco. Os valores da medição ficam em ./medicao.ts.
 *
 *   ⛔ data da coleta (obrigatória, não pode ser futura — fuso de Brasília)
 *      · medição: responsável escolhido entre os usuários ATIVOS · medição
 *      idêntica já salva nesta OS · anexo: descrição obrigatória · PDF de
 *      verdade (começa com "%PDF-"), até 20 MB · o mesmo arquivo já anexado
 *      nesta OS
 *   ⚠️ data da coleta diferente da data do agendamento da inspeção
 *
 * Tipos: 'sedimento' = medição do medidor (dados preenchidos, PDF opcional);
 * 'anexo' = só um PDF, com descrição. */
import { addAviso, addErro, mesclar, novoResultado, ResultadoValidacao } from "./resultado";
import { dataIsoValida } from "./formatos";
import { normalizarEspacos } from "./texto";
import { chaveMedicao, EstadoMedidor, medicaoPreenchida, ROTULOS_MEDICAO, validarMedicao } from "./medicao";
import type { Tanque } from "../asp/tanque";

export type TipoColeta = "sedimento" | "anexo";

/** Tamanho máximo do PDF anexado. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;

export interface DadosColeta {
  /** Edição: a própria coleta (fica fora da checagem de duplicidade). */
  id?: string | null;
  tipo: TipoColeta;
  dataColeta?: string | null;
  responsavelId?: string | null;
  descricao?: string | null;
  /** Estado do medidor (só 'sedimento'). */
  dados?: EstadoMedidor | null;
  /** SHA-256 (hex) do PDF que vai junto, se houver. */
  arquivoHash?: string | null;
  /** Erro do PDF (validarPdf), se houver. */
  erroArquivo?: string | null;
  /** Anexo novo: o PDF é obrigatório. */
  exigirArquivo?: boolean;
}

/** Coleta ativa (não excluída) já gravada nesta OS. */
export interface ColetaRef {
  id: string;
  tipo: string;
  /** chaveMedicao(dados) — null para anexo. */
  chave?: string | null;
  arquivoHash?: string | null;
  dataColeta?: string | null;
  descricao?: string | null;
  criadoEm?: string | null;
}

export interface ContextoColeta {
  /** AAAA-MM-DD no fuso de Brasília. */
  hoje: string;
  /** Data da visita do agendamento ativo de inspeção da OS (se houver). */
  dataAgendamento?: string | null;
  /** Ids dos usuários ativos. undefined = não checado. */
  usuariosAtivos?: string[];
  /** Coletas ativas da OS. */
  coletas?: ColetaRef[];
  tanque?: Tanque | null;
}

export const ROTULOS_COLETA: Record<string, string> = {
  dataColeta: "Data da coleta",
  responsavelId: "Responsável pela medição",
  descricao: "Descrição",
  arquivo: "Arquivo",
  ...ROTULOS_MEDICAO,
};

function dataBr(iso?: string | null): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

/** "a medição de 12/10/2026" / "o anexo “Laudo” (12/10/2026)". */
export function descreverColeta(c: ColetaRef): string {
  const quando = dataBr(c.dataColeta) || dataBr(c.criadoEm || null);
  if (c.tipo === "anexo") return `o anexo “${c.descricao || "sem descrição"}”${quando ? ` (${quando})` : ""}`;
  return `a medição de ${quando || "data não informada"}`;
}

/** Bytes de um PDF de verdade: começa com "%PDF-" (o leitor aceita até 1 KB
 * de lixo antes) e cabe no limite. Devolve o erro, ou null. */
export function validarPdf(bytes: Uint8Array | null | undefined, tamanho?: number): string | null {
  const n = tamanho ?? bytes?.length ?? 0;
  if (!bytes || n === 0) return "O arquivo está vazio.";
  if (n > PDF_MAX_BYTES) return `O PDF tem ${(n / 1048576).toFixed(1).replace(".", ",")} MB — o limite é 20 MB.`;
  const alvo = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const fim = Math.min(bytes.length - alvo.length, 1024);
  for (let i = 0; i <= fim; i++) {
    if (alvo.every((b, k) => bytes[i + k] === b)) return null;
  }
  return "O arquivo não é um PDF válido (o conteúdo não começa com %PDF-). Exporte ou salve em PDF de novo.";
}

/** Coleta ativa da OS com a mesma medição, ou null. */
export function medicaoRepetida(dados: EstadoMedidor | null | undefined, ctx: Pick<ContextoColeta, "coletas">, excluirId?: string | null): ColetaRef | null {
  const k = chaveMedicao(dados);
  if (!k) return null;
  return (ctx.coletas || []).find((c) => c.id !== excluirId && c.chave === k) || null;
}

/** Coleta ativa da OS com o mesmo arquivo (SHA-256), ou null. */
export function arquivoRepetido(hash: string | null | undefined, ctx: Pick<ContextoColeta, "coletas">, excluirId?: string | null): ColetaRef | null {
  if (!hash) return null;
  return (ctx.coletas || []).find((c) => c.id !== excluirId && c.arquivoHash === hash) || null;
}

/** A data sugerida para a coleta: a do agendamento de inspeção (se já
 * passou) ou hoje. */
export function dataColetaSugerida(dataAgendamento: string | null | undefined, hoje: string): string {
  return dataAgendamento && dataIsoValida(dataAgendamento) && dataAgendamento <= hoje ? dataAgendamento : hoje;
}

export function validarColeta(d: DadosColeta, ctx: ContextoColeta): ResultadoValidacao {
  const r = novoResultado();

  const data = (d.dataColeta || "").trim();
  if (!data) addErro(r, "dataColeta", "Informe a data da coleta.");
  else if (!dataIsoValida(data)) addErro(r, "dataColeta", "Data inválida.");
  else if (data > ctx.hoje) addErro(r, "dataColeta", "A data da coleta não pode estar no futuro.");
  else if (ctx.dataAgendamento && dataIsoValida(ctx.dataAgendamento) && data !== ctx.dataAgendamento) {
    addAviso(r, "dataColeta", `Diferente da data do agendamento da inspeção (${dataBr(ctx.dataAgendamento)}).`);
  }

  if (d.erroArquivo) addErro(r, "arquivo", d.erroArquivo);
  else if (d.exigirArquivo && !d.arquivoHash) addErro(r, "arquivo", "Escolha o arquivo PDF.");
  const mesmoArquivo = arquivoRepetido(d.arquivoHash, ctx, d.id);
  if (mesmoArquivo) addErro(r, "arquivo", `Este mesmo arquivo já está anexado nesta OS (${descreverColeta(mesmoArquivo)}).`);

  if (d.tipo === "anexo") {
    if (!normalizarEspacos(d.descricao)) addErro(r, "descricao", "Descreva o anexo (ex.: “Laudo de espessura do fundo”).");
    return r;
  }

  const resp = (d.responsavelId || "").trim();
  if (!resp) addErro(r, "responsavelId", "Escolha o responsável pela medição.");
  else if (ctx.usuariosAtivos && !ctx.usuariosAtivos.includes(resp)) {
    addErro(r, "responsavelId", "O responsável escolhido não é um usuário ativo — escolha outro.");
  }

  const rm = validarMedicao(d.dados, { tanque: ctx.tanque });
  const igual = medicaoRepetida(d.dados, ctx, d.id);
  if (igual) addErro(r, "medicao", `Esta medição já está salva nesta OS (${descreverColeta(igual)}). Abra e edite a existente.`);
  return mesclar(r, rm);
}

/** Pode ser aprovada (valer para o relatório): medição preenchida e sem
 * erro nos valores. Anexo nunca. Devolve o motivo, ou null. */
export function motivoNaoAprovavel(c: { tipo?: string | null; dados?: EstadoMedidor | null }): string | null {
  if (c.tipo === "anexo") return "Anexo não pode ser aprovado — só uma medição do medidor vale para o relatório.";
  if (!medicaoPreenchida(c.dados)) return "A medição está vazia — não há o que aprovar.";
  const r = validarMedicao(c.dados);
  const erro = Object.values(r.erros).flat()[0];
  return erro ? `A medição tem erro: ${erro}` : null;
}
