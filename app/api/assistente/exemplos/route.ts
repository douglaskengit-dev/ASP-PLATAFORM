import { NextRequest, NextResponse } from "next/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exemplos aprovados do robô (vão no prompt para todos). Só o admin mexe;
 *  o RLS confere de novo. */
async function exigirAdmin(req: NextRequest, escrita: boolean) {
  if (escrita && !mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (profile.perfil !== "admin") return NextResponse.json({ erro: "Somente o administrador." }, { status: 403 });
  return null;
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET(req: NextRequest) {
  const negado = await exigirAdmin(req, false);
  if (negado) return negado;
  const { data, error } = await getSupabaseRouteClient().from("gp_assistente_exemplos")
    .select("id, pergunta, resposta, ativo, origem_id, atualizado_em").order("atualizado_em", { ascending: false });
  if (error) return NextResponse.json({ erro: "Falha ao carregar os exemplos." }, { status: 500 });
  return NextResponse.json({ ok: true, exemplos: data || [] });
}

/** Cria (sem id) ou altera (com id) um exemplo. */
export async function POST(req: NextRequest) {
  const negado = await exigirAdmin(req, true);
  if (negado) return negado;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const pergunta = texto(b?.pergunta, 1000), resposta = texto(b?.resposta, 4000);
  if (!pergunta || !resposta) return NextResponse.json({ erro: "Preencha a pergunta e a resposta." }, { status: 400 });
  const campos: Record<string, unknown> = { pergunta, resposta, atualizado_em: new Date().toISOString() };
  if (typeof b?.ativo === "boolean") campos.ativo = b.ativo;
  const sb = getSupabaseRouteClient();
  const q = typeof b?.id === "string"
    ? sb.from("gp_assistente_exemplos").update(campos).eq("id", b.id)
    : sb.from("gp_assistente_exemplos").insert({ ...campos, origem_id: typeof b?.origem_id === "string" ? b.origem_id : null });
  const { error } = await q;
  if (error) return NextResponse.json({ erro: "Não foi possível salvar o exemplo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const negado = await exigirAdmin(req, true);
  if (negado) return negado;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "Informe o exemplo." }, { status: 400 });
  const { error } = await getSupabaseRouteClient().from("gp_assistente_exemplos").delete().eq("id", id);
  if (error) return NextResponse.json({ erro: "Não foi possível excluir." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
