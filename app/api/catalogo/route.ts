import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_EDICAO = ["admin", "operacoes", "gerencia"];
const TABELA = { equipamento: "gp_equipamentos", procedimento: "gp_procedimentos" } as const;
type Tipo = keyof typeof TABELA;

function tabelaDe(t: any): string | null {
  return t === "equipamento" || t === "procedimento" ? TABELA[t as Tipo] : null;
}

/** O CÓDIGO do procedimento é a chave usada em toda parte: é ele que a
 *  inspeção guarda e que o relatório imprime. Sem código, o procedimento fica
 *  indistinguível de "não definido" nos seletores — por isso é obrigatório.
 *  Também aparamos espaços, que causariam desencontro na comparação. */
function validarProcedimento(dados: any): string | null {
  if (!dados) return "Dados do procedimento ausentes.";
  if (typeof dados.codigo !== "string" || !dados.codigo.trim()) {
    return "Informe o código do procedimento (ex.: PO 011). Ele identifica o procedimento na inspeção e no relatório.";
  }
  dados.codigo = dados.codigo.trim();
  if (typeof dados.nome === "string") dados.nome = dados.nome.trim();
  return null;
}

/** Catálogo completo (procedimentos + equipamentos) para telas e relatório. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = getSupabaseRouteClient();
  const [eq, pr] = await Promise.all([
    supabase.from("gp_equipamentos").select("*").order("ordem").order("nome"),
    supabase.from("gp_procedimentos").select("*").order("ordem").order("codigo"),
  ]);
  return NextResponse.json({
    ok: true,
    podeEditar: PERFIS_EDICAO.includes(profile.perfil),
    equipamentos: eq.data || [],
    procedimentos: pr.data || [],
  });
}

/** Cria um item: { tipo, dados }. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o catálogo." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const tabela = tabelaDe(body?.tipo);
  if (!tabela) return NextResponse.json({ erro: "Tipo inválido." }, { status: 400 });
  if (body.tipo === "procedimento") {
    const problema = validarProcedimento(body.dados);
    if (problema) return NextResponse.json({ erro: problema }, { status: 400 });
  }

  const { data, error } = await getSupabaseRouteClient()
    .from(tabela).insert(body.dados || {}).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}

/** Atualiza: { tipo, id, dados }. */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o catálogo." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const tabela = tabelaDe(body?.tipo);
  if (!tabela || !body?.id) return NextResponse.json({ erro: "Tipo ou id inválido." }, { status: 400 });
  if (body.tipo === "procedimento") {
    const problema = validarProcedimento(body.dados);
    if (problema) return NextResponse.json({ erro: problema }, { status: 400 });
  }

  const { data, error } = await getSupabaseRouteClient()
    .from(tabela).update({ ...body.dados, atualizado_em: new Date().toISOString() })
    .eq("id", body.id).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}

/** Exclui: ?tipo=equipamento&id=... */
export async function DELETE(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o catálogo." }, { status: 403 });
  }
  const tabela = tabelaDe(req.nextUrl.searchParams.get("tipo"));
  const id = req.nextUrl.searchParams.get("id");
  if (!tabela || !id) return NextResponse.json({ erro: "Tipo ou id inválido." }, { status: 400 });
  const { error } = await getSupabaseRouteClient().from(tabela).delete().eq("id", id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
