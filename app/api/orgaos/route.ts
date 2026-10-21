import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import { NovoContatoInput, TipoEnte } from "@/lib/orgaos/types";
import { clientesCadastrados } from "@/lib/orgaos/validacao-api";
import {
  cnpjRepetido, contatoParaGravar, contatoVazio, mesclar, normalizarCnpj, normalizarEspacos, primeiroErro,
  ROTULOS_CLIENTE, temErros, validarCliente, validarContatos,
} from "@/lib/validacao";

export const runtime = "nodejs";

const DIAS_LIXEIRA = 30;

interface NovoOrgaoBody {
  tipoEnte: TipoEnte;
  razaoSocial: string;
  cnpj: string;
  cidade: string;
  uf: string;
  endereco?: string;
  contatos?: NovoContatoInput[];
}

/** Lista órgãos cadastrados, em ordem alfabética por razão social, com
 * filtros isolados e combináveis: q (busca em razão social), tipo (tipo do
 * ente) e de/ate (intervalo de data de cadastro). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const tipo = searchParams.get("tipo")?.trim();
  const de = searchParams.get("de")?.trim();
  const ate = searchParams.get("ate")?.trim();
  const lixeira = searchParams.get("lixeira") === "1";

  // Limpeza preguiçosa dos clientes que passaram de 30 dias na lixeira.
  const corte = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
  await getSupabaseAdmin().from("gp_orgaos").delete().lt("excluido_em", corte);

  const supabase = getSupabaseRouteClient();
  let query = supabase
    .from("gp_orgaos")
    .select("*, processos:gp_processos(id, titulo, etapa, arquivos, documentos, proposta_aprovada)")
    .order("razao_social", { ascending: true });

  query = lixeira ? query.not("excluido_em", "is", null) : query.is("excluido_em", null);
  if (q) query = query.ilike("razao_social", `%${q}%`);
  if (tipo) query = query.eq("tipo_ente", tipo);
  if (de) query = query.gte("created_at", `${de}T00:00:00`);
  if (ate) query = query.lte("created_at", `${ate}T23:59:59`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const orgaos = (data || []).map((o) => ({
    ...o,
    processos: (o.processos || []).map((p: any) => ({
      id: p.id,
      titulo: p.titulo,
      etapa: p.etapa,
      arquivos: Object.keys(p.arquivos || {}),
      documentos: p.documentos || {},
      proposta_aprovada: !!p.proposta_aprovada,
    })),
  }));

  return NextResponse.json({ ok: true, orgaos, podeExcluir: podeExcluirProjeto(profile) });
}

/** Cadastra um novo órgão. Tipo do ente, razão social, cidade e UF são
 * obrigatórios. Contatos são opcionais nesta etapa (podem ser adicionados
 * depois), mas é possível já incluir um ou mais no próprio cadastro. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const body = (await req.json()) as NovoOrgaoBody;

  // Contatos são opcionais no cadastro, mas um bloco começado é validado
  // inteiro. Regras em lib/validacao/cliente.ts (as mesmas da tela); a lista
  // vai inteira para o índice das mensagens casar com o bloco na tela.
  const ctx = { clientes: await clientesCadastrados() };
  const resultado = mesclar(validarCliente(body, ctx), validarContatos(body.contatos || []));
  const contatos = (body.contatos || []).filter((c) => !contatoVazio(c));
  if (!body.tipoEnte) resultado.erros.tipoEnte = ["Informe o tipo do ente."];
  if (temErros(resultado)) {
    const conflito = cnpjRepetido(body.cnpj, ctx);
    return NextResponse.json(
      { erro: primeiroErro(resultado, ROTULOS_CLIENTE), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }

  const supabase = getSupabaseRouteClient();
  const cnpjDigitos = normalizarCnpj(body.cnpj);

  const { data: orgao, error: erroOrgao } = await supabase
    .from("gp_orgaos")
    .insert({
      criado_por: profile.id,
      tipo_ente: body.tipoEnte,
      razao_social: normalizarEspacos(body.razaoSocial),
      cnpj: cnpjDigitos,
      cidade: normalizarEspacos(body.cidade),
      uf: body.uf.trim(),
      endereco: normalizarEspacos(body.endereco) || null,
    })
    .select("*")
    .single();

  if (erroOrgao || !orgao) {
    // 23505 = violação de unicidade — segunda camada de proteção contra
    // corrida entre a checagem acima e o insert (ver índice único no schema).
    const duplicado = (erroOrgao as any)?.code === "23505";
    return NextResponse.json(
      {
        erro: duplicado
          ? "Já existe um órgão cadastrado com este CNPJ."
          : "Falha ao cadastrar o órgão: " + (erroOrgao?.message || "erro desconhecido"),
      },
      { status: duplicado ? 409 : 500 }
    );
  }

  if (contatos.length > 0) {
    const { error: erroContatos } = await supabase.from("gp_orgaos_contatos").insert(
      contatos.map((c) => ({ orgao_id: orgao.id, ...contatoParaGravar(c) }))
    );
    if (erroContatos) {
      return NextResponse.json(
        { erro: "Órgão cadastrado, mas falhou ao salvar os contatos: " + erroContatos.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, orgao, avisos: resultado.avisos });
}
