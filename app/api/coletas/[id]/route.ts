import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_COLETA = ["admin", "operacoes", "gerencia"];

/** Atualiza a medição (dados jsonb) de uma coleta — permite reabrir e editar
 * o registro salvo pelo medidor. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_COLETA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta é responsabilidade de Operações." }, { status: 403 });
  }

  const body = await req.json();
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if ("dados" in body) patch.dados = body.dados ?? {};
  if (typeof body.tipo === "string" && body.tipo.trim()) patch.tipo = body.tipo.trim();
  // Restaurar da lixeira (dentro dos 30 dias).
  if (body.restaurar === true) { patch.excluido_em = null; patch.excluido_por = null; }

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_coletas").update(patch).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, coleta: data });
}

/** Exclui a medição. Padrão do sistema: vai para a lixeira (recuperável por
 * 30 dias). Com ?definitivo=1, apaga de vez. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_COLETA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta é responsabilidade de Operações." }, { status: 403 });
  }

  const supabase = getSupabaseRouteClient();
  if (req.nextUrl.searchParams.get("definitivo") === "1") {
    const { error } = await supabase.from("gp_coletas").delete().eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, definitivo: true });
  }

  const { error } = await supabase
    .from("gp_coletas")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}
