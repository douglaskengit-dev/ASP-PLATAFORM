import { NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { gerarLembretesRecorrencia, situacaoRecorrencia } from "@/lib/asp/recorrencia-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lembretes de serviço recorrente: gera os devidos (idempotente — um por
 *  cliente e vencimento, ver lib/asp/recorrencia-api.ts) e devolve a
 *  situação de cada cliente recorrente. Comercial, Gerência e Admin. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!["comercial", "gerencia", "admin"].includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }
  try {
    const { gerados } = await gerarLembretesRecorrencia({ forcar: true });
    const situacoes = Array.from((await situacaoRecorrencia()).values())
      .sort((a, b) => (a.proximo.vencimento || "9999").localeCompare(b.proximo.vencimento || "9999"));
    return NextResponse.json({ ok: true, gerados, clientes: situacoes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e: any) {
    return NextResponse.json({ erro: `Não foi possível gerar os lembretes: ${e?.message || e}` }, { status: 500 });
  }
}
