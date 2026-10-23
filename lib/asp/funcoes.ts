/** Leitura de gp_funcoes (Funções do usuário e permissões por função) com
 * qualquer cliente Supabase — servidor (chave de serviço ou sessão) ou
 * navegador (RLS: todo perfil ASP ativo lê).
 *
 * Se a tabela ainda não existe (código publicado antes de rodar a migração
 * 20261105100000), usa FUNCOES_PADRAO = o comportamento de antes. Qualquer
 * outro erro: nenhuma permissão pela função (falha fechada). */
import {
  CHAVES_PERMISSAO_FUNCAO, FUNCOES_PADRAO, ordenarFuncoes, permissoesDaFuncao, semPermissoes,
  type FuncaoRef, type PermissoesFuncao,
} from "@/lib/validacao/funcao";

export const CAMPOS_FUNCAO =
  "id, nome, nome_rdo, ordem, ativo, pode_aprovar_medicao, pode_excluir_projetos, pode_editar_revisao, lideranca_equipe, created_at, updated_at";

type ClienteSupabase = { from: (tabela: string) => any };

/** Erro de "tabela não existe" (Postgres 42P01 / PostgREST PGRST205). */
export function tabelaFuncoesAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = error.message || "";
  return error.code === "42P01" || error.code === "PGRST205" || (/gp_funcoes/.test(m) && /exist|schema cache/i.test(m));
}

export function paraFuncaoRef(x: any): FuncaoRef {
  const f: FuncaoRef = {
    id: x.id,
    nome: x.nome,
    nome_rdo: x.nome_rdo ?? null,
    ordem: Number(x.ordem) || 0,
    ativo: x.ativo !== false,
    updated_at: x.updated_at ?? null,
    ...semPermissoes(),
  };
  for (const k of CHAVES_PERMISSAO_FUNCAO) f[k] = !!x[k];
  return f;
}

export async function carregarFuncoes(cliente: ClienteSupabase): Promise<{
  funcoes: FuncaoRef[]; erro: string | null; tabelaAusente: boolean;
}> {
  const { data, error } = await cliente.from("gp_funcoes").select(CAMPOS_FUNCAO);
  if (error) {
    if (tabelaFuncoesAusente(error)) return { funcoes: FUNCOES_PADRAO, erro: null, tabelaAusente: true };
    console.error("[funcoes] carregar:", error.code, error.message);
    return { funcoes: [], erro: "Não foi possível carregar as funções.", tabelaAusente: false };
  }
  return { funcoes: ordenarFuncoes((data || []).map(paraFuncaoRef)), erro: null, tabelaAusente: false };
}

/** Marcas da função de um usuário (uma consulta; sem função = nenhuma). */
export async function carregarPermissoesFuncao(cliente: ClienteSupabase, funcao: string | null | undefined): Promise<PermissoesFuncao> {
  if (!funcao) return semPermissoes();
  const { data, error } = await cliente.from("gp_funcoes").select(CAMPOS_FUNCAO).eq("nome", funcao).maybeSingle();
  if (error) {
    if (tabelaFuncoesAusente(error)) return permissoesDaFuncao(funcao, FUNCOES_PADRAO);
    console.error("[funcoes] permissões:", error.code, error.message);
    return semPermissoes();
  }
  return data ? permissoesDaFuncao(funcao, [paraFuncaoRef(data)]) : semPermissoes();
}
