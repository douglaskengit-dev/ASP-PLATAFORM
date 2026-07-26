import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_AGENDA = ["admin", "comercial", "gerencia"];

/** Edita um agendamento existente. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!PERFIS_AGENDA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Agendamento é responsabilidade do Comercial." }, { status: 403 });
  }

  const body = await req.json();
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if ("dataVisita" in body) patch.data_visita = body.dataVisita || null;
  if ("dataExecucao" in body) patch.data_execucao = body.dataExecucao || null;
  if ("hora" in body) patch.hora = body.hora?.trim() || null;
  if ("equipe" in body) patch.equipe = (body.equipe || []).filter((m: any) => m && m.id);
  if ("equipamentos" in body) patch.equipamentos = body.equipamentos || [];
  if ("checklist" in body) patch.checklist = body.checklist || [];

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_agendamentos").update(patch).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, agendamento: data });
}

/** Remove um agendamento. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!PERFIS_AGENDA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Agendamento é responsabilidade do Comercial." }, { status: 403 });
  }
  const supabase = getSupabaseRouteClient();
  const { error } = await supabase.from("gp_agendamentos").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
