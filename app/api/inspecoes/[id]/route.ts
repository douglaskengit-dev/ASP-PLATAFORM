import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";
import { erroDoTanque, normalizarTanque } from "@/lib/asp/tanque";
import { codigosDoCatalogo, conflitoAoRestaurarOS, ehViolacaoUnica, validarOSNoServidor } from "@/lib/asp/os-validacao-api";
import { normalizarEspacos, primeiroErro, ROTULOS_OS, temErros } from "@/lib/validacao";

export const runtime = "nodejs";

/** PATCH: restaurar da lixeira ({ restaurar: true }), renomear a OS
 *  ({ identificacao }) ou corrigir o cadastro do tanque ({ tanque }). O título
 *  é usado no relatório (campo TAG) e nos nomes dos arquivos gerados, e as
 *  medidas do tanque saem em todo relatório — vale corrigir os dois sem
 *  refazer a OS. Mesmas regras da criação (lib/validacao/ordemServico.ts):
 *  identificação única no projeto e procedimento do Catálogo. */
const PERFIS_EDICAO = ["admin", "operacoes", "gerencia", "comercial"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const body = await req.json();

  if (typeof body.procedimento === "string") {
    if (!PERFIS_EDICAO.includes(profile.perfil)) {
      return NextResponse.json({ erro: "Sem permissão para alterar o procedimento." }, { status: 403 });
    }
    const proc = body.procedimento.trim();
    if (!proc) return NextResponse.json({ erro: "Procedimento: escolha um procedimento do Catálogo." }, { status: 400 });
    if (!(await codigosDoCatalogo()).includes(proc)) {
      return NextResponse.json({ erro: `Procedimento “${proc}” não está no Catálogo.` }, { status: 400 });
    }
    const { data, error } = await getSupabaseAdmin()
      .from("gp_inspecoes")
      .update({ procedimento: proc, atualizado_em: new Date().toISOString() })
      .eq("id", params.id)
      .select("id, procedimento")
      .single();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    // O checklist de equipamentos acompanha o procedimento da OS (não tem um
    // procedimento próprio que possa divergir).
    await getSupabaseAdmin().from("gp_checklist_equipamentos").update({ procedimento: proc }).eq("inspecao_id", params.id);
    return NextResponse.json({ ok: true, inspecao: data });
  }

  // Cadastro do tanque: dimensões, capacidade e material. Vem inteiro, nunca
  // campo a campo, para não sobrar diâmetro de quando o tanque era circular.
  if (body.tanque !== undefined) {
    if (!PERFIS_EDICAO.includes(profile.perfil)) {
      return NextResponse.json({ erro: "Sem permissão para alterar o tanque." }, { status: 403 });
    }
    const erroTanque = erroDoTanque(body.tanque);
    if (erroTanque) return NextResponse.json({ erro: erroTanque }, { status: 400 });
    const { data, error } = await getSupabaseAdmin()
      .from("gp_inspecoes")
      .update({ tanque: normalizarTanque(body.tanque), atualizado_em: new Date().toISOString() })
      .eq("id", params.id)
      .select("id, tanque")
      .single();
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, inspecao: data });
  }

  if (typeof body.identificacao === "string") {
    if (!PERFIS_EDICAO.includes(profile.perfil)) {
      return NextResponse.json({ erro: "Sem permissão para renomear a OS." }, { status: 403 });
    }
    const titulo = normalizarEspacos(body.identificacao);
    const { data: atual } = await getSupabaseAdmin().from("gp_inspecoes").select("projeto_id").eq("id", params.id).maybeSingle();
    if (!atual) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
    // Só o nome muda aqui: o procedimento tem o seu próprio PATCH.
    const { resultado, conflito } = await validarOSNoServidor(
      { identificacao: titulo },
      { projetoId: atual.projeto_id, excluirId: params.id, exigirProcedimento: false }
    );
    if (temErros(resultado)) {
      return NextResponse.json(
        { erro: primeiroErro(resultado, ROTULOS_OS), erros: resultado.erros, avisos: resultado.avisos, conflito },
        { status: conflito ? 409 : 400 }
      );
    }
    const { data, error } = await getSupabaseAdmin()
      .from("gp_inspecoes")
      .update({ identificacao: titulo, atualizado_em: new Date().toISOString() })
      .eq("id", params.id)
      .select("id, identificacao")
      .single();
    if (ehViolacaoUnica(error)) {
      return NextResponse.json({ erro: "Identificação: já usada por outra OS deste projeto." }, { status: 409 });
    }
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, inspecao: data, avisos: resultado.avisos });
  }

  if (!podeExcluirProjeto(profile)) return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  if (!body.restaurar) return NextResponse.json({ ok: true });
  const conflito = await conflitoAoRestaurarOS(params.id);
  if (conflito) {
    return NextResponse.json({
      erro: `Já existe a OS “${conflito.identificacao}” ativa neste projeto. Renomeie-a antes de restaurar esta.`, conflito,
    }, { status: 409 });
  }
  const { error } = await getSupabaseAdmin()
    .from("gp_inspecoes")
    .update({ excluido_em: null, excluido_por: null, atualizado_em: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Exclusão da inspeção — lixeira (soft) por padrão; ?definitivo=1 apaga. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!podeExcluirProjeto(profile)) return NextResponse.json({ erro: "Você não tem permissão para excluir Ordens de Serviço." }, { status: 403 });
  const admin = getSupabaseAdmin();
  if (req.nextUrl.searchParams.get("definitivo") === "1") {
    const { error } = await admin.from("gp_inspecoes").delete().eq("id", params.id);
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, definitivo: true });
  }
  const { error } = await admin
    .from("gp_inspecoes")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}

/** Detalhe da inspeção com coletas, agendamentos, relatórios e histórico. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: inspecao, error } = await supabase
    .from("gp_inspecoes")
    .select("*, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, data_abertura, cliente:gp_orgaos(id, razao_social))")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });

  // Purga preguiçosa da lixeira de coletas: apaga o que passou de 30 dias.
  const corteColetas = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await getSupabaseAdmin().from("gp_coletas").delete().lt("excluido_em", corteColetas);

  const [coletas, agendamentos, relatorios, historico] = await Promise.all([
    supabase.from("gp_coletas").select("*").eq("inspecao_id", params.id).is("excluido_em", null).order("criado_em", { ascending: false }),
    supabase.from("gp_agendamentos").select("*").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
    supabase.from("gp_relatorios").select("*").eq("inspecao_id", params.id).is("excluido_em", null).order("versao", { ascending: false }),
    supabase.from("gp_fase_historico").select("*, autor_perfil:gp_profiles!autor(nome_completo, email)").eq("inspecao_id", params.id).order("criado_em", { ascending: false }),
  ]);

  return NextResponse.json({
    ok: true,
    inspecao,
    coletas: coletas.data || [],
    agendamentos: agendamentos.data || [],
    relatorios: relatorios.data || [],
    historico: historico.data || [],
  });
}
