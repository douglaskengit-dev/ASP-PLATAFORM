/** Lado servidor de Administração de usuários → Funções / Permissões por
 *  função: contexto do banco para lib/validacao/funcao.ts, versão
 *  (concorrência) e tradução dos erros. Usado por /api/admin/funcoes/**.
 *  Chave de serviço; só administradores chegam aqui (exigirAdminFuncoes). */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { carregarFuncoes } from "@/lib/asp/funcoes";
import { usuariosComFuncao, type ChavePermissaoFuncao, type FuncaoRef } from "@/lib/validacao/funcao";

export async function exigirAdminFuncoes() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: "Não autenticado.", status: 401 as const };
  if (profile.perfil !== "admin") return { erro: "Apenas administradores podem gerenciar funções.", status: 403 as const };
  return { profile };
}

export interface FuncaoComUso extends FuncaoRef {
  /** Usuários (ativos e inativos) com a função. */
  usuarios: number;
}

/** Funções + quantos usuários cada uma tem. */
export async function carregarFuncoesComUso(): Promise<{
  funcoes: FuncaoComUso[]; perfis: { funcao: string | null }[]; erro: string | null; tabelaAusente: boolean;
  /** Marcas cuja coluna ainda não existe (migração pendente). */
  marcasAusentes: ChavePermissaoFuncao[];
}> {
  const admin = getSupabaseAdmin();
  const [cad, perf] = await Promise.all([
    carregarFuncoes(admin),
    admin.from("gp_profiles").select("funcao").not("funcao", "is", null),
  ]);
  if (cad.erro || perf.error) {
    if (perf.error) console.error("[admin/funcoes] perfis:", perf.error.message);
    return { funcoes: [], perfis: [], erro: cad.erro || "Não foi possível contar os usuários por função.", tabelaAusente: false, marcasAusentes: [] };
  }
  const perfis = (perf.data || []) as { funcao: string | null }[];
  return {
    funcoes: cad.funcoes.map((f) => ({ ...f, usuarios: usuariosComFuncao(f.nome, perfis) })),
    perfis,
    erro: null,
    tabelaAusente: cad.tabelaAusente,
    marcasAusentes: cad.marcasAusentes,
  };
}

export const MSG_MARCAS_AUSENTES =
  "As permissões de registro em campo (medições, fotos, RDO) ainda não existem no banco — rode a migração 20261106100000_asp_permissoes_campo.sql no SQL Editor.";

export const MSG_TABELA_AUSENTE =
  "A tabela de funções ainda não existe no banco — rode a migração 20261105100000_asp_funcoes_permissoes.sql no SQL Editor.";

/** "Outro administrador alterou esta função às 14:05 — recarregue." */
export function msgVersaoFuncao(updatedAt: string | null | undefined, nome?: string): string {
  let hora = "";
  try {
    if (updatedAt) {
      hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(updatedAt));
    }
  } catch { /* sem hora */ }
  return `Outro administrador alterou ${nome ? `a função “${nome}”` : "esta função"}${hora ? ` às ${hora}` : ""} — recarregue (sua alteração não foi gravada).`;
}

/** Erro do banco ao gravar gp_funcoes → português + campo + status. */
export function traduzirErroFuncao(error: { code?: string; message?: string }): { erro: string; campo: string | null; status: number } {
  const m = error.message || "";
  if (error.code === "23505") return { erro: "Já existe uma função com este nome.", campo: "nome", status: 409 };
  if (error.code === "23503") return { erro: "A função está em uso por usuários — desative-a em vez de excluir.", campo: "excluir", status: 409 };
  if (error.code === "23514") return { erro: "Nome inválido (obrigatório, até 60 caracteres).", campo: "nome", status: 400 };
  if (/gp_funcoes_versao/.test(m)) return { erro: msgVersaoFuncao(null), campo: null, status: 409 };
  console.error("[admin/funcoes] gravar:", error.code, m);
  return { erro: "Não foi possível gravar a função. Tente de novo em instantes.", campo: null, status: 500 };
}

export function erroCampoFuncao(erro: string, campo: string | null, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ erro, ...(campo ? { campo, erros: { [campo]: [erro] } } : {}), ...extra }, { status });
}

/** Lê e confere o corpo JSON (objeto, só os campos permitidos). */
export async function lerCorpo(req: Request, permitidos: Set<string>): Promise<{ body: any } | { resposta: NextResponse }> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return { resposta: NextResponse.json({ erro: "Requisição inválida." }, { status: 400 }) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { resposta: NextResponse.json({ erro: "Requisição inválida." }, { status: 400 }) };
  }
  const extras = Object.keys(body).filter((k) => !permitidos.has(k));
  if (extras.length) return { resposta: NextResponse.json({ erro: `Campo não permitido: ${extras.join(", ")}.` }, { status: 400 }) };
  return { body };
}
