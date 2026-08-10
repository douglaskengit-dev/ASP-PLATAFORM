import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";

export const runtime = "nodejs";

/** PATCH: restaurar da lixeira ({ restaurar: true }) ou renomear a inspeção
 *  ({ identificacao }). O título é usado no relatório (campo TAG) e nos nomes
 *  dos arquivos gerados, por isso vale corrigi-lo sem refazer a inspeção. */
const PERFIS_EDICAO = ["admin", "operacoes", "gerencia", "comercial"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const body = await req.json();

  if (typeof body.identificacao === "string") {
    if (!PERFIS_EDICAO.includes(profile.perfil)) {
      return NextResponse.json({ erro: "Sem permissão para renomear a inspeção." }, { status: 403 });
    }
    const titulo = body.identificacao.trim();
    if (!titulo) return NextResponse.json({ erro: "Informe o título da inspeção." }, { status: 400 });
    if (titulo.length > 160) {
      return NextResponse.json({ erro: "Título muito longo (máx. 160 caracteres)." }, { status: 400 });
    }
    const { data, error } = await getSupabaseAdmin()
      .from("gp_inspecoes")
      .update({ identificacao: titulo, atualizado_em: new Date().toISOString() })
      .eq("id", params.id)
      .select("id, identificacao")
      .single();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, inspecao: data });
  }

  if (!podeExcluirProjeto(profile)) return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  if (!body.restaurar) return NextResponse.json({ ok: true });
  const { error } = await getSupabaseAdmin()
    .from("gp_inspecoes")
    .update({ excluido_em: null, excluido_por: null, atualizado_em: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Exclusão da inspeção — lixeira (soft) por padrão; ?definitivo=1 apaga. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!podeExcluirProjeto(profile)) return NextResponse.json({ erro: "Você não tem permissão para excluir inspeções." }, { status: 403 });
  const admin = getSupabaseAdmin();
  if (req.nextUrl.searchParams.get("definitivo") === "1") {
    const { error } = await admin.from("gp_inspecoes").delete().eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, definitivo: true });
  }
  const { error } = await admin
    .from("gp_inspecoes")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}

/** Detalhe da inspeção com coletas, agendamentos, relatórios e histórico. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: inspecao, error } = await supabase
    .from("gp_inspecoes")
    .select("*, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, cliente:gp_orgaos(id, razao_social))")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });

  // Purga preguiçosa da lixeira de coletas: apaga o que passou de 30 dias.
  const corteColetas = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await getSupabaseAdmin().from("gp_coletas").delete().lt("excluido_em", corteColetas);

  const [coletas, agendamentos, relatorios, historico] = await Promise.all([
    supabase.from("gp_coletas").select("*").eq("inspecao_id", params.id).is("excluido_em", null).order("criado_em", { ascending: false }),
    supabase.from("gp_agendamentos").select("*").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
    supabase.from("gp_relatorios").select("*").eq("inspecao_id", params.id).is("excluido_em", null).order("versao", { ascending: false }),
    supabase.from("gp_fase_historico").select("*, autor_perfil:gp_profiles!autor(nome_completo, email)").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
  ]);

  return NextResponse.json({
    ok: true,
    inspecao,
    coletas: coletas.data || [],
    agendamentos: agendamentos.data || [],
    relatorios: relatorios.data || [],
    historico: historico.data || [],
  });
}
