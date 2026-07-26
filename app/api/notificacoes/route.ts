import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

/** Notificações in-app do usuário logado (mais recentes primeiro). */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_notificacoes")
    .select("*")
    .eq("usuario_id", profile.id)
    .order("criado_em", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, notificacoes: data || [] });
}

/** Marca notificações como lidas: { ids: [...] } ou { todas: true }. */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const body = await req.json();
  const supabase = getSupabaseRouteClient();
  let query = supabase.from("gp_notificacoes").update({ lida: true }).eq("usuario_id", profile.id);
  if (Array.isArray(body.ids) && body.ids.length > 0) query = query.in("id", body.ids);
  else if (!body.todas) return NextResponse.json({ ok: true });
  const { error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
