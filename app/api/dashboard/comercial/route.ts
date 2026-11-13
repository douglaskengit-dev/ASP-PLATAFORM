import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { lerFiltros } from "@/lib/asp/dashboard";
import { carregarDadosDashboard, carregarProcessosDashboard } from "@/lib/asp/dashboard-dados";
import { montarComercial } from "@/lib/asp/dashboard-comercial";
import { paineisDoPerfil, podeVerPainel, semAcesso } from "@/lib/asp/dashboard-acesso";
import { hojeBrasil } from "@/lib/validacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dashboard Comercial (Admin e Comercial). Filtros: ?periodo=&de=&ate=
 * &cliente=. Leitura via RLS (route client). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeVerPainel(profile.perfil, "comercial")) {
    return NextResponse.json(semAcesso(profile.perfil), { status: 403 });
  }
  try {
    const supabase = getSupabaseRouteClient();
    const [dados, processos] = await Promise.all([carregarDadosDashboard(supabase), carregarProcessosDashboard(supabase)]);
    const painel = montarComercial({ ...dados, processos }, lerFiltros(req.nextUrl.searchParams), hojeBrasil());
    return NextResponse.json({ ok: true, painel, paineis: paineisDoPerfil(profile.perfil) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e: any) {
    return NextResponse.json({ erro: `Não foi possível montar o Dashboard: ${e?.message || e}` }, { status: 500 });
  }
}
