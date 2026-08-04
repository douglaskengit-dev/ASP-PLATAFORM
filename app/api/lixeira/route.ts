import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";

export const runtime = "nodejs";

/** Tabelas com lixeira (soft delete). O rótulo é o que aparece na tela. */
const TABELAS = {
  projeto: { tabela: "gp_projetos", campos: "id, codigo_projeto, pedido_compra, excluido_em" },
  inspecao: { tabela: "gp_inspecoes", campos: "id, identificacao, fase, excluido_em" },
  cliente: { tabela: "gp_orgaos", campos: "id, razao_social, cidade, uf, excluido_em" },
  medicao: { tabela: "gp_coletas", campos: "id, tipo, criado_em, excluido_em, inspecao_id" },
  relatorio: { tabela: "gp_relatorios", campos: "id, tipo, versao, status, excluido_em, inspecao_id" },
} as const;
type Tipo = keyof typeof TABELAS;

const DIAS = 30;

function ehTipo(t: any): t is Tipo {
  return typeof t === "string" && t in TABELAS;
}

/** Lista tudo que está na lixeira, com o prazo restante de cada item.
 *  A purga definitiva (mais de 30 dias) acontece nas telas de origem; aqui
 *  apenas mostramos, para não apagar nada por efeito colateral de listagem. */
export async function GET() {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = getSupabaseRouteClient();
  const chaves = Object.keys(TABELAS) as Tipo[];
  const resultados = await Promise.all(
    chaves.map((k) =>
      supabase.from(TABELAS[k].tabela).select(TABELAS[k].campos)
        .not("excluido_em", "is", null)
        .order("excluido_em", { ascending: false })
    )
  );

  const itens: any[] = [];
  chaves.forEach((k, i) => {
    for (const r of (resultados[i].data as any[]) || []) {
      const dias = Math.max(0, DIAS - Math.floor((Date.now() - new Date(r.excluido_em).getTime()) / 86400000));
      itens.push({ tipo: k, dados: r, excluido_em: r.excluido_em, diasRestantes: dias });
    }
  });
  itens.sort((a, b) => (a.excluido_em < b.excluido_em ? 1 : -1));

  return NextResponse.json({
    ok: true,
    podeGerenciar: podeExcluirProjeto({ perfil: profile.perfil, funcao: (profile as any).funcao }),
    itens,
  });
}

/** Restaura um item: PATCH { tipo, id }. */
export async function PATCH(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!podeExcluirProjeto({ perfil: profile.perfil, funcao: (profile as any).funcao })) {
    return NextResponse.json({ erro: "Sem permissão para restaurar." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!ehTipo(body?.tipo) || !body?.id) {
    return NextResponse.json({ erro: "Tipo ou id inválido." }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from(TABELAS[body.tipo].tabela)
    .update({ excluido_em: null, excluido_por: null })
    .eq("id", body.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Exclui de vez: DELETE ?tipo=…&id=… */
export async function DELETE(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!podeExcluirProjeto({ perfil: profile.perfil, funcao: (profile as any).funcao })) {
    return NextResponse.json({ erro: "Sem permissão para excluir." }, { status: 403 });
  }
  const tipo = req.nextUrl.searchParams.get("tipo");
  const id = req.nextUrl.searchParams.get("id");
  if (!ehTipo(tipo) || !id) return NextResponse.json({ erro: "Tipo ou id inválido." }, { status: 400 });

  const { error } = await getSupabaseAdmin().from(TABELAS[tipo].tabela).delete().eq("id", id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
