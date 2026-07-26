import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

/** Detalhe da inspeção com coletas, agendamentos, relatórios e histórico. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: inspecao, error } = await supabase
    .from("gp_inspecoes")
    .select("*, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, cliente:gp_orgaos(razao_social))")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });

  const [coletas, agendamentos, relatorios, historico] = await Promise.all([
    supabase.from("gp_coletas").select("*").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
    supabase.from("gp_agendamentos").select("*").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
    supabase.from("gp_relatorios").select("*").eq("inspecao_id", params.id).order("versao", { ascending: false }),
    supabase.from("gp_fase_historico").select("*").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
  ]);

  return NextResponse.json({
    ok: true,
    inspecao,
    coletas: coletas.data || [],
    agendamentos: agendamentos.data || [],
    relatorios: relatorios.data || [],
    historico: historico.data || [],
  });
}
