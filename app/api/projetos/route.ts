import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";

export const runtime = "nodejs";

const PERFIS_ESCRITA = ["admin", "comercial", "gerencia"];
const DIAS_LIXEIRA = 30;

/** Lista projetos com o cliente e a contagem de inspeções.
 * ?lixeira=1 lista os excluídos (recuperáveis). Faz limpeza preguiçosa dos
 * que passaram de 30 dias na lixeira. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const lixeira = req.nextUrl.searchParams.get("lixeira") === "1";

  // Limpeza preguiçosa: apaga de vez o que passou de 30 dias na lixeira.
  const corte = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
  await getSupabaseAdmin().from("gp_projetos").delete().lt("excluido_em", corte);

  const supabase = getSupabaseRouteClient();
  let query = supabase
    .from("gp_projetos")
    .select("*, cliente:gp_orgaos(id, razao_social, cidade, uf), inspecoes:gp_inspecoes(id, fase, excluido_em)")
    .order(lixeira ? "excluido_em" : "criado_em", { ascending: false });
  query = lixeira ? query.not("excluido_em", "is", null) : query.is("excluido_em", null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const projetos = (data || []).map((p: any) => {
    const inspecoes = (p.inspecoes || []).filter((i: any) => !i.excluido_em);
    return { ...p, inspecoes, inspecoes_total: inspecoes.length };
  });
  return NextResponse.json({ ok: true, projetos, podeExcluir: podeExcluirProjeto(profile), diasLixeira: DIAS_LIXEIRA });
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
