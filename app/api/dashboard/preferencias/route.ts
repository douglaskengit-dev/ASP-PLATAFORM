import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { podeVerPainel, type PainelId } from "@/lib/asp/dashboard-acesso";
import { faltaMigracaoCrm } from "@/lib/processos/crm-api";

export const runtime = "nodejs";

const PAINEIS: PainelId[] = ["operacoes", "gerencia", "comercial"];
const lerPainel = (v: unknown): PainelId | null => (PAINEIS.includes(v as PainelId) ? (v as PainelId) : null);

/** Configuração do Dashboard do usuário logado (?painel=). Sem a migração
 *  20261125100000 responde semTabela, e a tela usa só o navegador. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const painel = lerPainel(req.nextUrl.searchParams.get("painel"));
  if (!painel) return NextResponse.json({ erro: "Painel inválido." }, { status: 400 });
  if (!podeVerPainel(profile.perfil, painel)) return NextResponse.json({ erro: "Sem acesso a este Dashboard." }, { status: 403 });
  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_dashboard_preferencias").select("config")
    .eq("usuario_id", profile.id).eq("painel", painel).maybeSingle();
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ ok: true, config: null, semTabela: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, config: data?.config ?? null });
}

/** Grava a configuração. Body: { painel, config } (objeto pequeno; a tela
 *  valida as chaves ao ler). config null apaga (volta ao padrão). */
export async function PUT(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const painel = lerPainel(corpo.painel);
  if (!painel) return NextResponse.json({ erro: "Painel inválido." }, { status: 400 });
  if (!podeVerPainel(profile.perfil, painel)) return NextResponse.json({ erro: "Sem acesso a este Dashboard." }, { status: 403 });
  const supabase = getSupabaseRouteClient();
  if (corpo.config === null) {
    const { error } = await supabase.from("gp_dashboard_preferencias").delete().eq("usuario_id", profile.id).eq("painel", painel);
    if (error && faltaMigracaoCrm(error)) return NextResponse.json({ ok: true, semTabela: true });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof corpo.config !== "object" || Array.isArray(corpo.config)) return NextResponse.json({ erro: "Configuração inválida." }, { status: 400 });
  if (JSON.stringify(corpo.config).length > 8000) return NextResponse.json({ erro: "Configuração grande demais." }, { status: 400 });
  const { error } = await supabase.from("gp_dashboard_preferencias")
    .upsert({ usuario_id: profile.id, painel, config: corpo.config, atualizado_em: new Date().toISOString() });
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ ok: true, semTabela: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
