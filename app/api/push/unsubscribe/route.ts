import { NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Remove a assinatura Web Push do dispositivo atual (por endpoint). */
export async function POST(req: Request) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (endpoint) {
    const admin = getSupabaseAdmin();
    await admin
      .from("gp_push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("usuario_id", profile.id);
  }
  return NextResponse.json({ ok: true });
}
