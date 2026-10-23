/** Lado servidor da validação de cliente/contato: lê do banco o contexto que
 * lib/validacao/cliente.ts precisa. Usa a chave de serviço para enxergar
 * também a lixeira (CNPJ não se repete nem com o cliente excluído). */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  ClienteRef, cnpjRepetido, clientesParecidos, ContatoExistente, normalizarEspacos, projetosDoContato,
  type ProjetoDoCliente, type ProjetoResponsavel, type UsoContato,
} from "@/lib/validacao";

/** Mensagem para quando a migração de Clientes ainda não rodou. */
export const MSG_MIGRACAO_CLIENTES =
  "O banco ainda não tem as colunas/funções de Clientes — rode a migração 20261102100000_asp_clientes_validacao.sql (ou o verificacao-db-asp.sql).";

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

/** Grafias de cidade já usadas por clientes (fora da lixeira) na UF. */
export async function cidadesDaUf(uf: string | null | undefined, excluirId?: string | null): Promise<string[]> {
  const sigla = normalizarEspacos(uf).toUpperCase();
  if (!sigla) return [];
  const { data } = await getSupabaseAdmin().from("gp_orgaos").select("id, cidade").eq("uf", sigla).is("excluido_em", null);
  const set = new Set<string>();
  (data || []).forEach((o: any) => { if (o.id !== excluirId && o.cidade) set.add(normalizarEspacos(o.cidade)); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Contatos já gravados no cliente — ativos e desativados. */
export async function contatosDoCliente(orgaoId: string): Promise<ContatoExistente[]> {
  // "*": antes da migração não existe a coluna `ativo` (todos contam como ativos).
  const { data } = await getSupabaseAdmin().from("gp_orgaos_contatos").select("*").eq("orgao_id", orgaoId);
  return (data || []).map((c: any) => ({ id: c.id, nome_completo: c.nome_completo, email: c.email, ativo: c.ativo !== false }));
}

/** Projetos do cliente (inclusive lixeira) para a decisão de excluir. */
export async function projetosParaExclusao(clienteId: string): Promise<{ projetos: ProjetoDoCliente[]; erro: string | null }> {
  const { data, error } = await getSupabaseAdmin().from("gp_projetos").select("*").eq("cliente_id", clienteId);
  if (error) return { projetos: [], erro: error.message };
  return {
    projetos: (data || []).map((p: any) => ({
      id: p.id,
      codigo: p.codigo_projeto || p.pedido_compra || null,
      excluido: !!p.excluido_em,
      concluido: !!p.concluido_em,
    })),
    erro: null,
  };
}

/** Projetos do cliente (inclusive lixeira) com o responsável em texto. */
export async function projetosResponsaveis(clienteId: string): Promise<ProjetoResponsavel[]> {
  const { data } = await getSupabaseAdmin()
    .from("gp_projetos").select("id, codigo_projeto, responsavel_projeto, excluido_em").eq("cliente_id", clienteId);
  return (data || []).map((p: any) => ({
    id: p.id, codigo: p.codigo_projeto || null, responsavel: p.responsavel_projeto || null, excluido: !!p.excluido_em,
  }));
}

/** Onde o contato é usado: entregas que o citam (contato_id) e projetos
 * deste cliente com ele como responsável (pelo nome). */
export async function usoDoContato(clienteId: string, contato: { id: string; nome_completo: string }): Promise<UsoContato> {
  const [{ count }, projetos] = await Promise.all([
    getSupabaseAdmin().from("gp_entregas").select("id", { count: "exact", head: true }).eq("contato_id", contato.id),
    projetosResponsaveis(clienteId),
  ]);
  return { entregas: count || 0, projetos: projetosDoContato(contato.nome_completo, projetos).length };
}
