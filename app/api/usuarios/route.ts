import { NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { carregarFuncoes } from "@/lib/asp/funcoes";

export const runtime = "nodejs";

/** Lista enxuta de usuários ativos (id, nome, perfil, função) para seletores
 * como a "equipe" de um agendamento. Requer sessão; usa o cliente admin só
 * para ler nomes (não expõe dados sensíveis). `funcoes` = funções
 * cadastradas (gp_funcoes: nome no RDO, liderança) — omitido se não deu
 * para ler. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const [{ data, error }, cad] = await Promise.all([admin
    .from("gp_profiles")
    .select("id, nome_completo, email, perfil, funcao, ativo")
    .eq("ativo", true)
    .order("nome_completo", { ascending: true }), carregarFuncoes(admin)]);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const usuarios = (data || []).map((u: any) => ({
    id: u.id,
    nome: u.nome_completo || u.email || "usuário",
    email: u.email,
    perfil: u.perfil,
    funcao: u.funcao,
  }));
  const funcoes = cad.erro ? undefined : cad.funcoes.map((f) => ({
    nome: f.nome, nome_rdo: f.nome_rdo, ordem: f.ordem, ativo: f.ativo, lideranca_equipe: f.lideranca_equipe,
  }));
  return NextResponse.json({ ok: true, usuarios, ...(funcoes ? { funcoes } : {}) });
}
