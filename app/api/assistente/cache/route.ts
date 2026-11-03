import { NextRequest, NextResponse } from "next/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { getProfileAtual } from "@/lib/supabase/route";
import { limparCache } from "@/lib/assistente/cache";

export const runtime = "nodejs";

/** Admin: apaga todas as respostas guardadas das dúvidas de uso. */
export async function DELETE(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (profile.perfil !== "admin") return NextResponse.json({ erro: "Somente o administrador." }, { status: 403 });
  return (await limparCache())
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ erro: "Não foi possível limpar as respostas guardadas." }, { status: 500 });
}
