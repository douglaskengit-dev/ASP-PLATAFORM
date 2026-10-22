/** Período de um agendamento (Fase 6). A execução pode durar vários dias:
 * data_visita = início, data_fim = último dia (null = um dia só). A inspeção
 * e o "a definir" não têm período. Puro (navegador + API); datas em ISO
 * (AAAA-MM-DD), contadas em UTC para o dia não "andar" com o fuso. */
import { feriadoNacional, fimDeSemana, somarDias } from "./feriados";

export interface Periodo {
  inicio: string;
  fim: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Período de um agendamento gravado/digitado; null sem data (a definir). */
export function periodoDe(a: { data_visita?: string | null; data_fim?: string | null } | null | undefined): Periodo | null {
  const inicio = (a?.data_visita || "").slice(0, 10);
  if (!ISO.test(inicio)) return null;
  const f = (a?.data_fim || "").slice(0, 10);
  return { inicio, fim: ISO.test(f) && f > inicio ? f : inicio };
}

/** Dias corridos do período (início e fim inclusos). */
export function duracaoDias(p: Periodo): number {
  return Math.round((Date.parse(p.fim + "T00:00:00Z") - Date.parse(p.inicio + "T00:00:00Z")) / 86400000) + 1;
}

/** Cada dia do período, em ordem. `limite` evita laço gigante com data errada. */
export function diasDoPeriodo(p: Periodo, limite = 400): string[] {
  const dias: string[] = [];
  for (let d = p.inicio; d <= p.fim && dias.length < limite; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

export function periodosSobrepoem(a: Periodo, b: Periodo): boolean {
  return a.inicio <= b.fim && b.inicio <= a.fim;
}

/** Dias em comum entre dois períodos (vazio se não se cruzam). */
export function intersecao(a: Periodo, b: Periodo): Periodo | null {
  if (!periodosSobrepoem(a, b)) return null;
  return { inicio: a.inicio > b.inicio ? a.inicio : b.inicio, fim: a.fim < b.fim ? a.fim : b.fim };
}

export function contemDia(p: Periodo, dia: string): boolean {
  return p.inicio <= dia && dia <= p.fim;
}

/** "05/11" ou "05/11 a 07/11". */
export function textoPeriodo(p: Periodo | null | undefined): string {
  if (!p) return "";
  const c = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return p.inicio === p.fim ? c(p.inicio) : `${c(p.inicio)} a ${c(p.fim)}`;
}

/** "05/11/2026" ou "05/11 a 07/11/2026" (anos diferentes: os dois por extenso). */
export function textoPeriodoLongo(p: Periodo | null | undefined): string {
  if (!p) return "";
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  if (p.inicio === p.fim) return br(p.inicio);
  return p.inicio.slice(0, 4) === p.fim.slice(0, 4)
    ? `${br(p.inicio).slice(0, 5)} a ${br(p.fim)}`
    : `${br(p.inicio)} a ${br(p.fim)}`;
}

/** Fim de semana ou feriado nacional: "sábado", "feriado — Finados"; null em dia útil. */
export function diaNaoUtil(dia: string): string | null {
  const fer = feriadoNacional(dia);
  if (fer) return `feriado — ${fer}`;
  return fimDeSemana(dia);
}

/** Dias do período que caem em fim de semana ou feriado nacional. */
export function diasNaoUteis(p: Periodo): { dia: string; motivo: string }[] {
  return diasDoPeriodo(p).flatMap((dia) => {
    const motivo = diaNaoUtil(dia);
    return motivo ? [{ dia, motivo }] : [];
  });
}
