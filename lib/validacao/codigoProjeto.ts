/** Código do projeto no padrão NN/INICIAIS/AA (ex.: 37/MG/26).
 *
 *   NN        sequência do ANO, única entre todos os usuários (não reinicia
 *             por iniciais); zera a cada ano. Mínimo 2 dígitos.
 *   INICIAIS  de quem abre o projeto: 1ª letra do primeiro nome + 1ª letra
 *             do último sobrenome (gp_profiles.nome_completo).
 *   AA        ano (2 dígitos) da data de abertura.
 *
 * Comparação sempre pelo código normalizado (sem espaços, maiúsculo) — é o
 * mesmo critério do índice único do banco (migração 20261022100000). */
import { normalizarNome } from "./texto";

/** Remove todo espaço e põe em maiúsculas: " 37/mg/ 26" → "37/MG/26".
 * Serve também para pedido de compra e outros identificadores. */
export function normalizarCodigoProjeto(valor: string | null | undefined): string {
  return (valor || "").replace(/\s+/g, "").toUpperCase();
}

export const normalizarIdentificador = normalizarCodigoProjeto;

export interface CodigoProjeto {
  numero: number;
  iniciais: string;
  /** Ano com 2 dígitos ("26"). */
  ano: string;
}

/** Lê um código no padrão; aceita NN com 1 dígito (códigos antigos) para o
 * cálculo da sequência. null se não estiver no padrão. */
export function parseCodigoProjeto(valor: string | null | undefined): CodigoProjeto | null {
  const m = /^(\d{1,4})\/([A-Z]{2,3})\/(\d{2})$/.exec(normalizarCodigoProjeto(valor));
  return m ? { numero: Number(m[1]), iniciais: m[2], ano: m[3] } : null;
}

/** Padrão estrito usado no aviso: NN (≥ 2 dígitos) / 2 letras / AA. */
export function formatoCodigoValido(valor: string | null | undefined): boolean {
  return /^\d{2,4}\/[A-Z]{2}\/\d{2}$/.test(normalizarCodigoProjeto(valor));
}

/** Agnomes não contam como "último sobrenome" ("João Souza Filho" → JS). */
const AGNOMES = new Set(["filho", "filha", "junior", "jr", "neto", "neta", "sobrinho", "sobrinha", "segundo", "terceiro"]);

/** Iniciais: primeiro nome + último sobrenome, ignorando partículas
 * (de/da/dos…) e agnomes. "Michelle Gois" → MG; "Maria da Silva" → MS.
 * Nome de uma palavra só → as duas primeiras letras. Vazio → "". */
export function iniciaisDoNome(nome: string | null | undefined): string {
  const partes = normalizarNome(nome).split(" ").filter((p) => p && !AGNOMES.has(p) && /[a-z]/.test(p));
  if (!partes.length) return "";
  if (partes.length === 1) return partes[0].replace(/[^a-z]/g, "").slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** "2026-10-21" → "26". */
export function anoDoCodigo(dataIso: string): string {
  return (dataIso || "").slice(2, 4);
}

export function montarCodigo(numero: number, iniciais: string, ano: string): string {
  return `${String(numero).padStart(2, "0")}/${iniciais}/${ano}`;
}

/** Próximo código: maior NN entre os códigos do mesmo ano (de qualquer
 * usuário, inclusive na lixeira — um número não volta a ser usado) + 1. */
export function proximoCodigo(
  codigosExistentes: (string | null | undefined)[],
  iniciais: string,
  dataAbertura: string
): string {
  const ano = anoDoCodigo(dataAbertura);
  const maior = codigosExistentes.reduce((max, c) => {
    const p = parseCodigoProjeto(c);
    return p && p.ano === ano && p.numero > max ? p.numero : max;
  }, 0);
  return montarCodigo(maior + 1, iniciais || "XX", ano);
}
