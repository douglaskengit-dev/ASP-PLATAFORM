import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { chaveDaPergunta } from "@/lib/assistente/cache";
import { hojeBrasil } from "@/lib/validacao/formatos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS: Record<string, (q: any) => any> = {
  negativas: (q) => q.eq("avaliacao", -1),
  positivas: (q) => q.eq("avaliacao", 1),
  recusas: (q) => q.eq("fora_do_escopo", true),
  reservas: (q) => q.eq("reserva", true),
  todas: (q) => q,
};

const COLUNAS_USO = "criado_em, pergunta, provedor, usuario_id, avaliacao, fora_do_escopo, reserva, usuario:gp_profiles(nome_completo)";
const diaBrasilia = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Uso no período: perguntas e chamadas à IA por dia, hoje, perguntas e
 *  pessoas que mais usam, provedores e tempo médio. */
function montarUso(linhas: any[], dias: number) {
  const hoje = hojeBrasil();
  const porDia = new Map<string, { perguntas: number; chamadas: number }>();
  for (let i = dias - 1; i >= 0; i--) porDia.set(new Date(Date.parse(hoje + "T12:00:00Z") - i * 86400000).toISOString().slice(0, 10), { perguntas: 0, chamadas: 0 });
  const perguntas = new Map<string, { pergunta: string; vezes: number }>();
  const pessoas = new Map<string, { nome: string; perguntas: number }>();
  const provedores: Record<string, number> = {};
  let duracao = 0, comDuracao = 0;
  for (const l of linhas) {
    const d = porDia.get(diaBrasilia(l.criado_em));
    if (d) { d.perguntas++; d.chamadas += l.chamadas_ia || 0; }
    const k = chaveDaPergunta(l.pergunta || "");
    const p = perguntas.get(k) || { pergunta: l.pergunta, vezes: 0 };
    p.vezes++; perguntas.set(k, p);
    const u = pessoas.get(l.usuario_id) || { nome: l.usuario?.nome_completo || "—", perguntas: 0 };
    u.perguntas++; pessoas.set(l.usuario_id, u);
    provedores[l.provedor || "—"] = (provedores[l.provedor || "—"] || 0) + 1;
    if (typeof l.duracao_ms === "number" && (l.chamadas_ia || 0) > 0) { duracao += l.duracao_ms; comDuracao++; }
  }
  const hojeUso = porDia.get(hoje) || { perguntas: 0, chamadas: 0 };
  return {
    por_dia: Array.from(porDia, ([dia, v]) => ({ dia, ...v })),
    hoje: hojeUso,
    tem_chamadas: linhas.some((l) => "chamadas_ia" in l),
    tempo_medio_s: comDuracao ? Math.round(duracao / comDuracao / 100) / 10 : null,
    top_perguntas: Array.from(perguntas.values()).filter((p) => p.vezes > 1).sort((a, b) => b.vezes - a.vezes).slice(0, 10),
    top_pessoas: Array.from(pessoas.values()).sort((a, b) => b.perguntas - a.perguntas).slice(0, 10),
    provedores,
  };
}

/** Admin: respostas do robô dos últimos `dias` (padrão 30), o resumo do
 *  período (total, 👍, 👎, recusas, respostas de reserva) e o uso. */
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
    sb.from("gp_assistente_respostas").select(`${COLUNAS_USO}, chamadas_ia, duracao_ms`).gte("criado_em", desde).limit(10000)
      // sem as colunas de uso (migração 20261111 não aplicada)
      .then((r) => (r.error && /chamadas_ia|duracao_ms/.test(r.error.message)
        ? sb.from("gp_assistente_respostas").select(COLUNAS_USO).gte("criado_em", desde).limit(10000) : r)),
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
    uso: montarUso(r, dias),
    respostas: lista.data || [],
  });
}
