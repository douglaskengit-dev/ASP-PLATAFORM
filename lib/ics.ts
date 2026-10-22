/**
 * Gera um convite de calendário (.ics / iCalendar) para um agendamento de
 * inspeção/execução. Anexado ao e-mail, permite "Adicionar à agenda" no
 * celular. Se não houver hora, vira evento de dia inteiro.
 *
 * Execução de vários dias (Fase 6, `dataFim`): sem hora, um evento de dia
 * inteiro cobrindo o período (DTEND = dia seguinte ao fim, exclusivo, como
 * manda o padrão); com hora, o horário se repete a cada dia do período
 * (RRULE diária com COUNT = nº de dias) — um bloco só de 72 h ocuparia as
 * madrugadas na agenda.
 */
interface IcsInput {
  uid: string;
  titulo: string;
  descricao?: string;
  local?: string;
  /** "YYYY-MM-DD" */
  data: string;
  /** "YYYY-MM-DD" — último dia (execução de vários dias); vazio = um dia. */
  dataFim?: string | null;
  /** "HH:MM" opcional */
  hora?: string | null;
  /** duração em minutos quando há hora (padrão 120) */
  duracaoMin?: number;
  organizador?: string;
  participantes?: string[];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dtLocal(d: Date) {
  return (
    d.getFullYear().toString() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" +
    pad(d.getHours()) + pad(d.getMinutes()) + "00"
  );
}
function dtDate(d: Date) {
  return d.getFullYear().toString() + pad(d.getMonth() + 1) + pad(d.getDate());
}
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function gerarIcsAgendamento(i: IcsInput): string {
  const [y, m, d] = i.data.split("-").map(Number);
  // Dias do período (1 = um dia só). Fim inválido ou antes do início = 1.
  let dias = 1;
  if (i.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(i.dataFim) && i.dataFim > i.data) {
    const [yf, mf, df] = i.dataFim.split("-").map(Number);
    dias = Math.round((Date.UTC(yf, mf - 1, df) - Date.UTC(y, m - 1, d)) / 86400000) + 1;
  }
  const linhas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ASP//Agendamento//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${i.uid}`,
    `DTSTAMP:${dtLocal(new Date())}`,
  ];

  if (i.hora && /^\d{1,2}:\d{2}$/.test(i.hora)) {
    const [hh, mm] = i.hora.split(":").map(Number);
    const inicio = new Date(y, m - 1, d, hh, mm, 0);
    const fim = new Date(inicio.getTime() + (i.duracaoMin ?? 120) * 60000);
    linhas.push(`DTSTART:${dtLocal(inicio)}`, `DTEND:${dtLocal(fim)}`);
    if (dias > 1) linhas.push(`RRULE:FREQ=DAILY;COUNT=${dias}`);
  } else {
    const inicio = new Date(y, m - 1, d);
    const fim = new Date(y, m - 1, d + dias);
    linhas.push(`DTSTART;VALUE=DATE:${dtDate(inicio)}`, `DTEND;VALUE=DATE:${dtDate(fim)}`);
  }

  linhas.push(`SUMMARY:${esc(i.titulo)}`);
  if (i.descricao) linhas.push(`DESCRIPTION:${esc(i.descricao)}`);
  if (i.local) linhas.push(`LOCATION:${esc(i.local)}`);
  if (i.organizador) linhas.push(`ORGANIZER:mailto:${i.organizador}`);
  (i.participantes || []).filter(Boolean).forEach((p) => {
    linhas.push(`ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:${p}`);
  });
  linhas.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  // Quebra de linha CRLF exigida pelo padrão iCalendar.
  return linhas.join("\r\n");
}
