import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarAvisosCalibracao } from "@/lib/asp/calibracao-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chamada pela rotina do banco (pg_cron + pg_net) todo dia às 8h de
 * Brasília, com o cabeçalho x-cron-token (o mesmo token das pendências de
 * campo, em gp_config_interna). Avisa todos os usuários ativos das
 * calibrações que vencem em 30 dias, 7 dias, hoje, ou que estão vencidas
 * (uma vez por semana).
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
  const r = await enviarAvisosCalibracao(admin);
  return NextResponse.json({ ok: !("erro" in r && r.erro), ...r });
}
