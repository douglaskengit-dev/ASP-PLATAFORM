import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_EDICAO = ["admin", "comercial", "gerencia", "operacoes"];

/** Aviso do cliente: texto único que vale para todos os projetos e inspeções
 *  dele. GET ?clienteId=… */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const clienteId = req.nextUrl.searchParams.get("clienteId");
  if (!clienteId) return NextResponse.json({ erro: "Cliente obrigatório." }, { status: 400 });

  const { data, error } = await getSupabaseRouteClient()
    .from("gp_orgaos").select("id, razao_social, avisos").eq("id", clienteId).single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true, podeEditar: PERFIS_EDICAO.includes(profile.perfil),
    cliente: data?.razao_social || "", avisos: data?.avisos || "",
  });
}

/** Grava o aviso: { clienteId, avisos }. */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar avisos." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b?.clienteId) return NextResponse.json({ erro: "Cliente obrigatório." }, { status: 400 });

  const { error } = await getSupabaseRouteClient()
    .from("gp_orgaos").update({ avisos: (b.avisos || "").trim() || null }).eq("id", b.clienteId);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
