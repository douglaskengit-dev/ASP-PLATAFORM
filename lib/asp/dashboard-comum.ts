/** Peças comuns aos Dashboards de Gerência e Comercial (agregações puras). */
import { diaBrasilia, periodoDe, execucaoAtiva, somarDias } from "../validacao";
import { diferencaDias, intervaloDoPeriodo, type AgendamentoBruto, type DadosDashboard, type EntregaBruta, type FiltrosDashboard, type Intervalo, type OsBruta } from "./dashboard";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "AAAA-MM" do dia. */
export const mesDe = (dia: string | null | undefined) => (dia ? dia.slice(0, 7) : null);

/** "2026-11" → "nov/26". */
export const rotuloMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;

/** Os 12 meses que terminam no mês de `ate` (o mais antigo primeiro). */
export function ultimos12Meses(ate: string): string[] {
  let a = Number(ate.slice(0, 4)), m = Number(ate.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.unshift(`${a}-${String(m).padStart(2, "0")}`);
    m--; if (m === 0) { m = 12; a--; }
  }
  return out;
}

/** Mesmo mês, um ano antes. */
export const mesAnoAnterior = (mes: string) => `${Number(mes.slice(0, 4)) - 1}${mes.slice(4)}`;

/** Período de mesmo tamanho logo antes do escolhido. */
export function periodoAnterior(p: Intervalo): Intervalo {
  const n = diferencaDias(p.de, p.ate) + 1;
  return { de: somarDias(p.de, -n), ate: somarDias(p.de, -1) };
}

export function intervalo(f: FiltrosDashboard, hoje: string): Intervalo {
  return intervaloDoPeriodo(f, hoje);
}

/** OSs vivas (projeto fora da lixeira) no recorte de cliente e procedimento. */
export function ossDoRecorte(d: Pick<DadosDashboard, "oss" | "projetos">, f: Pick<FiltrosDashboard, "cliente" | "procedimento">): OsBruta[] {
  const projetos = new Map(d.projetos.map((p) => [p.id, p]));
  return d.oss.filter((o) => {
    const p = projetos.get(o.projeto_id);
    if (!p) return false;
    if (f.cliente && p.cliente_id !== f.cliente) return false;
    if (f.procedimento && o.procedimento !== f.procedimento) return false;
    return true;
  });
}

/** Fim da execução agendada da OS (dia) ou null. */
export function fimExecucao(ags: AgendamentoBruto[]): string | null {
  const p = periodoDe(execucaoAtiva(ags.map((a) => ({ ...a, substituido_em: null }))));
  return p ? p.fim : null;
}

/** Entrega do relatório final ao cliente: a primeira entrega no dia do fim da
 *  execução ou depois. Sem execução agendada, a primeira entrega da OS. */
export function entregaFinal(entregas: EntregaBruta[], fimExec: string | null): string | null {
  const dias = entregas.map((e) => e.data).filter(Boolean).sort();
  return (fimExec ? dias.find((x) => x >= fimExec) : dias[0]) || null;
}

/** Dia (Brasília) da abertura da OS. */
export const aberturaOS = (o: Pick<OsBruta, "criado_em">) => diaBrasilia(o.criado_em);

/** Variação relativa (0,25 = +25%); null quando a base é zero. */
export const variacao = (atual: number, anterior: number) => (anterior > 0 ? (atual - anterior) / anterior : null);

/** Mediana simples (null sem valores). */
export function mediana(v: number[]): number | null {
  const x = v.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!x.length) return null;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
}
