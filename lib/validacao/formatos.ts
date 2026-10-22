/** Formatos de documento/contato. CNPJ e telefone moram em lib/mascaras.ts
 * (junto das máscaras de digitação) e são reexportados aqui, para o resto do
 * sistema importar tudo de lib/validacao. */
import { cnpjValido, somenteDigitos, telefoneValido } from "../mascaras";

export { cnpjValido, somenteDigitos, telefoneValido };

/** CNPJ é gravado só com os 14 dígitos (é assim que já está no banco). */
export function normalizarCnpj(valor: string | null | undefined): string {
  return somenteDigitos(valor || "");
}

/** E-mail comparado/gravado sem espaços e em minúsculas. */
export function normalizarEmail(valor: string | null | undefined): string {
  return (valor || "").trim().toLowerCase();
}

/** Formato usual nome@dominio.tld — sem espaço, sem ".." e com TLD ≥ 2 letras. */
export function emailValido(valor: string | null | undefined): boolean {
  const v = (valor || "").trim();
  if (!v || v.includes("..")) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(v);
}

/** Data ISO (AAAA-MM-DD) que existe no calendário. */
export function dataIsoValida(valor: string | null | undefined): boolean {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = new Date(valor + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** "Hoje" no fuso de Brasília (AAAA-MM-DD) — o servidor roda em UTC e, à
 * noite, já estaria no dia seguinte. */
export function hojeBrasil(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}
