import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS = ["admin", "operacoes", "gerencia"];

/** Checklist de equipamentos de uma inspeção (um por etapa).
 *  GET ?inspecaoId=…  → devolve os dois (inspeção e execução), se existirem. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId");
  if (!inspecaoId) return NextResponse.json({ erro: "Inspeção obrigatória." }, { status: 400 });

  const { data, error } = await getSupabaseRouteClient()
    .from("gp_checklist_equipamentos").select("*").eq("inspecao_id", inspecaoId);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true, podeEditar: PERFIS.includes(profile.perfil), checklists: data || [],
  });
}

/** Cria ou substitui o checklist de uma etapa: { inspecaoId, tipo, procedimento, itens }. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Checklist é responsabilidade de Operações." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b?.inspecaoId || (b.tipo !== "inspecao" && b.tipo !== "execucao")) {
    return NextResponse.json({ erro: "Inspeção ou etapa inválida." }, { status: 400 });
  }
  const { data, error } = await getSupabaseRouteClient()
    .from("gp_checklist_equipamentos")
    .upsert({
      inspecao_id: b.inspecaoId, tipo: b.tipo,
      procedimento: b.procedimento || null,
      itens: b.itens || [],
      criado_por: profile.id,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "inspecao_id,tipo" })
    .select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, checklist: data });
}

/** Atualiza os itens (marcar/desmarcar, observação): { id, itens }. */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Checklist é responsabilidade de Operações." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b?.id) return NextResponse.json({ erro: "Checklist inválido." }, { status: 400 });
  const { data, error } = await getSupabaseRouteClient()
    .from("gp_checklist_equipamentos")
    .update({ itens: b.itens || [], atualizado_em: new Date().toISOString() })
    .eq("id", b.id).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, checklist: data });
}
