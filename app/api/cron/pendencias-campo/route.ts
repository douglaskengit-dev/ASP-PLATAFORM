import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarAvisosPendencias } from "@/lib/asp/pendencias-campo-api";
import { TURNOS_AVISO, type TurnoAviso } from "@/lib/asp/pendencias-campo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chamada pela rotina do banco (pg_cron + pg_net) às 11h, 16h e 17h30 de
 * Brasília: POST { turno } com o cabeçalho x-cron-token. O token é gerado
 * pela própria migração e fica em gp_config_interna (sem RLS liberado) —
 * nenhum segredo precisa ser copiado para a Vercel.
 */
export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin();
  const recebido = req.headers.get("x-cron-token") || "";
  const { data } = await admin.from("gp_config_interna").select("valor").eq("chave", "cron_token").maybeSingle();
  const esperado = String((data as any)?.valor || "");
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  if (!esperado || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const corpo = await req.json().catch(() => ({}));
  const turno = String(corpo?.turno || req.nextUrl.searchParams.get("turno") || "") as TurnoAviso;
  if (!TURNOS_AVISO.includes(turno)) return NextResponse.json({ erro: "Turno inválido." }, { status: 400 });
  const r = await enviarAvisosPendencias(admin, turno);
  return NextResponse.json({ ok: true, ...r });
}
