/**
 * Pendências de campo — o que falta na EXECUÇÃO de hoje (fase 7): fotos da
 * coleta e o RDO do dia. Alimenta o widget do Dashboard e as notificações
 * das 11h, 16h e 17h30 (esta só no último dia da execução).
 *
 * Função pura: recebe as linhas já lidas do banco e devolve a lista por OS.
 * A leitura e o envio ficam em lib/asp/pendencias-campo-api.ts.
 *
 * Entra a OS que:
 *   • está na fase 7, aberta e não excluída;
 *   • tem execução ATIVA (não substituída, com data) cujo período inclui hoje.
 * Quem é avisado: a equipe agendada nessa execução.
 */
import { pendenciasColeta, registroVazio, type RegistroFotosExecucao } from "./fotos-execucao";
import { periodoDe } from "../validacao/periodo";

export type TurnoAviso = "11h" | "16h" | "17h30";
export const TURNOS_AVISO: TurnoAviso[] = ["11h", "16h", "17h30"];

export interface PendenciaOS {
  inspecaoId: string;
  identificacao: string;
  projetoId: string;
  projeto: string;
  /** Hoje é o último dia do período de execução. */
  ultimoDia: boolean;
  /** "Limpeza — Durante: 1 de 3 fotos"… (vazio = fotos completas). */
  fotos: string[];
  /** Falta o RDO de hoje do projeto. */
  rdoFaltando: boolean;
  /** Ids da equipe agendada. */
  equipe: string[];
  /** Do procedimento — o card da coleta precisa. */
  aguaPotavel: boolean;
  cloroUnidade?: string | null;
  cloroLimiteAviso?: number | null;
}

export interface LinhasPendencias {
  hoje: string;
  agendamentos: {
    inspecao_id: string; tipo: string; data_visita: string | null; data_fim?: string | null;
    a_definir?: boolean | null; substituido_em?: string | null; equipe?: unknown;
  }[];
  inspecoes: {
    id: string; identificacao?: string | null; fase: number; procedimento?: string | null;
    encerrada_em?: string | null; excluido_em?: string | null;
    projeto_id: string; projeto?: { codigo_projeto?: string | null; pedido_compra?: string | null } | null;
  }[];
  procedimentos: { codigo: string; agua_potavel?: boolean | null; cloro_unidade?: string | null; cloro_limite_aviso?: number | null }[];
  fotos: (RegistroFotosExecucao & { inspecao_id: string })[];
  /** RDOs de HOJE (não excluídos) — basta o projeto. */
  rdosHoje: { projeto_id: string }[];
}

function idsDaEquipe(equipe: unknown): string[] {
  if (!Array.isArray(equipe)) return [];
  return Array.from(new Set(equipe.map((m: any) => (m && m.id ? String(m.id) : "")).filter(Boolean)));
}

export function montarPendencias(l: LinhasPendencias): PendenciaOS[] {
  const insp = new Map(l.inspecoes.map((i) => [i.id, i]));
  const proc = new Map(l.procedimentos.map((p) => [p.codigo, p]));
  const fotos = new Map(l.fotos.map((f) => [f.inspecao_id, f]));
  const comRdo = new Set(l.rdosHoje.map((r) => r.projeto_id));
  const vistas = new Set<string>();
  const lista: PendenciaOS[] = [];

  for (const ag of l.agendamentos) {
    if (ag.tipo !== "execucao" || ag.substituido_em || ag.a_definir) continue;
    const per = periodoDe(ag);
    if (!per || l.hoje < per.inicio || l.hoje > per.fim) continue;
    const i = insp.get(ag.inspecao_id);
    if (!i || Number(i.fase) !== 7 || i.encerrada_em || i.excluido_em) continue;
    if (vistas.has(i.id)) continue;                 // uma execução ativa por OS
    vistas.add(i.id);
    const p = i.procedimento ? proc.get(i.procedimento) : undefined;
    const reg = fotos.get(i.id) || registroVazio(!!p?.agua_potavel);
    lista.push({
      inspecaoId: i.id,
      identificacao: i.identificacao || "OS",
      projetoId: i.projeto_id,
      projeto: i.projeto?.codigo_projeto || i.projeto?.pedido_compra || "",
      ultimoDia: per.fim === l.hoje,
      fotos: pendenciasColeta(reg),
      rdoFaltando: !comRdo.has(i.projeto_id),
      equipe: idsDaEquipe(ag.equipe),
      aguaPotavel: !!p?.agua_potavel,
      cloroUnidade: p?.cloro_unidade ?? null,
      cloroLimiteAviso: p?.cloro_limite_aviso ?? null,
    });
  }
  return lista.sort((a, b) => a.identificacao.localeCompare(b.identificacao, "pt-BR"));
}

export const temPendencia = (p: PendenciaOS) => p.fotos.length > 0 || p.rdoFaltando;

/** OSs com pendência de um usuário (equipe agendada). O turno das 17h30 só
 *  vale para quem está no último dia da execução. */
export function pendenciasDoUsuario(lista: PendenciaOS[], usuarioId: string, turno?: TurnoAviso): PendenciaOS[] {
  return lista.filter((p) => p.equipe.includes(usuarioId) && temPendencia(p) && (turno !== "17h30" || p.ultimoDia));
}

/** "4 fotos e o RDO de hoje" / "o RDO de hoje" / "1 foto". */
export function resumoPendencia(p: PendenciaOS): string {
  const partes: string[] = [];
  if (p.fotos.length) partes.push(`${p.fotos.length} ${p.fotos.length === 1 ? "item de foto" : "itens de foto"}`);
  if (p.rdoFaltando) partes.push("o RDO de hoje");
  return partes.join(" e ");
}

/** "falta 1 item de foto" / "falta o RDO de hoje" / "faltam 3 itens…" */
function verboFaltar(p: PendenciaOS): string {
  return p.fotos.length > 1 || (p.fotos.length > 0 && p.rdoFaltando) ? "faltam" : "falta";
}

/** Título e texto da notificação de um usuário (uma por turno). */
export function mensagemAviso(minhas: PendenciaOS[], turno: TurnoAviso): { titulo: string; mensagem: string } {
  const ultimo = turno === "17h30";
  if (minhas.length === 1) {
    const p = minhas[0];
    const proj = p.projeto ? ` (${p.projeto})` : "";
    return {
      titulo: `${ultimo ? "Último dia — " : ""}${p.identificacao}${proj}: ${verboFaltar(p)} ${resumoPendencia(p)}`,
      mensagem: p.fotos.length
        ? `${p.fotos.slice(0, 3).join("; ")}${p.fotos.length > 3 ? `; e mais ${p.fotos.length - 3}` : ""}.`
        : "Prepare o RDO de hoje antes de sair do local.",
    };
  }
  return {
    titulo: `${ultimo ? "Último dia — " : ""}Pendências de campo em ${minhas.length} OSs`,
    mensagem: minhas.map((p) => `${p.identificacao}: ${resumoPendencia(p)}`).join(" · "),
  };
}
