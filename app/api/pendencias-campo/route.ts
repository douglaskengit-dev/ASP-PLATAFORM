import { NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { carregarPendencias, silenciadoHoje } from "@/lib/asp/pendencias-campo-api";
import { pendenciasDoUsuario } from "@/lib/asp/pendencias-campo";
import { hojeBrasil } from "@/lib/validacao/formatos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Widget "Pendências de campo" do Dashboard: as OSs em execução hoje em que
 *  o usuário está na equipe agendada e falta foto ou o RDO do dia. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = getSupabaseRouteClient() as any;
  const hoje = hojeBrasil();
  const lista = await carregarPendencias(supabase, hoje);
  const minhas = pendenciasDoUsuario(lista, profile.id).map(({ equipe, ...p }) => p);
  const silenciado = await silenciadoHoje(supabase, profile.id, hoje).catch(() => false);
  return NextResponse.json({ ok: true, hoje, pendencias: minhas, silenciado });
}
