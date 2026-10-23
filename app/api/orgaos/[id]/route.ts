import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import { TipoEnte } from "@/lib/orgaos/types";
import { mesmaVersao } from "@/lib/asp/usuario-api";
import { cidadesDaUf, clientesCadastrados, projetosParaExclusao } from "@/lib/orgaos/validacao-api";
import { situacaoRecorrencia } from "@/lib/asp/recorrencia-api";
import {
  cnpjRepetido, conflitoRestauracao, decisaoExcluirCliente, mesclar, msgVersaoCliente, normalizarCidade, normalizarCnpj, normalizarEspacos,
  primeiroErro, recorrenciaParaGravar, ROTULOS_CLIENTE, ROTULOS_RECORRENCIA, temErros, validarCliente, validarRecorrencia,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Detalhe de um órgão + seus contatos. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();

  const { data: orgao, error: erroOrgao } = await supabase
    .from("gp_orgaos")
    .select("*")
    .eq("id", params.id)
    .single();
  if (erroOrgao || !orgao) {
    return NextResponse.json({ erro: "Órgão não encontrado." }, { status: 404 });
  }

  const { data: contatos, error: erroContatos } = await supabase
    .from("gp_orgaos_contatos")
    .select("*")
    .eq("orgao_id", params.id)
    .order("created_at", { ascending: true });
  if (erroContatos) {
    return NextResponse.json({ erro: erroContatos.message }, { status: 500 });
  }

  // Processos (Ações) deste órgão — usados na timeline de fases da página de
  // detalhe. D29: "criado por" só é embutido para administradores.
  const ehAdmin = profile.perfil === "admin";
  // D41: também traz o status da análise de TR vinculada (em_analise =
  // rascunho pronto para revisar, concluida = relatório já gerado).
  const campos = ehAdmin
    ? "id, titulo, etapa, arquivos, documentos, proposta_aprovada, historico_etapas, cadastro_tr_id, created_at, criador:gp_profiles!gp_processos_criado_por_fkey(id, nome_completo, email), cadastro_tr:gp_cadastros_tr(status)"
    : "id, titulo, etapa, arquivos, documentos, proposta_aprovada, historico_etapas, cadastro_tr_id, created_at, cadastro_tr:gp_cadastros_tr(status)";

  const { data: processos, error: erroProcessos } = await supabase
    .from("gp_processos")
    .select(campos)
    .eq("orgao_id", params.id)
    .order("created_at", { ascending: false });
  if (erroProcessos) {
    return NextResponse.json({ erro: erroProcessos.message }, { status: 500 });
  }

  const processosMapeados = (processos || []).map((p: any) => ({
    id: p.id,
    titulo: p.titulo,
    data: p.created_at,
    etapa: p.etapa,
    documentos: p.documentos || {},
    arquivos: Object.keys(p.arquivos || {}),
    cadastro_tr_id: p.cadastro_tr_id,
    cadastro_tr_status: p.cadastro_tr?.status || null,
    proposta_aprovada: !!p.proposta_aprovada,
    historico_etapas: p.historico_etapas || [],
    criado_por: ehAdmin
      ? { id: p.criador?.id ?? null, nome: p.criador?.nome_completo || p.criador?.email || "—" }
      : null,
  }));

  // Cliente recorrente: próximo serviço (vencimento e status).
  let recorrencia = null;
  if ((orgao as any).recorrente === true) {
    try { recorrencia = (await situacaoRecorrencia([params.id])).get(params.id)?.proximo || null; } catch { /* complementar */ }
  }

  return NextResponse.json({
    ok: true,
    recorrencia,
    orgao: { ...orgao, contatos: contatos || [] },
    processos: processosMapeados,
    souAdmin: ehAdmin,
    perfil: profile.perfil,
  });
}

interface EditarOrgaoBody {
  tipoEnte: TipoEnte;
  razaoSocial: string;
  cnpj: string;
  cidade: string;
  uf: string;
  /** Endereço da sede — vira sugestão de "Endereço da obra" nos projetos. */
  endereco?: string;
  /** updated_at lido ao abrir a edição (concorrência otimista). */
  versao?: string;
  /** Serviço recorrente: periodicidade obrigatória quando marcado. */
  recorrente?: boolean;
  periodicidadeMeses?: number | string | null;
  avisoAntecedenciaDias?: number | string | null;
}

