import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import { iniciaisDoPerfil, PERFIS_ESCRITA, validarProjetoNoServidor } from "@/lib/asp/projeto-validacao-api";
import { normalizarCodigoProjeto, normalizarEspacos, primeiroErro, ROTULOS_PROJETO, temErros } from "@/lib/validacao";

export const runtime = "nodejs";

/** Detalhe do projeto + suas inspeções. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: projeto, error } = await supabase
    .from("gp_projetos")
    .select("*, cliente:gp_orgaos(id, razao_social, cidade, uf, cnpj)")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });

  const { data: inspecoesRaw } = await supabase
    .from("gp_inspecoes")
    .select("*, agendamentos:gp_agendamentos(data_visita, data_fim, hora, tipo, a_definir, substituido_em)")
    .eq("projeto_id", params.id)
    .is("excluido_em", null)
    .order("criado_em", { ascending: true });

  const inspecoes = inspecoesRaw || [];

  // Última movimentação (histórico) por inspeção — para o resumo no projeto.
  const ids = inspecoes.map((i: any) => i.id);
  if (ids.length > 0) {
    const { data: hist } = await supabase
      .from("gp_fase_historico")
      .select("inspecao_id, acao, fase_de, fase_para, data_autenticacao, criado_em, autor_perfil:gp_profiles!autor(nome_completo, email)")
      .in("inspecao_id", ids)
      .order("data_autenticacao", { ascending: false });
    const ultimaPorInspecao = new Map<string, any>();
    (hist || []).forEach((h: any) => { if (!ultimaPorInspecao.has(h.inspecao_id)) ultimaPorInspecao.set(h.inspecao_id, h); });
    inspecoes.forEach((i: any) => { i.ultima_acao = ultimaPorInspecao.get(i.id) || null; });
  }

  return NextResponse.json({ ok: true, projeto, inspecoes });
}

/** Atualiza campos do projeto (Comercial/Gerência/Admin). Mesmas regras da
 * abertura (lib/validacao/projeto.ts), com o próprio projeto fora das
 * checagens de duplicidade e as iniciais comparadas às de quem o abriu. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ESCRITA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const body = await req.json();

  // Restaurar da lixeira (mesma permissão de excluir).
  if (body.restaurar) {
    if (!podeExcluirProjeto(profile)) {
      return NextResponse.json({ erro: "Sem permissão para restaurar." }, { status: 403 });
    }
    const { error } = await getSupabaseAdmin()
      .from("gp_projetos")
      .update({ excluido_em: null, excluido_por: null, atualizado_em: new Date().toISOString() })
      .eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // O PATCH pode vir parcial: valida o projeto inteiro como ficará.
  const admin = getSupabaseAdmin();
  const { data: atual } = await admin
    .from("gp_projetos")
    .select("cliente_id, codigo_projeto, pedido_compra, endereco, responsavel_projeto, data_abertura, autor:gp_profiles!criado_por(nome_completo, email)")
    .eq("id", params.id)
    .maybeSingle();
  if (!atual) return NextResponse.json({ erro: "Projeto não encontrado." }, { status: 404 });

  const CAMPOS = [
    ["clienteId", "cliente_id"],
    ["codigoProjeto", "codigo_projeto"],
    ["pedidoCompra", "pedido_compra"],
    ["endereco", "endereco"],
    ["responsavelProjeto", "responsavel_projeto"],
    ["dataAbertura", "data_abertura"],
  ] as const;
  const dados: Record<string, any> = {};
  for (const [campo, coluna] of CAMPOS) dados[campo] = campo in body ? body[campo] : (atual as any)[coluna];
  dados.usarContato = !!body.usarContato;
  dados.contatoId = body.contatoId || null;

  const { resultado, conflito } = await validarProjetoNoServidor(dados, {
    excluirId: params.id,
    iniciaisCriador: iniciaisDoPerfil((atual as any).autor),
    clienteAtual: atual.cliente_id,
  });
  if (temErros(resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(resultado, ROTULOS_PROJETO), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }

  const patch: Record<string, unknown> = {
    atualizado_em: new Date().toISOString(),
    cliente_id: dados.clienteId,
    codigo_projeto: normalizarCodigoProjeto(dados.codigoProjeto),
    pedido_compra: normalizarEspacos(dados.pedidoCompra),
    endereco: normalizarEspacos(dados.endereco) || null,
    responsavel_projeto: normalizarEspacos(dados.responsavelProjeto) || null,
    data_abertura: dados.dataAbertura,
  };

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase.from("gp_projetos").update(patch).eq("id", params.id).select("*").single();
  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ erro: "Código do projeto: já usado por outro projeto." }, { status: 409 });
    }
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, projeto: data, avisos: resultado.avisos });
}

/** Exclusão do projeto. Padrão = lixeira (soft): marca excluido_em e o projeto
 * fica recuperável por 30 dias. ?definitivo=1 apaga de vez. Permissão:
 * Comercial/Gerência/Admin ou Função Coordenador. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeExcluirProjeto(profile)) {
    return NextResponse.json({ erro: "Você não tem permissão para excluir projetos." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const definitivo = req.nextUrl.searchParams.get("definitivo") === "1";
  if (definitivo) {
    const { error } = await admin.from("gp_projetos").delete().eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, definitivo: true });
  }

  const { error } = await admin
    .from("gp_projetos")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}
