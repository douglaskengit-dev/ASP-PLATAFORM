import { NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { hojeBrasil } from "@/lib/validacao/formatos";

export const runtime = "nodejs";

/** "Não avisar mais hoje" — do botão da notificação (sw.js) ou do widget.
 *  Vale só para o dia de hoje; amanhã os avisos voltam sozinhos. */
export async function POST() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const { error } = await (getSupabaseRouteClient() as any).from("gp_pendencias_campo_silencio")
    .upsert({ usuario_id: profile.id, data: hojeBrasil() }, { onConflict: "usuario_id,data", ignoreDuplicates: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, silenciado: true });
}

/** Voltar a avisar hoje. */
export async function DELETE() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const { error } = await (getSupabaseRouteClient() as any).from("gp_pendencias_campo_silencio")
    .delete().eq("usuario_id", profile.id).eq("data", hojeBrasil());
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, silenciado: false });
}
