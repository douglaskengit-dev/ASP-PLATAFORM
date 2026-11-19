import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { faltaMigracaoCrm } from "@/lib/processos/crm-api";
import { podeUsarCrm } from "@/lib/validacao";

export const runtime = "nodejs";

const MSG_MIGRACAO = "Ligar a oportunidade ao projeto precisa da migração 20261118100000_asp_crm_propostas_projeto no Supabase.";

async function acesso() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "O Follow-up é do Comercial, da Gerência e da Administração." }, { status: 403 });
  }
  return null;
}

const diaDe = (p: { data_abertura?: string | null; criado_em?: string | null }) => (p.data_abertura || p.criado_em || "").slice(0, 10);
const distancia = (a: string, b: string) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) : Number.MAX_SAFE_INTEGER);

/** Projetos do cliente da oportunidade, para ligar uma ganha a um projeto que
 *  já existe. Os mais próximos da data do ganho vêm primeiro; os já ligados a
 *  outra oportunidade vêm marcados (não dá para ligar de novo). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const negado = await acesso();
  if (negado) return negado;
  const supabase = getSupabaseRouteClient();

  const { data: proc, error } = await supabase.from("gp_processos")
    .select("id, orgao_id, resultado_em, projeto_id").eq("id", params.id).maybeSingle();
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ erro: MSG_MIGRACAO }, { status: 409 });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!proc) return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });
  if (!proc.orgao_id) return NextResponse.json({ projetos: [], semCliente: true });

  const { data: projs, error: e2 } = await supabase.from("gp_projetos")
    .select("id, codigo_projeto, pedido_compra, data_abertura, criado_em")
    .eq("cliente_id", proc.orgao_id).is("excluido_em", null).limit(500);
  if (e2) return NextResponse.json({ erro: e2.message }, { status: 500 });
  const ids = (projs || []).map((p: any) => p.id);
  const ligados = new Map<string, string>();
  if (ids.length) {
    const { data: outros } = await supabase.from("gp_processos").select("id, titulo, projeto_id").in("projeto_id", ids).neq("id", params.id);
    (outros || []).forEach((o: any) => ligados.set(o.projeto_id, o.titulo || "outra oportunidade"));
  }
  const ref = (proc.resultado_em || "").slice(0, 10);
  const projetos = (projs || [])
    .map((p: any) => ({ id: p.id, codigo: p.codigo_projeto || null, pedido: p.pedido_compra || null, data: diaDe(p) || null, ligadoA: ligados.get(p.id) || null }))
    .sort((a: any, b: any) => (a.ligadoA ? 1 : 0) - (b.ligadoA ? 1 : 0) || distancia(a.data || "", ref) - distancia(b.data || "", ref));
  return NextResponse.json({ projetos });
}

/** Liga ({ projetoId }) ou desliga ({ projetoId: null }) o projeto da oportunidade ganha. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const negado = await acesso();
  if (negado) return negado;
  const corpo = (await req.json().catch(() => ({}))) as { projetoId?: unknown };
  const projetoId = typeof corpo.projetoId === "string" && corpo.projetoId ? corpo.projetoId : null;
  if (corpo.projetoId !== null && !projetoId) return NextResponse.json({ erro: "Escolha o projeto." }, { status: 400 });
  const supabase = getSupabaseRouteClient();

  const { data: proc, error } = await supabase.from("gp_processos")
    .select("id, orgao_id, resultado, projeto_id").eq("id", params.id).maybeSingle();
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ erro: MSG_MIGRACAO }, { status: 409 });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!proc) return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });

  if (projetoId) {
    if (proc.resultado !== "ganha") return NextResponse.json({ erro: "Só a oportunidade ganha é ligada a um projeto." }, { status: 400 });
    const { data: pj } = await supabase.from("gp_projetos").select("id, cliente_id").eq("id", projetoId).is("excluido_em", null).maybeSingle();
    if (!pj) return NextResponse.json({ erro: "Projeto não encontrado." }, { status: 404 });
    if (proc.orgao_id && pj.cliente_id !== proc.orgao_id) {
      return NextResponse.json({ erro: "O projeto é de outro cliente." }, { status: 400 });
    }
    const { data: outro } = await supabase.from("gp_processos").select("titulo").eq("projeto_id", projetoId).neq("id", params.id).limit(1).maybeSingle();
    if (outro) return NextResponse.json({ erro: `Este projeto já está ligado à oportunidade "${outro.titulo}".` }, { status: 409 });
  }

  const { data, error: e2 } = await supabase.from("gp_processos")
    .update({ projeto_id: projetoId, updated_at: new Date().toISOString() })
    .eq("id", params.id).select("id").maybeSingle();
  if (e2 && faltaMigracaoCrm(e2)) return NextResponse.json({ erro: MSG_MIGRACAO }, { status: 409 });
  if (e2) return NextResponse.json({ erro: e2.message }, { status: 500 });
  if (!data) return NextResponse.json({ erro: "Sem permissão para alterar esta oportunidade." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
