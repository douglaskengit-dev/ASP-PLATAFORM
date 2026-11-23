import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { ETAPAS_FLUXO } from "@/lib/processos/etapas";
import { aplicarProcedimento, faltaColunaProcedimento, faltaMigracaoCrm, gerarLembretesProximaAcao, processoParaApi } from "@/lib/processos/crm-api";
import { hojeBrasil, podeUsarCrm, validarOportunidade } from "@/lib/validacao";

export const runtime = "nodejs";

/** Lista as oportunidades do Follow-up (CRM): Admin, Gerência e Comercial.
 * D44: com ?meus=1, devolve só as criadas pelo próprio usuário — vale para
 * qualquer perfil (usado no Histórico). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const apenasMeus = req.nextUrl.searchParams.get("meus") === "1";
  if (!apenasMeus && !podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "O Follow-up é do Comercial, da Gerência e da Administração." }, { status: 403 });
  }
  if (!apenasMeus) {
    try { await gerarLembretesProximaAcao(); } catch { /* lembrete é complementar */ }
  }

  // D29: "criado por" só é exposto para administradores. D41: status da
  // análise de TR vinculada, para o botão "Analisar TR".
  const ehAdmin = profile.perfil === "admin";
  const campos = ehAdmin
    ? "*, orgao:gp_orgaos(id, razao_social, tipo_ente, cidade, uf), criador:gp_profiles!gp_processos_criado_por_fkey(id, nome_completo, email), cadastro_tr:gp_cadastros_tr(status)"
    : "*, orgao:gp_orgaos(id, razao_social, tipo_ente, cidade, uf), cadastro_tr:gp_cadastros_tr(status)";

  const supabase = getSupabaseRouteClient();
  let consulta = supabase
    .from("gp_processos")
    .select(campos)
    .order("created_at", { ascending: false });
  if (apenasMeus) consulta = consulta.eq("criado_por", profile.id);
  const { data, error } = await consulta;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const processos = (data || []).map((p: any) => processoParaApi(p, ehAdmin));
  // Projeto aberto a partir da oportunidade ganha: código para o link.
  const idsProjeto = Array.from(new Set(processos.map((p) => p.projeto_id).filter(Boolean))) as string[];
  if (idsProjeto.length) {
    const { data: projs } = await supabase.from("gp_projetos").select("id, codigo_projeto, pedido_compra").in("id", idsProjeto);
    const mapa = new Map(((projs || []) as any[]).map((x) => [x.id, x]));
    for (const p of processos) {
      const x = p.projeto_id ? mapa.get(p.projeto_id) : null;
      if (x) p.projeto = { id: x.id, codigo: x.codigo_projeto || x.pedido_compra || null };
    }
  }
  // Versão mais nova da proposta de cada oportunidade: temperatura automática.
  // Complementar: sem permissão ou sem a migração, segue sem.
  if (processos.length) {
    const { data: versoes } = await supabase.from("gp_processo_propostas").select("*")
      .in("processo_id", processos.map((p) => p.id));
    const maisNova = new Map<string, any>();
    for (const v of (versoes || []) as any[]) {
      const a = maisNova.get(v.processo_id);
      if (!a || v.versao > a.versao) maisNova.set(v.processo_id, v);
    }
    for (const p of processos) {
      const v = maisNova.get(p.id);
      if (v) p.proposta_situacao = v.situacao || "enviada";
    }
  }
  return NextResponse.json({
    ok: true, processos, etapas: ETAPAS_FLUXO, souAdmin: ehAdmin, perfil: profile.perfil, eu: profile.id,
    hoje: hojeBrasil(), migrado: processos.length === 0 || processos.every((p) => p.migrado),
  });
}

/** Abre uma oportunidade. Aceita JSON (Follow-up novo) ou formulário (título
 *  e órgão). Nasce em Prospecção, com o autor como responsável. O fluxo de
 *  documentos (TR > Proposta > Ofício) segue pelo card. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "O Follow-up é do Comercial, da Gerência e da Administração." }, { status: 403 });
  }

  let corpo: Record<string, unknown>;
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const form = await req.formData();
    corpo = { titulo: String(form.get("titulo") || ""), orgaoId: String(form.get("orgao_id") || "") };
  }
  if (!Object.prototype.hasOwnProperty.call(corpo, "titulo")) corpo.titulo = "";
  if (!Object.prototype.hasOwnProperty.call(corpo, "orgaoId")) corpo.orgaoId = "";
  const v = validarOportunidade(corpo, hojeBrasil());
  if ("erro" in v) return NextResponse.json({ erro: v.erro }, { status: 400 });

  const supabase = getSupabaseRouteClient();
  const erroProc = await aplicarProcedimento(supabase, v.colunas);
  if (erroProc) return NextResponse.json({ erro: erroProc }, { status: 400 });
  const base = { criado_por: profile.id, etapa: 0, documentos: {}, arquivos: {} };
  const extras = { responsavel_id: profile.id, ...v.colunas };
  let { data: criado, error } = await supabase.from("gp_processos").insert({ ...base, ...extras }).select("id").single();
  if (error && faltaColunaProcedimento(error)) {
    delete (extras as Record<string, unknown>).procedimento_id;
    ({ data: criado, error } = await supabase.from("gp_processos").insert({ ...base, ...extras }).select("id").single());
  }
  if (error && faltaMigracaoCrm(error)) {
    // Antes da migração: só título e órgão.
    const soBasico = { ...base, titulo: v.colunas.titulo, orgao_id: v.colunas.orgao_id };
    ({ data: criado, error } = await supabase.from("gp_processos").insert(soBasico).select("id").single());
  }
  if (error || !criado) {
    return NextResponse.json({ erro: error?.message || "Falha ao criar a oportunidade." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: criado.id, etapa: 0, nome: ETAPAS_FLUXO[0].nome });
}
