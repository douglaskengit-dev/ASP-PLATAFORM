import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS: Record<string, (q: any) => any> = {
  negativas: (q) => q.eq("avaliacao", -1),
  positivas: (q) => q.eq("avaliacao", 1),
  recusas: (q) => q.eq("fora_do_escopo", true),
  reservas: (q) => q.eq("reserva", true),
  todas: (q) => q,
};

/** Admin: respostas do robô dos últimos `dias` (padrão 30) e o resumo do
 *  período (total, 👍, 👎, recusas, respostas de reserva). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (profile.perfil !== "admin") return NextResponse.json({ erro: "Somente o administrador." }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const dias = Math.min(365, Math.max(1, Number(p.get("dias")) || 30));
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const filtro = FILTROS[p.get("filtro") || "negativas"] || FILTROS.negativas;
  const sb = getSupabaseRouteClient();

  const [lista, resumo] = await Promise.all([
    filtro(sb.from("gp_assistente_respostas")
      .select("id, pergunta, resposta, pagina, consultas, fora_do_escopo, reserva, provedor, avaliacao, comentario, criado_em, usuario:gp_profiles(nome_completo, perfil)")
      .gte("criado_em", desde)).order("criado_em", { ascending: false }).limit(200),
    sb.from("gp_assistente_respostas").select("avaliacao, fora_do_escopo, reserva").gte("criado_em", desde).limit(10000),
  ]);
  if (lista.error || resumo.error) {
    const msg = (lista.error || resumo.error)!.message;
    const ausente = /gp_assistente_respostas/.test(msg) && /exist|schema cache/i.test(msg);
    return NextResponse.json({ erro: ausente ? "A tabela de avaliações ainda não existe: aplique a migração 20261109100000_asp_assistente_avaliacoes.sql." : "Falha ao carregar." }, { status: ausente ? 503 : 500 });
  }
  const r = resumo.data || [];
  return NextResponse.json({
    ok: true, dias,
    resumo: {
      total: r.length,
      positivas: r.filter((x: any) => x.avaliacao === 1).length,
      negativas: r.filter((x: any) => x.avaliacao === -1).length,
      recusas: r.filter((x: any) => x.fora_do_escopo).length,
      reservas: r.filter((x: any) => x.reserva).length,
    },
    respostas: lista.data || [],
  });
}
