import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { escolherUltimaInspecao, type CandidataInspecao } from "@/lib/asp/ultima-inspecao";

export const runtime = "nodejs";

/** Em lotes (URL curta no PostgREST). */
async function porLotes(ids: string[], ler: (lote: string[]) => any): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await ler(ids.slice(i, i + 100));
    out.push(...((data || []) as any[]));
  }
  return out;
}

/** "Última inspeção" de uma OS (usado no painel da OS SEM inspeção): a
 *  inspeção mais recente do MESMO tanque (mesma identificação normalizada
 *  nos projetos ativos do cliente) ou, sem ela, do cliente. Só leitura,
 *  pela sessão do usuário (RLS). Regras em lib/asp/ultima-inspecao.ts. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  const supabase = getSupabaseRouteClient();

  const { data: os } = await supabase.from("gp_inspecoes")
    .select("id, identificacao, projeto:gp_projetos(id, cliente_id)").eq("id", params.id).maybeSingle();
  if (!os) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  const clienteId = (os as any).projeto?.cliente_id;
  if (!clienteId) return NextResponse.json({ ok: true, ultima: null, semCliente: true });

  const { data: projetos } = await supabase.from("gp_projetos")
    .select("id, codigo_projeto, pedido_compra").eq("cliente_id", clienteId).is("excluido_em", null);
  const projs = new Map(((projetos || []) as any[]).map((p) => [p.id, p]));
  if (!projs.size) return NextResponse.json({ ok: true, ultima: null });

  // "*": com_inspecao sem quebrar antes da migração.
  const oss = await porLotes(Array.from(projs.keys()), (lote) =>
    supabase.from("gp_inspecoes").select("*").in("projeto_id", lote).is("excluido_em", null));
  const ids = oss.map((o) => o.id as string).filter((x) => x !== params.id);
  if (!ids.length) return NextResponse.json({ ok: true, ultima: null });

  const [rels, coletas, visitas] = await Promise.all([
    porLotes(ids, (lote) => supabase.from("gp_relatorios")
      .select("id, inspecao_id, versao, status, enviado_em, avaliado_em, assinado_em, assinado_path")
      .in("inspecao_id", lote).eq("tipo", "inspecao").is("excluido_em", null)),
    porLotes(ids, (lote) => supabase.from("gp_coletas")
      .select("id, inspecao_id, tipo, aprovada_em, data_coleta, pdf_path")
      .in("inspecao_id", lote).is("excluido_em", null)),
    porLotes(ids, (lote) => supabase.from("gp_agendamentos")
      .select("inspecao_id, data_visita").in("inspecao_id", lote).eq("tipo", "inspecao").is("substituido_em", null)),
  ]);
  const de = <T extends { inspecao_id: string }>(lista: T[], id: string) => lista.filter((x) => x.inspecao_id === id);
  const candidatas: CandidataInspecao[] = oss.filter((o) => o.id !== params.id).map((o) => {
    const p = projs.get(o.projeto_id);
    return {
      id: o.id, identificacao: o.identificacao, comInspecao: o.com_inspecao !== false,
      projetoId: o.projeto_id, projetoCodigo: p?.codigo_projeto || p?.pedido_compra || "Projeto",
      tanque: o.tanque ?? null,
      relatorios: de(rels, o.id).map((r) => ({ ...r, versao: Number(r.versao) || 0 })),
      coletas: de(coletas, o.id),
      visitas: de(visitas, o.id),
    };
  });
  return NextResponse.json({ ok: true, ultima: escolherUltimaInspecao((os as any).identificacao, candidatas, params.id) });
}
