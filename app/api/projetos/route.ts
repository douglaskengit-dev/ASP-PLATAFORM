import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_ESCRITA = ["admin", "comercial", "gerencia"];

/** Lista projetos com o cliente (órgão) e a contagem de inspeções. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_projetos")
    .select("*, cliente:gp_orgaos(id, razao_social, cidade, uf), inspecoes:gp_inspecoes(id, fase)")
    .order("criado_em", { ascending: false });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const projetos = (data || []).map((p: any) => ({
    ...p,
    inspecoes_total: (p.inspecoes || []).length,
  }));
  return NextResponse.json({ ok: true, projetos });
}

interface NovoProjetoBody {
  clienteId?: string | null;
  codigoProjeto?: string;
  pedidoCompra?: string;
  endereco?: string;
  responsavelProjeto?: string;
  dataAbertura?: string;
}

/** Abre um novo projeto (fase 1 — Comercial). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ESCRITA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para abrir projetos (Comercial/Gerência/Admin)." }, { status: 403 });
  }

  const body = (await req.json()) as NovoProjetoBody;
  if (!body.pedidoCompra?.trim() && !body.codigoProjeto?.trim()) {
    return NextResponse.json({ erro: "Informe ao menos o pedido de compra ou o código do projeto." }, { status: 400 });
  }

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_projetos")
    .insert({
      cliente_id: body.clienteId || null,
      codigo_projeto: body.codigoProjeto?.trim() || null,
      pedido_compra: body.pedidoCompra?.trim() || null,
      endereco: body.endereco?.trim() || null,
      responsavel_projeto: body.responsavelProjeto?.trim() || null,
      data_abertura: body.dataAbertura || undefined,
      criado_por: profile.id,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, projeto: data });
}
