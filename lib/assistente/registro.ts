/**
 * Registro das respostas do robô (gp_assistente_respostas) e exemplos
 * aprovados pelo admin (gp_assistente_exemplos). Tudo com o cliente da sessão:
 * cada um grava e avalia só as suas respostas. Se as tabelas ainda não
 * existirem (migração não aplicada), o robô segue funcionando sem registro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DadosRegistro {
  pergunta: string;
  resposta: string;
  pagina?: string | null;
  consultas: string[];
  foraDoEscopo?: boolean;
  reserva?: boolean;
  provedor: string;
  chamadasIa?: number;
  duracaoMs?: number;
}

/** Grava a resposta e devolve o id (para o 👍/👎), ou null se não deu. */
export async function registrarResposta(sb: SupabaseClient, d: DadosRegistro): Promise<string | null> {
  const linha = {
    pergunta: d.pergunta.slice(0, 4000), resposta: d.resposta.slice(0, 8000),
    pagina: typeof d.pagina === "string" ? d.pagina.slice(0, 300) : null,
    consultas: Array.from(new Set(d.consultas)), fora_do_escopo: !!d.foraDoEscopo, reserva: !!d.reserva, provedor: d.provedor,
  };
  const uso = { chamadas_ia: d.chamadasIa ?? 0, duracao_ms: d.duracaoMs ?? null };
  let { data, error } = await sb.from("gp_assistente_respostas").insert({ ...linha, ...uso }).select("id").single();
  // sem as colunas de uso (migração 20261111 não aplicada): grava sem elas
  if (error && /chamadas_ia|duracao_ms/.test(error.message)) {
    ({ data, error } = await sb.from("gp_assistente_respostas").insert(linha).select("id").single());
  }
  if (error) { console.error("assistente/registro:", error.message); return null; }
  return (data as any)?.id ?? null;
}

/** Até 8 exemplos ativos, já no formato do prompt ("" se não houver). */
export async function exemplosAprovados(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.from("gp_assistente_exemplos")
    .select("pergunta, resposta").eq("ativo", true).order("atualizado_em", { ascending: false }).limit(8);
  if (error || !data?.length) return "";
  const lista = data.map((e: any, i: number) => `Exemplo aprovado ${i + 1}\nUsuário: ${e.pergunta}\nRobô: ${e.resposta}`).join("\n\n");
  return `Respostas aprovadas pela equipe (siga o tom e o formato; os dados delas podem ter mudado — consulte o banco de novo):\n${lista}`;
}
