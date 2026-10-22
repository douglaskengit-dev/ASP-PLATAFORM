/** Lado servidor da validação da Ordem de Serviço (Fase 2): lê do banco o
 *  contexto que lib/validacao/ordemServico.ts precisa. Usado por POST de
 *  /api/inspecoes, pelo PATCH de /api/inspecoes/[id] (renomear, procedimento,
 *  restaurar) e pela restauração da Lixeira. Lê com a chave de serviço para
 *  enxergar também a lixeira do projeto. Não é rota: só funções. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  ContextoOS, DadosOS, identificacaoRepetida, OSRef, ResultadoValidacao, validarOS,
} from "@/lib/validacao";

/** OSs do projeto (ativas e na lixeira). */
export async function ordensDoProjeto(projetoId: string): Promise<OSRef[]> {
  const { data } = await getSupabaseAdmin()
    .from("gp_inspecoes")
    .select("id, identificacao, tanque, excluido_em")
    .eq("projeto_id", projetoId);
  return (data || []).map((o: any) => ({ id: o.id, identificacao: o.identificacao, tanque: o.tanque, excluido: !!o.excluido_em }));
}

/** Códigos de procedimento do Catálogo (todos) e os desativados. */
export async function codigosDoCatalogoComStatus(): Promise<{ todos: string[]; inativos: string[] }> {
  const { data } = await getSupabaseAdmin().from("gp_procedimentos").select("*");
  const linhas = (data || []).filter((p: any) => p.codigo);
  return {
    todos: linhas.map((p: any) => p.codigo),
    inativos: linhas.filter((p: any) => p.ativo === false).map((p: any) => p.codigo),
  };
}

/** Códigos de procedimento do Catálogo (ativos e desativados). */
export async function codigosDoCatalogo(): Promise<string[]> {
  return (await codigosDoCatalogoComStatus()).todos;
}

/** Valida no servidor. Devolve o resultado e, se a identificação repetiu,
 *  a OS que já a usa (para a resposta 409 mostrar qual é). */
export async function validarOSNoServidor(
  dados: DadosOS,
  opts: { projetoId: string; excluirId?: string | null; exigirProcedimento?: boolean; procedimentoAtual?: string | null }
): Promise<{ resultado: ResultadoValidacao; conflito: OSRef | null }> {
  const precisaCatalogo = opts.exigirProcedimento !== false;
  const [ordens, catalogo] = await Promise.all([
    ordensDoProjeto(opts.projetoId),
    precisaCatalogo ? codigosDoCatalogoComStatus() : Promise.resolve(undefined),
  ]);
  const ctx: ContextoOS = {
    ordens, procedimentos: catalogo?.todos, procedimentosInativos: catalogo?.inativos,
    procedimentoAtual: opts.procedimentoAtual ?? null,
    excluirId: opts.excluirId || null, exigirProcedimento: opts.exigirProcedimento,
  };
  return { resultado: validarOS(dados, ctx), conflito: identificacaoRepetida(dados.identificacao, ctx) };
}

/** Restaurar uma OS da lixeira não pode criar duplicata: devolve a OS ativa
 *  com a mesma identificação, ou null. */
export async function conflitoAoRestaurarOS(id: string): Promise<OSRef | null> {
  const { data: os } = await getSupabaseAdmin()
    .from("gp_inspecoes").select("id, projeto_id, identificacao").eq("id", id).maybeSingle();
  if (!os) return null;
  const ordens = await ordensDoProjeto(os.projeto_id);
  return identificacaoRepetida(os.identificacao, { ordens, excluirId: os.id });
}

/** Violação de índice único (23505) — corrida entre dois salvamentos. */
export function ehViolacaoUnica(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
