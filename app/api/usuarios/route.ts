import { NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Lista enxuta de usuários ativos (id, nome, perfil, função) para seletores
 * como a "equipe" de um agendamento. Requer sessão; usa o cliente admin só
 * para ler nomes (não expõe dados sensíveis). */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("gp_profiles")
    .select("id, nome_completo, email, perfil, funcao, ativo")
    .eq("ativo", true)
    .order("nome_completo", { ascending: true });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const usuarios = (data || []).map((u: any) => ({
    id: u.id,
    nome: u.nome_completo || u.email || "usuário",
    email: u.email,
    perfil: u.perfil,
    funcao: u.funcao,
  }));
  return NextResponse.json({ ok: true, usuarios });
}
