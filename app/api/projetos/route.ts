import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import { iniciaisDoPerfil, inspecaoPadraoNoServidor, PERFIS_ESCRITA, validarProjetoNoServidor } from "@/lib/asp/projeto-validacao-api";
import { hojeBrasil, normalizarCodigoProjeto, normalizarEspacos, primeiroErro, ROTULOS_PROJETO, temErros } from "@/lib/validacao";

export const runtime = "nodejs";
const DIAS_LIXEIRA = 30;

/** Lista projetos com o cliente e a contagem de inspeções.
 * ?lixeira=1 lista os excluídos (recuperáveis). Faz limpeza preguiçosa dos
 * que passaram de 30 dias na lixeira. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const lixeira = req.nextUrl.searchParams.get("lixeira") === "1";

  // Limpeza preguiçosa: apaga de vez o que passou de 30 dias na lixeira.
  const corte = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
  await getSupabaseAdmin().from("gp_projetos").delete().lt("excluido_em", corte);

  const supabase = getSupabaseRouteClient();
  let query = supabase
    .from("gp_projetos")
    // gp_inspecoes(*): encerrada_em (Fase 10) sem quebrar antes da migração.
    .select("*, cliente:gp_orgaos(id, razao_social, cidade, uf), inspecoes:gp_inspecoes(*)")
    .order(lixeira ? "excluido_em" : "criado_em", { ascending: false });
  query = lixeira ? query.not("excluido_em", "is", null) : query.is("excluido_em", null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const projetos = (data || []).map((p: any) => {
    const inspecoes = (p.inspecoes || []).filter((i: any) => !i.excluido_em)
      .map((i: any) => ({ id: i.id, fase: i.fase, encerrada_em: i.encerrada_em || null, com_inspecao: i.com_inspecao !== false }));
    return { ...p, concluido_em: p.concluido_em || null, inspecoes, inspecoes_total: inspecoes.length };
  });
  return NextResponse.json({ ok: true, projetos, podeExcluir: podeExcluirProjeto(profile), diasLixeira: DIAS_LIXEIRA });
}

interface NovoProjetoBody {
  clienteId?: string | null;
  codigoProjeto?: string;
  pedidoCompra?: string;
  endereco?: string;
  responsavelProjeto?: string;
  dataAbertura?: string;
  /** "Usar dados do contato do cliente?" = Sim. */
  usarContato?: boolean;
  contatoId?: string | null;
  /** "Haverá inspeção?" — padrão das OSs do projeto. Ausente = a regra do
   *  cliente recorrente (inspecaoPadraoDoProjeto). */
  comInspecaoPadrao?: boolean;
}

/** Abre um novo projeto (fase 1 — Comercial). Todas as regras ⛔ de
 * lib/validacao/projeto.ts são repetidas aqui — a tela não é confiável. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ESCRITA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para abrir projetos (Comercial/Gerência/Admin)." }, { status: 403 });
  }

  const body = (await req.json()) as NovoProjetoBody;
  // Sem data, vale hoje (é o default da coluna) — mas validada do mesmo jeito.
  const dados = { ...body, dataAbertura: body.dataAbertura || hojeBrasil() };
  const { resultado, conflito } = await validarProjetoNoServidor(dados, { iniciaisCriador: iniciaisDoPerfil(profile) });
  if (temErros(resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(resultado, ROTULOS_PROJETO), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }

  const comInspecaoPadrao = typeof body.comInspecaoPadrao === "boolean"
    ? body.comInspecaoPadrao
    : (await inspecaoPadraoNoServidor(dados.clienteId)).inspecaoPadrao;

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_projetos")
    .insert({
      // Só grava quando é Não: sem a migração, o projeto segue como antes.
      ...(comInspecaoPadrao ? {} : { com_inspecao_padrao: false }),
      cliente_id: dados.clienteId,
      codigo_projeto: normalizarCodigoProjeto(dados.codigoProjeto),
      pedido_compra: normalizarEspacos(dados.pedidoCompra),
      endereco: normalizarEspacos(dados.endereco) || null,
      responsavel_projeto: normalizarEspacos(dados.responsavelProjeto) || null,
      data_abertura: dados.dataAbertura,
      criado_por: profile.id,
    })
    .select("*")
    .single();

  if (error) {
    // 23505 = índice único do código (corrida entre a checagem e o insert).
    if ((error as any).code === "23505") {
      return NextResponse.json({ erro: "Código do projeto: já usado por outro projeto. Atualize a sugestão e tente de novo." }, { status: 409 });
    }
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, projeto: data, avisos: resultado.avisos });
}
