import { NextRequest, NextResponse } from "next/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { esquecerResposta } from "@/lib/assistente/cache";

export const runtime = "nodejs";

/** 👍/👎 de quem perguntou numa resposta do robô (o RLS só deixa avaliar as
 *  próprias). avaliacao null desfaz. */
export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { id?: unknown; avaliacao?: unknown; comentario?: unknown } | null;
  if (typeof b?.id !== "string" || ![1, -1, null].includes(b.avaliacao as any)) {
    return NextResponse.json({ erro: "Avaliação inválida." }, { status: 400 });
  }
  const comentario = typeof b.comentario === "string" ? b.comentario.trim().slice(0, 1000) || null : null;
  const { data, error } = await getSupabaseRouteClient().from("gp_assistente_respostas")
    .update({ avaliacao: b.avaliacao, comentario: b.avaliacao === -1 ? comentario : null, avaliado_em: b.avaliacao === null ? null : new Date().toISOString() })
    .eq("id", b.id).select("id, resposta");
  if (error) return NextResponse.json({ erro: "Não foi possível salvar a avaliação." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ erro: "Resposta não encontrada." }, { status: 404 });
  // resposta ruim não volta a ser servida das respostas guardadas
  if (b.avaliacao === -1) await esquecerResposta((data[0] as any).resposta);
  return NextResponse.json({ ok: true });
}
