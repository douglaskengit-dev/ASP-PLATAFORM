/**
 * Gera um convite de calendário (.ics / iCalendar) para um agendamento de
 * inspeção/execução. Anexado ao e-mail, permite "Adicionar à agenda" no
 * celular. Se não houver hora, vira evento de dia inteiro.
 */
interface IcsInput {
  uid: string;
  titulo: string;
  descricao?: string;
  local?: string;
  /** "YYYY-MM-DD" */
  data: string;
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
  } else {
    const inicio = new Date(y, m - 1, d);
    const fim = new Date(y, m - 1, d + 1);
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
