import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import { mesmaVersao } from "@/lib/asp/usuario-api";
import { faltaMigracao } from "@/lib/asp/catalogo-api";
import { NovoContatoInput } from "@/lib/orgaos/types";
import { contatosDoCliente, MSG_MIGRACAO_CLIENTES, projetosResponsaveis, usoDoContato } from "@/lib/orgaos/validacao-api";
import {
  contatoParaGravar, decisaoExcluirContato, msgVersaoCliente, planoRenomeacaoContato, primeiroErro, temErros, validarContato,
} from "@/lib/validacao";

export const runtime = "nodejs";

type Params = { params: { id: string; contatoId: string } };

async function lerContato(orgaoId: string, contatoId: string) {
  const { data } = await getSupabaseAdmin()
    .from("gp_orgaos_contatos").select("*").eq("id", contatoId).eq("orgao_id", orgaoId).maybeSingle();
  return data as Record<string, any> | null;
}

async function respostaVersao(contatoId: string) {
  const { data: agora } = await getSupabaseAdmin().from("gp_orgaos_contatos").select("*").eq("id", contatoId).maybeSingle();
  return NextResponse.json(
    { erro: msgVersaoCliente((agora as any)?.updated_at, "contato"), conflitoVersao: true },
    { status: 409 }
  );
}

/** Atualiza um contato do cliente — "Atualizar contato" da abertura de
 * projeto e "Editar" no detalhe do cliente. Mesmas regras do cadastro
 * (lib/validacao/cliente.ts), com o próprio contato fora da checagem de
 * repetidos (desativados contam).
 *   { nomeCompleto, cargo, telefone, email, versao, confirmarRenomeacao? }
 *     versao = updated_at lido (409 se outra pessoa salvou). Renomear um
 *     contato que é responsável de projetos DESTE cliente pede confirmação
 *     (409 precisaConfirmar com o texto) e leva o nome novo aos projetos na
 *     mesma transação (gp_atualizar_contato). RDOs/relatórios/entregas não mudam.
 *   { acao: "desativar" | "reativar" } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const atual = await lerContato(params.id, params.contatoId);
  if (!atual) {
    return NextResponse.json({ erro: "Contato não encontrado neste cliente." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as NovoContatoInput & {
    versao?: string; confirmarRenomeacao?: boolean; acao?: string;
  };

  if (body.acao === "desativar" || body.acao === "reativar") {
    const ativo = body.acao === "reativar";
    const { data, error } = await getSupabaseAdmin().from("gp_orgaos_contatos").update({
      ativo,
      desativado_em: ativo ? null : new Date().toISOString(),
      desativado_por: ativo ? null : profile.id,
    }).eq("id", params.contatoId).eq("orgao_id", params.id).select("*").single();
    if (faltaMigracao(error)) return NextResponse.json({ erro: MSG_MIGRACAO_CLIENTES }, { status: 500 });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, contato: data });
  }

  // Versão: obrigatória depois da migração (coluna updated_at existe).
  const temVersao = "updated_at" in atual;
  if (temVersao) {
    if (!body.versao) {
      return NextResponse.json({ erro: "Versão do contato ausente — recarregue a página e tente de novo." }, { status: 400 });
    }
    if (!mesmaVersao(body.versao, atual.updated_at)) return respostaVersao(params.contatoId);
  }

  const existentes = await contatosDoCliente(params.id);
  const resultado = validarContato({ ...body, id: params.contatoId }, existentes);
  if (temErros(resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(resultado), erros: resultado.erros, avisos: resultado.avisos },
      { status: 400 }
    );
  }

  const dados = contatoParaGravar(body);
  const plano = planoRenomeacaoContato(atual.nome_completo, dados.nome_completo, await projetosResponsaveis(params.id));
  if (plano.texto && body.confirmarRenomeacao !== true) {
    return NextResponse.json({
      erro: `Confirme a renomeação: ${plano.texto}`, precisaConfirmar: true, texto: plano.texto,
      projetos: plano.projetos.map((p) => ({ id: p.id, codigo: p.codigo })),
    }, { status: 409 });
  }

  if (plano.projetos.length > 0) {
    // Contato + responsável dos projetos na mesma transação.
    const { data: rpc, error } = await getSupabaseAdmin().rpc("gp_atualizar_contato", {
      p_id: params.contatoId, p_versao: atual.updated_at, p_nome: dados.nome_completo, p_cargo: dados.cargo,
      p_telefone: dados.telefone, p_email: dados.email, p_projetos: plano.projetos.map((p) => p.id),
    });
    if (error) {
      if (/gp_contato_versao/.test(error.message || "")) return respostaVersao(params.contatoId);
      if (faltaMigracao(error) || !temVersao) return NextResponse.json({ erro: MSG_MIGRACAO_CLIENTES }, { status: 500 });
      return NextResponse.json({ erro: "Falha ao salvar o contato: " + error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true, contato: (rpc as any)?.contato, avisos: resultado.avisos,
      renomeacao: { projetos: Number((rpc as any)?.projetos || 0) },
    });
  }

  let q = getSupabaseRouteClient()
    .from("gp_orgaos_contatos")
    .update(dados)
    .eq("id", params.contatoId)
    .eq("orgao_id", params.id);
  if (temVersao) q = q.eq("updated_at", atual.updated_at);
  const { data: salvos, error } = await q.select("*");
  if (error) {
    return NextResponse.json({ erro: "Falha ao salvar o contato: " + error.message }, { status: 500 });
  }
  if (!salvos || salvos.length === 0) return respostaVersao(params.contatoId);
  return NextResponse.json({ ok: true, contato: salvos[0], avisos: resultado.avisos });
}

/** Exclui o contato de vez — só se nada o usa (entregas registradas para
 * ele, projetos deste cliente com ele como responsável). Em uso: 409 com o
 * uso; a tela oferece "Desativar". */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeExcluirProjeto(profile)) {
    return NextResponse.json({ erro: "Você não tem permissão para excluir contatos — use “Desativar”." }, { status: 403 });
  }
  const atual = await lerContato(params.id, params.contatoId);
  if (!atual) return NextResponse.json({ ok: true });

  const uso = await usoDoContato(params.id, { id: atual.id, nome_completo: atual.nome_completo });
  const decisao = decisaoExcluirContato(atual.nome_completo, uso);
  if (!decisao.pode) {
    return NextResponse.json({ erro: decisao.mensagem, emUso: true, uso }, { status: 409 });
  }
  const { error } = await getSupabaseAdmin().from("gp_orgaos_contatos").delete().eq("id", params.contatoId).eq("orgao_id", params.id);
  if (error) {
    if ((error as any).code === "23503") {
      return NextResponse.json({ erro: `“${atual.nome_completo}” ainda é usado por outros registros — use “Desativar”.`, emUso: true }, { status: 409 });
    }
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
