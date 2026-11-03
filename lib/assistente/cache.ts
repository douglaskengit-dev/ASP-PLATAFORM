/**
 * Respostas guardadas das dúvidas de uso (gp_assistente_cache): a mesma
 * pergunta sobre como usar o sistema não gasta a cota da IA de novo. Nunca
 * guarda resposta que consultou o banco (dados mudam e dependem do acesso de
 * quem pergunta). Só o servidor lê e grava (service role); sem a tabela ou
 * sem a chave, simplesmente não guarda.
 */
import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { MANUAL_USUARIO } from "./manual";
import { normalizar } from "./manual-busca";
import { INSTRUCOES_ASSISTENTE } from "./prompt";

const VALIDADE_DIAS = 30;
const BASE = createHash("sha1").update(INSTRUCOES_ASSISTENTE).update(MANUAL_USUARIO).digest("hex");

/** "Como gero o relatório?" e "como gero o relatorio" dão a mesma chave. */
export const chaveDaPergunta = (p: string) => normalizar(p).replace(/[^a-z0-9]+/g, " ").trim();

/** Muda com o manual, as instruções e os exemplos aprovados. */
export const versaoDoCache = (exemplos: string) => createHash("sha1").update(BASE).update(exemplos).digest("hex").slice(0, 16);

function admin() {
  try { return getSupabaseAdmin(); } catch { return null; }
}

export async function respostaGuardada(pergunta: string, versao: string): Promise<string | null> {
  const sb = admin();
  const chave = chaveDaPergunta(pergunta);
  if (!sb || chave.length < 8) return null;
  const desde = new Date(Date.now() - VALIDADE_DIAS * 86400000).toISOString();
  const { data, error } = await sb.from("gp_assistente_cache").select("resposta, usos")
    .eq("chave", chave).eq("versao", versao).gte("criado_em", desde).maybeSingle();
  if (error || !data) return null;
  await sb.from("gp_assistente_cache").update({ usos: ((data as any).usos || 0) + 1, ultimo_uso: new Date().toISOString() })
    .eq("chave", chave).eq("versao", versao).then(() => {}, () => {});
  return (data as any).resposta;
}

export async function guardarResposta(pergunta: string, resposta: string, versao: string): Promise<void> {
  const sb = admin();
  const chave = chaveDaPergunta(pergunta);
  if (!sb || chave.length < 8) return;
  const { error } = await sb.from("gp_assistente_cache")
    .upsert({ chave, versao, pergunta: pergunta.slice(0, 1000), resposta: resposta.slice(0, 8000), criado_em: new Date().toISOString() });
  if (error) console.error("assistente/cache:", error.message);
}

/** 👎 numa resposta: ela sai do cache (todas as versões). */
export async function esquecerResposta(resposta: string): Promise<void> {
  const sb = admin();
  if (sb) await sb.from("gp_assistente_cache").delete().eq("resposta", resposta).then(() => {}, () => {});
}

/** Admin: limpa tudo. */
export async function limparCache(): Promise<boolean> {
  const sb = admin();
  if (!sb) return false;
  const { error } = await sb.from("gp_assistente_cache").delete().neq("chave", "");
  return !error;
}
