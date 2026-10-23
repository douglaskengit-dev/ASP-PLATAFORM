import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import {
  carregarFuncoesComUso, exigirAdminFuncoes, lerCorpo, MSG_TABELA_AUSENTE, msgVersaoFuncao,
} from "@/lib/asp/funcao-api";
import { mesmaVersao } from "@/lib/asp/usuario-api";
import { CHAVES_PERMISSAO_FUNCAO } from "@/lib/validacao";

export const runtime = "nodejs";

/** Grava a matriz "Permissões por função" de uma vez (tudo ou nada):
 * { itens: [{ id, versao, pode_aprovar_medicao, pode_excluir_projetos,
 *   pode_editar_revisao, lideranca_equipe }] } — só as funções alteradas.
 * Se outra pessoa alterou alguma delas desde a leitura: 409 e nada grava. */
export async function PUT(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdminFuncoes();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });
  const lido = await lerCorpo(req, new Set(["itens"]));
  if ("resposta" in lido) return lido.resposta;
  const itens = lido.body.itens;
  const permitidos = new Set(["id", "versao", ...CHAVES_PERMISSAO_FUNCAO]);
  const valido = Array.isArray(itens) && itens.length > 0 && itens.length <= 200 && itens.every((it: any) =>
    it && typeof it === "object" && typeof it.id === "string" && typeof it.versao === "string" && it.versao
    && Object.keys(it).every((k) => permitidos.has(k))
    && CHAVES_PERMISSAO_FUNCAO.every((k) => it[k] === undefined || typeof it[k] === "boolean"));
  if (!valido) return NextResponse.json({ erro: "Permissões inválidas." }, { status: 400 });

  const { funcoes, erro, tabelaAusente } = await carregarFuncoesComUso();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  if (tabelaAusente) return NextResponse.json({ erro: MSG_TABELA_AUSENTE }, { status: 503 });
  for (const it of itens) {
    const f = funcoes.find((x) => x.id === it.id);
    if (!f) return NextResponse.json({ erro: "Uma das funções foi excluída por outro administrador — recarregue.", conflitoVersao: true, funcoes }, { status: 409 });
    if (!mesmaVersao(it.versao, f.updated_at)) {
      return NextResponse.json({ erro: msgVersaoFuncao(f.updated_at, f.nome), conflitoVersao: true, funcoes }, { status: 409 });
    }
  }

  const { error } = await getSupabaseAdmin().rpc("gp_salvar_permissoes_funcoes", {
    p_itens: itens.map((it: any) => ({ ...it, versao: funcoes.find((x) => x.id === it.id)!.updated_at })),
  });
  if (error) {
    if (/gp_funcoes_versao/.test(error.message || "")) {
      const depois = await carregarFuncoesComUso();
      const f = depois.funcoes.find((x) => x.id === (error as any).hint);
      return NextResponse.json({ erro: msgVersaoFuncao(f?.updated_at, f?.nome), conflitoVersao: true, funcoes: depois.funcoes }, { status: 409 });
    }
    console.error("[admin/funcoes] permissões:", error.code, error.message);
    return NextResponse.json({ erro: "Não foi possível gravar as permissões. Tente de novo em instantes." }, { status: 500 });
  }
  const depois = await carregarFuncoesComUso();
  return NextResponse.json({ ok: true, funcoes: depois.funcoes });
}
