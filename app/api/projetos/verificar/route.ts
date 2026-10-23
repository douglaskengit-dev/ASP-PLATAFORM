import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { contextoDoBanco, iniciaisDoPerfil, inspecaoPadraoNoServidor, PERFIS_ESCRITA } from "@/lib/asp/projeto-validacao-api";

export const runtime = "nodejs";

/** Checagem ao vivo do formulário de projeto (abrir/editar). Devolve o
 * contexto do banco — projetos com código parecido (inclusive lixeira),
 * projetos ativos do cliente, contatos do cliente e as iniciais de quem
 * abriu — e a tela roda lib/validacao/projeto.ts com ele, igual à API.
 * ?codigo=&clienteId=&excluirId= (excluirId = projeto em edição). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ESCRITA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const excluirId = sp.get("excluirId") || null;
  let iniciaisCriador = iniciaisDoPerfil(profile);
  let clienteAtual: string | null = null;
  if (excluirId) {
    const { data: atual } = await getSupabaseAdmin()
      .from("gp_projetos")
      .select("cliente_id, autor:gp_profiles!criado_por(nome_completo, email)")
      .eq("id", excluirId)
      .maybeSingle();
    if (atual) {
      iniciaisCriador = iniciaisDoPerfil((atual as any).autor);
      clienteAtual = atual.cliente_id;
    }
  }

  const [ctx, recorrencia] = await Promise.all([
    contextoDoBanco({
      codigo: sp.get("codigo"),
      clienteId: sp.get("clienteId"),
      excluirId,
      iniciaisCriador,
      clienteAtual,
    }),
    // "Haverá inspeção?" padrão (cliente recorrente com projeto ativo → Não).
    inspecaoPadraoNoServidor(sp.get("clienteId"), excluirId),
  ]);
  return NextResponse.json({ ok: true, ...ctx, recorrencia });
}
