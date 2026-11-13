import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { lerFiltros } from "@/lib/asp/dashboard";
import { carregarDadosDashboard } from "@/lib/asp/dashboard-dados";
import { montarGerencia } from "@/lib/asp/dashboard-gerencia";
import { carregarCalibracao } from "@/lib/asp/calibracao-api";
import { paineisDoPerfil, podeVerPainel, semAcesso } from "@/lib/asp/dashboard-acesso";
import { hojeBrasil } from "@/lib/validacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dashboard de Gerência (Admin e Gerência). Filtros: ?periodo=&de=&ate=
 * &cliente=&procedimento=. Leitura via RLS (route client). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeVerPainel(profile.perfil, "gerencia")) {
    return NextResponse.json(semAcesso(profile.perfil), { status: 403 });
  }
  try {
    const supabase = getSupabaseRouteClient();
    const [dados, cal] = await Promise.all([
      carregarDadosDashboard(supabase),
      carregarCalibracao(supabase).catch((e: any) => ({ equipamentos: [], unidades: [], erro: String(e?.message || e) })),
    ]);
    const painel = montarGerencia(dados, cal, lerFiltros(req.nextUrl.searchParams), hojeBrasil());
    return NextResponse.json({ ok: true, painel, paineis: paineisDoPerfil(profile.perfil) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e: any) {
    return NextResponse.json({ erro: `Não foi possível montar o Dashboard: ${e?.message || e}` }, { status: 500 });
  }
}
