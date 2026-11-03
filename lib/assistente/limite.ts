/**
 * Limite diário de perguntas por pessoa (a cota gratuita da IA é uma só para
 * todos). Conta as respostas do dia no registro (gp_assistente_respostas) que
 * gastaram IA — respostas guardadas e recusas do filtro não contam. O
 * administrador não tem limite. Sem o registro (migração não aplicada), não
 * limita.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** ASSISTENTE_LIMITE_DIARIO na Vercel (padrão 25; 0 = sem limite). */
export function limiteDiario(): number {
  const v = process.env.ASSISTENTE_LIMITE_DIARIO;
  const n = Number(v);
  return v != null && v.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : 25;
}

export const msgLimite = (n: number) =>
  `Você chegou ao limite de ${n} perguntas por dia ao Robô ASP (a cota da IA é dividida entre todos). Ele volta amanhã; dúvidas de uso já respondidas antes continuam funcionando.`;

/** Quantas perguntas que gastaram IA a pessoa fez hoje (dia de Brasília). */
export async function perguntasHoje(sb: SupabaseClient, usuarioId: string, hojeIso: string): Promise<number | null> {
  const inicio = `${hojeIso}T03:00:00Z`; // 00:00 em Brasília (UTC−3)
  const { count, error } = await sb.from("gp_assistente_respostas").select("id", { count: "exact", head: true })
    .eq("usuario_id", usuarioId).gte("criado_em", inicio).not("provedor", "in", "(cache,filtro)");
  return error ? null : count ?? 0;
}

/** IA reserva quando a cota gratuita acaba: ASSISTENTE_RESERVA=anthropic e a
 *  ANTHROPIC_API_KEY cadastrada (tem custo por pergunta). */
export const temReservaAnthropic = () => process.env.ASSISTENTE_RESERVA === "anthropic" && !!process.env.ANTHROPIC_API_KEY;