/** Edita os dados cadastrais do órgão (tipo, razão social, CNPJ, cidade, UF,
 * endereço). Grava só se ninguém salvou depois de `versao` (senão 409).
 * Também: { restaurar: true } tira da lixeira. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const body = (await req.json()) as EditarOrgaoBody & { restaurar?: boolean };
  const admin = getSupabaseAdmin();
  const { data: atual, error: eAtual } = await admin.from("gp_orgaos").select("*").eq("id", params.id).maybeSingle();
  if (eAtual) return NextResponse.json({ erro: eAtual.message }, { status: 500 });
  if (!atual) return NextResponse.json({ erro: "Cliente não encontrado — pode ter sido excluído. Recarregue." }, { status: 404 });

  // Restaurar da lixeira (mesma permissão de excluir). Não volta se o CNPJ
  // ou a razão social já estão num cliente ativo.
  if (body.restaurar) {
    if (!podeExcluirProjeto(profile)) return NextResponse.json({ erro: "Sem permissão para restaurar." }, { status: 403 });
    const conflito = conflitoRestauracao(atual, await clientesCadastrados());
    if (conflito) return NextResponse.json({ erro: conflito.mensagem, conflito: conflito.cliente }, { status: 409 });
    const { error } = await admin
      .from("gp_orgaos")
      .update({ excluido_em: null, excluido_por: null, updated_at: new Date().toISOString() })
      .eq("id", params.id);
    if (error) {
      const duplicado = (error as any)?.code === "23505";
      return NextResponse.json(
        { erro: duplicado ? "Não dá para restaurar: o CNPJ já está em outro cliente." : error.message },
        { status: duplicado ? 409 : 500 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (atual.excluido_em) {
    return NextResponse.json({ erro: "Este cliente está na lixeira — restaure-o antes de editar." }, { status: 409 });
  }
  if (!body.versao) {
    return NextResponse.json({ erro: "Versão do cliente ausente — recarregue a página e tente de novo." }, { status: 400 });
  }
  if (!mesmaVersao(body.versao, atual.updated_at)) {
    return NextResponse.json({ erro: msgVersaoCliente(atual.updated_at), conflitoVersao: true }, { status: 409 });
  }

  // Regras em lib/validacao/cliente.ts (as mesmas da tela); CNPJ comparado
  // só pelos dígitos, inclusive com clientes na lixeira.
  const ctx = {
    clientes: await clientesCadastrados(),
    excluirId: params.id,
    cidades: await cidadesDaUf(body.uf, params.id),
    razaoSocialAtual: atual.razao_social,
  };
  const resultado = mesclar(validarCliente({ ...body, endereco: body.endereco ?? "" }, ctx), validarRecorrencia(body));
  if (!body.tipoEnte) resultado.erros.tipoEnte = ["Informe o tipo do ente."];
  if (temErros(resultado)) {
    const conflito = cnpjRepetido(body.cnpj, ctx);
    return NextResponse.json(
      { erro: primeiroErro(resultado, { ...ROTULOS_CLIENTE, ...ROTULOS_RECORRENCIA }), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }

  const supabase = getSupabaseRouteClient();
  const cnpjDigitos = normalizarCnpj(body.cnpj);

  // Grava só se a versão ainda é a lida (ninguém salvou no meio).
  const { data: salvos, error } = await supabase
    .from("gp_orgaos")
    .update({
      tipo_ente: body.tipoEnte,
      razao_social: normalizarEspacos(body.razaoSocial),
      cnpj: cnpjDigitos,
      cidade: normalizarCidade(body.cidade),
      uf: body.uf.trim().toUpperCase(),
      endereco: normalizarEspacos(body.endereco) || null,
      // Recorrência: só com a coluna no banco (migração) e quando a tela mandou.
      ...("recorrente" in atual && typeof body.recorrente === "boolean" ? recorrenciaParaGravar(body) : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("updated_at", atual.updated_at)
    .select("*");

  if (error) {
    const duplicado = (error as any)?.code === "23505";
    return NextResponse.json(
      {
        erro: duplicado
          ? "Já existe outro órgão cadastrado com este CNPJ."
          : "Falha ao salvar as alterações: " + (error?.message || "erro desconhecido"),
      },
      { status: duplicado ? 409 : 500 }
    );
  }
  if (!salvos || salvos.length === 0) {
    const { data: agora } = await admin.from("gp_orgaos").select("updated_at").eq("id", params.id).maybeSingle();
    return NextResponse.json({ erro: msgVersaoCliente((agora as any)?.updated_at), conflitoVersao: true }, { status: 409 });
  }

  return NextResponse.json({ ok: true, orgao: salvos[0], avisos: resultado.avisos });
}

/** Exclusão do cliente — lixeira (soft) por padrão; ?definitivo=1 apaga.
 *  Lixeira: ⛔ com projeto em andamento; ⚠️ com projetos concluídos ou na
 *  lixeira pede ?confirmar=1 (a resposta 409 traz o texto). Definitivo: só
 *  sem nenhum projeto (nem na lixeira). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!podeExcluirProjeto(profile)) return NextResponse.json({ erro: "Você não tem permissão para excluir clientes." }, { status: 403 });
  const admin = getSupabaseAdmin();
  const definitivo = req.nextUrl.searchParams.get("definitivo") === "1";

  const { projetos, erro: eProj } = await projetosParaExclusao(params.id);
  if (eProj) return NextResponse.json({ erro: eProj }, { status: 500 });
  const decisao = decisaoExcluirCliente(projetos, definitivo);
  if (decisao.bloqueio) {
    return NextResponse.json({ erro: decisao.bloqueio, bloqueado: true, projetos: decisao.projetos }, { status: 409 });
  }
  if (decisao.confirmar && req.nextUrl.searchParams.get("confirmar") !== "1") {
    return NextResponse.json(
      { erro: decisao.confirmar, precisaConfirmar: true, texto: decisao.confirmar, projetos: decisao.projetos },
      { status: 409 }
    );
  }

  if (definitivo) {
    const { error } = await admin.from("gp_orgaos").delete().eq("id", params.id);
    if (error) {
      // 23503 = ainda referenciado (projeto criado no meio, processo/proposta
      // do Follow-up, ofício…): mensagem clara em vez do erro cru do banco.
      if ((error as any).code === "23503") {
        return NextResponse.json({
          erro: "Este cliente ainda é usado por outros registros (projetos, processos do Follow-up, propostas ou ofícios) e não pode ser excluído definitivamente. Ele continua na lixeira.",
          bloqueado: true,
        }, { status: 409 });
      }
      return NextResponse.json({ erro: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, definitivo: true });
  }
  const { error } = await admin
    .from("gp_orgaos")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}
