import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { faltaMigracaoCrm, MSG_MIGRACAO_CRM } from "@/lib/processos/crm-api";
import { hojeBrasil, podeUsarCrm, validarAtividade } from "@/lib/validacao";

export const runtime = "nodejs";

const SEM_ACESSO = { erro: "O Follow-up é do Comercial, da Gerência e da Administração." };

/** Linha do tempo da oportunidade: ligações, e-mails, reuniões, visitas e
 * anotações (mais recentes primeiro). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) return NextResponse.json(SEM_ACESSO, { status: 403 });
  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_processo_atividades")
    .select("id, tipo, descricao, data, criado_em, criado_por, autor:gp_profiles!gp_processo_atividades_criado_por_fkey(nome_completo)")
    .eq("processo_id", params.id).order("data", { ascending: false }).order("criado_em", { ascending: false });
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ ok: true, atividades: [], aviso: MSG_MIGRACAO_CRM });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    atividades: (data || []).map((a: any) => ({
      id: a.id, tipo: a.tipo, descricao: a.descricao, data: a.data, criado_em: a.criado_em,
      autor: a.autor?.nome_completo || null, minha: a.criado_por === profile.id,
    })),
  });
}

/** Registra uma atividade já feita. Body: { tipo, data, descricao }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) return NextResponse.json(SEM_ACESSO, { status: 403 });
  const v = validarAtividade((await req.json().catch(() => ({}))) as Record<string, unknown>, hojeBrasil());
  if ("erro" in v) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_processo_atividades")
    .insert({ processo_id: params.id, tipo: v.tipo, data: v.data, descricao: v.descricao, criado_por: profile.id })
    .select("id").single();
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ erro: MSG_MIGRACAO_CRM }, { status: 409 });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  await supabase.from("gp_processos").update({ updated_at: new Date().toISOString() }).eq("id", params.id);
  return NextResponse.json({ ok: true, id: data.id });
}

/** Apaga uma atividade (?atividade=<id>): o autor ou um administrador. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) return NextResponse.json(SEM_ACESSO, { status: 403 });
  const id = req.nextUrl.searchParams.get("atividade");
  if (!id) return NextResponse.json({ erro: "Atividade não informada." }, { status: 400 });
  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_processo_atividades").delete()
    .eq("id", id).eq("processo_id", params.id).select("id");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ erro: "Atividade não encontrada ou de outra pessoa." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
