import { NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { FASES } from "@/lib/asp/fases";

export const runtime = "nodejs";

/** Fases que exigem atuação de um perfil (para notificações):
 * Comercial 2/6, Operações 3/4/7/8, Gerência 5/9/10. Admin vê todas. */
function fasesDoPerfil(perfil: string): number[] {
  if (perfil === "admin") {
    return FASES.filter((f) => f.responsaveis.some((r) => r !== "admin")).map((f) => f.numero);
  }
  return FASES.filter((f) => f.responsaveis.includes(perfil as any)).map((f) => f.numero);
}

/** Inspeções paradas numa fase que é responsabilidade do perfil do usuário —
 * "o processo está para atuação da sua área". */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const fases = fasesDoPerfil(profile.perfil);
  if (fases.length === 0) {
    return NextResponse.json({ ok: true, perfil: profile.perfil, inspecoes: [] });
  }

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_inspecoes")
    .select("id, identificacao, fase, atualizado_em, projeto:gp_projetos(id, codigo_projeto, pedido_compra, cliente:gp_orgaos(razao_social))")
    .in("fase", fases)
    .order("atualizado_em", { ascending: true });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, perfil: profile.perfil, inspecoes: data || [] });
}
