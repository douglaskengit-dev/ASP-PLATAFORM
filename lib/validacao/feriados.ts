/** Calendário: fim de semana e feriados NACIONAIS (fixos + os que dependem
 * da Páscoa). Estaduais/municipais ficam de fora — variam por obra. Serve
 * para AVISAR ao agendar uma visita, nunca para bloquear.
 *
 * Datas sempre em ISO (AAAA-MM-DD) e calculadas em UTC, para o dia não
 * "andar" com o fuso do servidor/navegador. */

const FIXOS: [string, string][] = [
  ["01-01", "Confraternização Universal"],
  ["04-21", "Tiradentes"],
  ["05-01", "Dia do Trabalho"],
  ["09-07", "Independência do Brasil"],
  ["10-12", "Nossa Senhora Aparecida"],
  ["11-02", "Finados"],
  ["11-15", "Proclamação da República"],
  ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"], // nacional desde 2024 (Lei 14.759/2023)
  ["12-25", "Natal"],
];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Soma dias a uma data ISO. */
export function somarDias(dataIso: string, dias: number): string {
  const d = new Date(dataIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Feriados nacionais do ano, em ordem de data. Carnaval e Corpus Christi
 * são ponto facultativo na lei, mas na prática param as obras — entram. */
export function feriadosNacionais(ano: number): { data: string; nome: string }[] {
  const p = pascoa(ano);
  const lista = [
    ...FIXOS.map(([md, nome]) => ({ data: `${ano}-${md}`, nome })),
    { data: somarDias(p, -48), nome: "Carnaval (segunda-feira)" },
    { data: somarDias(p, -47), nome: "Carnaval (terça-feira)" },
    { data: somarDias(p, -2), nome: "Sexta-feira Santa" },
    { data: somarDias(p, 60), nome: "Corpus Christi" },
  ];
  return lista.sort((a, b) => a.data.localeCompare(b.data));
}

/** Nome do feriado nacional na data, ou null. */
export function feriadoNacional(dataIso: string | null | undefined): string | null {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return null;
  return feriadosNacionais(Number(dataIso.slice(0, 4))).find((f) => f.data === dataIso)?.nome || null;
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(dataIso: string): number {
  return new Date(dataIso + "T00:00:00Z").getUTCDay();
}

/** "sábado"/"domingo" se cair no fim de semana; null nos dias úteis. */
export function fimDeSemana(dataIso: string | null | undefined): string | null {
  if (!dataIso || !/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return null;
  const d = diaDaSemana(dataIso);
  return d === 6 ? "sábado" : d === 0 ? "domingo" : null;
}
