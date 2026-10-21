/** Lado servidor da validação de cliente/contato: lê do banco o contexto que
 * lib/validacao/cliente.ts precisa. Usa a chave de serviço para enxergar
 * também a lixeira (CNPJ não se repete nem com o cliente excluído). */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ClienteRef, cnpjRepetido, clientesParecidos, ContatoExistente } from "@/lib/validacao";

/** Todos os clientes (ativos e na lixeira), no formato das regras. */
export async function clientesCadastrados(): Promise<ClienteRef[]> {
  const { data } = await getSupabaseAdmin().from("gp_orgaos").select("id, razao_social, cnpj, excluido_em");
  return (data || []).map((c: any) => ({ id: c.id, razao_social: c.razao_social, cnpj: c.cnpj, excluido: !!c.excluido_em }));
}

/** Só os clientes que conflitam com o que foi digitado (CNPJ igual ou razão
 * social parecida) — é o que a checagem ao vivo precisa ver. */
export async function clientesConflitantes(cnpj: string, razaoSocial: string, excluirId?: string | null): Promise<ClienteRef[]> {
  const ctx = { clientes: await clientesCadastrados(), excluirId };
  const rep = cnpjRepetido(cnpj, ctx);
  const parecidos = clientesParecidos(razaoSocial, ctx);
  return [...(rep ? [rep] : []), ...parecidos.filter((c) => c.id !== rep?.id)];
}

/** Contatos já gravados no cliente. */
export async function contatosDoCliente(orgaoId: string): Promise<ContatoExistente[]> {
  const { data } = await getSupabaseAdmin().from("gp_orgaos_contatos").select("id, nome_completo, email").eq("orgao_id", orgaoId);
  return (data || []) as ContatoExistente[];
}
