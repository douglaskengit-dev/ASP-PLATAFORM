import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { mesmaOrigem } from "@/lib/asp/acesso-api";
import { CAMPOS_FUNCAO, paraFuncaoRef } from "@/lib/asp/funcoes";
import {
  carregarFuncoesComUso, erroCampoFuncao, exigirAdminFuncoes, lerCorpo, MSG_TABELA_AUSENTE, msgVersaoFuncao, traduzirErroFuncao,
} from "@/lib/asp/funcao-api";
import { mesmaVersao } from "@/lib/asp/usuario-api";
import {
  checarExcluirFuncao, normalizarEspacos, primeiroErro, ROTULOS_FUNCAO, temErros, usuariosComFuncao, validarFuncao,
} from "@/lib/validacao";

export const runtime = "nodejs";

const CAMPOS_EDITAR = new Set(["nome", "nome_rdo", "ativo", "versao"]);

/** Edita nome / nome no RDO / ativo, com a versão lida (409 se outro admin
 * alterou). Renomear leva o nome novo a todos os usuários com a função (FK
 * ON UPDATE CASCADE; sem a FK, a API atualiza os usuários em seguida).
 * Desativar: some da lista para novos cadastros, fica com quem já tem. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdminFuncoes();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });
  const lido = await lerCorpo(req, CAMPOS_EDITAR);
  if ("resposta" in lido) return lido.resposta;
  const { nome, nome_rdo, ativo, versao } = lido.body;
  if (nome !== undefined && typeof nome !== "string") return erroCampoFuncao("Nome: valor inválido.", "nome", 400);
  if (nome_rdo !== undefined && typeof nome_rdo !== "string") return erroCampoFuncao("Nome no RDO: valor inválido.", "nome_rdo", 400);
  if (ativo !== undefined && typeof ativo !== "boolean") return erroCampoFuncao("Ativo: valor inválido.", "ativo", 400);
  if (typeof versao !== "string" || !versao) {
    return NextResponse.json({ erro: "Versão da função ausente — recarregue a página e tente de novo." }, { status: 400 });
  }

  const { funcoes, perfis, erro, tabelaAusente } = await carregarFuncoesComUso();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  if (tabelaAusente) return NextResponse.json({ erro: MSG_TABELA_AUSENTE }, { status: 503 });
  const alvo = funcoes.find((f) => f.id === params.id);
  if (!alvo) return NextResponse.json({ erro: "Função não encontrada (excluída por outro administrador?). Recarregue a página." }, { status: 404 });
  if (!mesmaVersao(versao, alvo.updated_at)) {
    return NextResponse.json({ erro: msgVersaoFuncao(alvo.updated_at, alvo.nome), conflitoVersao: true, funcao: alvo }, { status: 409 });
  }

  const dados: { nome?: string; nome_rdo?: string } = {};
  if (nome !== undefined && normalizarEspacos(nome) !== alvo.nome) dados.nome = normalizarEspacos(nome);
  if (nome_rdo !== undefined && normalizarEspacos(nome_rdo) !== (alvo.nome_rdo || "")) dados.nome_rdo = normalizarEspacos(nome_rdo);
  const mudaAtivo = ativo !== undefined && ativo !== alvo.ativo;

  const r = validarFuncao(dados, {
    funcoes, modo: "editar", id: alvo.id, nomeAnterior: alvo.nome, usuariosNaFuncao: alvo.usuarios,
  });
  if (temErros(r)) {
    const duplicado = (r.erros.nome || []).some((m) => m.startsWith("Já existe"));
    return NextResponse.json({ erro: primeiroErro(r, ROTULOS_FUNCAO), erros: r.erros, avisos: r.avisos }, { status: duplicado ? 409 : 400 });
  }
  if (dados.nome === undefined && dados.nome_rdo === undefined && !mudaAtivo) {
    return NextResponse.json({ ok: true, funcao: alvo, avisos: r.avisos, usuariosAtualizados: 0 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("gp_funcoes")
    .update({ ...dados, ...(mudaAtivo ? { ativo } : {}) })
    .eq("id", alvo.id)
    .eq("updated_at", alvo.updated_at as string)
    .select(CAMPOS_FUNCAO);
  if (error) {
    const t = traduzirErroFuncao(error);
    return erroCampoFuncao(t.erro, t.campo, t.status);
  }
  if (!data || data.length === 0) {
    const { data: agora } = await admin.from("gp_funcoes").select(CAMPOS_FUNCAO).eq("id", alvo.id).maybeSingle();
    if (!agora) return NextResponse.json({ erro: "Função não encontrada (excluída por outro administrador?). Recarregue a página." }, { status: 404 });
    return NextResponse.json({ erro: msgVersaoFuncao((agora as any).updated_at, alvo.nome), conflitoVersao: true, funcao: paraFuncaoRef(agora) }, { status: 409 });
  }

  let usuariosAtualizados = 0;
  if (dados.nome !== undefined) {
    // Com a FK (ON UPDATE CASCADE) os usuários já foram atualizados e isto
    // não acha ninguém; sem a FK (NOTICE da migração), atualiza aqui.
    const { error: eUsu } = await admin.from("gp_profiles").update({ funcao: dados.nome }).eq("funcao", alvo.nome);
    if (eUsu) console.error("[admin/funcoes] renomear usuários:", eUsu.message);
    usuariosAtualizados = alvo.usuarios;
  }
  const funcao = { ...paraFuncaoRef(data[0]), usuarios: dados.nome !== undefined ? alvo.usuarios : usuariosComFuncao(alvo.nome, perfis) };
  return NextResponse.json({ ok: true, funcao, avisos: r.avisos, usuariosAtualizados });
}

/** Exclui de vez — só sem nenhum usuário (409 com a contagem; desative). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!mesmaOrigem(req)) return NextResponse.json({ erro: "Origem não permitida." }, { status: 403 });
  const check = await exigirAdminFuncoes();
  if ("erro" in check) return NextResponse.json({ erro: check.erro }, { status: check.status });

  const { funcoes, perfis, erro, tabelaAusente } = await carregarFuncoesComUso();
  if (erro) return NextResponse.json({ erro }, { status: 500 });
  if (tabelaAusente) return NextResponse.json({ erro: MSG_TABELA_AUSENTE }, { status: 503 });
  const alvo = funcoes.find((f) => f.id === params.id);
  if (!alvo) return NextResponse.json({ erro: "Função não encontrada (já excluída?). Recarregue a página." }, { status: 404 });
  const bloqueio = checarExcluirFuncao(alvo, perfis);
  if (bloqueio) return erroCampoFuncao(bloqueio, "excluir", 409, { usuarios: alvo.usuarios });

  const { error } = await getSupabaseAdmin().from("gp_funcoes").delete().eq("id", alvo.id);
  if (error) {
    // Corrida: alguém recebeu a função entre a contagem e o delete (FK).
    const t = traduzirErroFuncao(error);
    return erroCampoFuncao(t.erro, "excluir", t.status);
  }
  return NextResponse.json({ ok: true });
}
