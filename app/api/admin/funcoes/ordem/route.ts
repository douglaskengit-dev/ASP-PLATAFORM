import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { carregarFuncoesComUso, exigirAdminFuncoes, lerCorpo, MSG_TABELA_AUSENTE } from "@/lib/asp/funcao-api";

export const runtime = "nodejs";

/** Nova ordem das funções: { ids: [todas as funções, na ordem] }. Mudar só a
 * ordem não troca a versão (não atrapalha quem está editando). */
export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdminFuncoes();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });
  const lido = await lerCorpo(req, new Set(["ids"]));
  if ("resposta" in lido) return lido.resposta;
  const ids = lido.body.ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    return NextResponse.json({ erro: "Ordem inválida." }, { status: 400 });
  }

  const { funcoes, erro, tabelaAusente } = await carregarFuncoesComUso();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  if (tabelaAusente) return NextResponse.json({ erro: MSG_TABELA_AUSENTE }, { status: 503 });
  const atuais = new Set(funcoes.map((f) => f.id));
  if (new Set(ids).size !== ids.length || ids.length !== atuais.size || ids.some((id: string) => !atuais.has(id))) {
    return NextResponse.json({ erro: "A lista de funções mudou (outro administrador criou ou excluiu uma) — recarregue.", conflitoVersao: true }, { status: 409 });
  }

  const admin = getSupabaseAdmin();
  const mudar = ids
    .map((id: string, i: number) => ({ id, ordem: i + 1 }))
    .filter((x: { id: string; ordem: number }) => funcoes.find((f) => f.id === x.id)?.ordem !== x.ordem);
  for (const x of mudar) {
    const { error } = await admin.from("gp_funcoes").update({ ordem: x.ordem }).eq("id", x.id);
    if (error) {
      console.error("[admin/funcoes] ordem:", error.message);
      return NextResponse.json({ erro: "Não foi possível gravar a ordem. Recarregue e tente de novo." }, { status: 500 });
    }
  }
  const depois = await carregarFuncoesComUso();
  return NextResponse.json({ ok: true, funcoes: depois.funcoes });
}
