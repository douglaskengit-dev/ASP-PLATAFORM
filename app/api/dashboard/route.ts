import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { lerFiltros, montarDashboard } from "@/lib/asp/dashboard";
import { carregarDadosDashboard } from "@/lib/asp/dashboard-dados";
import { gerarLembretesRecorrencia } from "@/lib/asp/recorrencia-api";
import { hojeBrasil } from "@/lib/validacao";
import { paineisDoPerfil, podeVerPainel, semAcesso } from "@/lib/asp/dashboard-acesso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dashboard de Operações: um endpoint só, agregado no servidor.
 * Filtros por query string: ?periodo=7|30|90|ano|personalizado&de=&ate=
 * &cliente=<id>&procedimento=<código>&pessoa=<id>. Perfis: Admin, Gerência
 * e Operações (lib/asp/dashboard-acesso.ts); leitura via RLS (route client)
 * — ver lib/asp/dashboard-dados.ts. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeVerPainel(profile.perfil, "operacoes")) {
    return NextResponse.json(semAcesso(profile.perfil), { status: 403 });
  }
  const filtros = lerFiltros(req.nextUrl.searchParams);
  // Lembretes de serviço recorrente devidos (idempotente; sem cron).
  try { await gerarLembretesRecorrencia(); } catch { /* complementar */ }
  try {
    const dados = await carregarDadosDashboard(getSupabaseRouteClient());
    const painel = montarDashboard(dados, filtros, hojeBrasil());
    return NextResponse.json({ ok: true, painel, paineis: paineisDoPerfil(profile.perfil) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e: any) {
    return NextResponse.json({ erro: `Não foi possível montar o Dashboard: ${e?.message || e}` }, { status: 500 });
  }
}
