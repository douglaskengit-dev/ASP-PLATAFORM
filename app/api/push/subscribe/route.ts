import { NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Registra (ou atualiza) a assinatura Web Push do dispositivo atual para o
 *  usuário logado. Uma assinatura por endpoint. */
export async function POST(req: Request) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ erro: "Assinatura inválida." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  // Remove eventual registro anterior do mesmo endpoint (troca de usuário/reinscrição).
  await admin.from("gp_push_subscriptions").delete().eq("endpoint", sub.endpoint);
  const { error } = await admin.from("gp_push_subscriptions").insert({
    usuario_id: profile.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
  });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
