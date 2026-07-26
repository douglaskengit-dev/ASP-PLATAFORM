import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

/** Detalhe do projeto + suas inspeções. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: projeto, error } = await supabase
    .from("gp_projetos")
    .select("*, cliente:gp_orgaos(id, razao_social, cidade, uf, cnpj)")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });

  const { data: inspecoesRaw } = await supabase
    .from("gp_inspecoes")
    .select("*, agendamentos:gp_agendamentos(data_visita, hora, tipo)")
    .eq("projeto_id", params.id)
    .order("criado_em", { ascending: true });

  const inspecoes = inspecoesRaw || [];

  // Última movimentação (histórico) por inspeção — para o resumo no projeto.
  const ids = inspecoes.map((i: any) => i.id);
  if (ids.length > 0) {
    const { data: hist } = await supabase
      .from("gp_fase_historico")
      .select("inspecao_id, acao, fase_de, fase_para, data_autenticacao, criado_em, autor_perfil:gp_profiles!autor(nome_completo, email)")
      .in("inspecao_id", ids)
      .order("data_autenticacao", { ascending: false });
    const ultimaPorInspecao = new Map<string, any>();
    (hist || []).forEach((h: any) => { if (!ultimaPorInspecao.has(h.inspecao_id)) ultimaPorInspecao.set(h.inspecao_id, h); });
    inspecoes.forEach((i: any) => { i.ultima_acao = ultimaPorInspecao.get(i.id) || null; });
  }

  return NextResponse.json({ ok: true, projeto, inspecoes });
}

/** Atualiza campos do projeto (Comercial/Gerência/Admin). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!["admin", "comercial", "gerencia"].includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = await req.json();
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  for (const [campo, coluna] of [
    ["clienteId", "cliente_id"],
    ["codigoProjeto", "codigo_projeto"],
    ["pedidoCompra", "pedido_compra"],
    ["endereco", "endereco"],
    ["responsavelProjeto", "responsavel_projeto"],
  ] as const) {
    if (campo in body) patch[coluna] = body[campo] || null;
  }

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_projetos").update(patch).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, projeto: data });
}
