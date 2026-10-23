import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { CAMPOS_FUNCAO, paraFuncaoRef } from "@/lib/asp/funcoes";
import {
  carregarFuncoesComUso, erroCampoFuncao, exigirAdminFuncoes, lerCorpo, MSG_TABELA_AUSENTE, traduzirErroFuncao,
} from "@/lib/asp/funcao-api";
import { PERFIS_COM_DIREITO } from "@/lib/asp/permissoes";
import { nomeRdoPadrao, normalizarEspacos, primeiroErro, ROTULOS_FUNCAO, temErros, validarFuncao } from "@/lib/validacao";

export const runtime = "nodejs";

/** Funções cadastradas (todas, ativas primeiro) com o nº de usuários de cada
 * uma e os perfis que já têm cada direito independentemente da função. */
export async function GET() {
  const check = await exigirAdminFuncoes();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });
  const { funcoes, erro, tabelaAusente } = await carregarFuncoesComUso();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  return NextResponse.json({ ok: true, funcoes, tabelaAusente, perfisComDireito: PERFIS_COM_DIREITO });
}

const CAMPOS_CRIAR = new Set(["nome", "nome_rdo"]);

/** Cria uma função (sem permissões; ativa; no fim da ordem). */
export async function POST(req: NextRequest) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdminFuncoes();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });
  const lido = await lerCorpo(req, CAMPOS_CRIAR);
  if ("resposta" in lido) return lido.resposta;
  const { body } = lido;
  for (const k of ["nome", "nome_rdo"]) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== "string") {
      return erroCampoFuncao(`${ROTULOS_FUNCAO[k]}: valor inválido.`, k, 400);
    }
  }
  const nome = normalizarEspacos(body.nome);
  const nomeRdo = normalizarEspacos(body.nome_rdo) || nomeRdoPadrao(nome);

  const { funcoes, erro, tabelaAusente } = await carregarFuncoesComUso();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  if (tabelaAusente) return NextResponse.json({ erro: MSG_TABELA_AUSENTE }, { status: 503 });

  const r = validarFuncao({ nome, nome_rdo: nomeRdo }, { funcoes, modo: "criar" });
  if (temErros(r)) {
    const duplicado = (r.erros.nome || []).some((m) => m.startsWith("Já existe"));
    return NextResponse.json({ erro: primeiroErro(r, ROTULOS_FUNCAO), erros: r.erros, avisos: r.avisos }, { status: duplicado ? 409 : 400 });
  }

  const ordem = funcoes.reduce((max, f) => Math.max(max, f.ordem), 0) + 1;
  const { data, error } = await getSupabaseAdmin()
    .from("gp_funcoes")
    .insert({ nome, nome_rdo: nomeRdo, ordem, ativo: true, criado_por: check.profile.id })
    .select(CAMPOS_FUNCAO)
    .single();
  if (error || !data) {
    const t = error ? traduzirErroFuncao(error) : { erro: "Não foi possível criar a função.", campo: null, status: 500 };
    return erroCampoFuncao(t.erro, t.campo, t.status);
  }
  return NextResponse.json({ ok: true, funcao: { ...paraFuncaoRef(data), usuarios: 0 }, avisos: r.avisos });
}
