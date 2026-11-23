import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { removerArquivos } from "@/lib/processos/arquivos";
import { aplicarProcedimento, faltaColunaProcedimento, faltaMigracaoCrm, MSG_MIGRACAO_CRM } from "@/lib/processos/crm-api";
import { ehTemperatura, hojeBrasil, podeUsarCrm, TAM_OBS_TEMPERATURA, validarOportunidade } from "@/lib/validacao";

export const runtime = "nodejs";

/** Edita a oportunidade: só os campos enviados (título/procedimento, cliente, contato,
 * valor, origem, responsável, previsão de fechamento, próxima ação e
 * temperatura). Mudar a temperatura (ou mandar observacaoTemperatura) grava
 * um evento "temperatura" no historico_etapas, com a observação e a data. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "O Follow-up é do Comercial, da Gerência e da Administração." }, { status: 403 });
  }

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const hoje = hojeBrasil();
  const v = validarOportunidade(corpo, hoje);
  if ("erro" in v) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const obsTemp = typeof corpo.observacaoTemperatura === "string" ? corpo.observacaoTemperatura.trim() : "";
  if (obsTemp.length > TAM_OBS_TEMPERATURA) {
    return NextResponse.json({ erro: `Observação da temperatura muito longa (máximo ${TAM_OBS_TEMPERATURA} caracteres).` }, { status: 400 });
  }
  if (!Object.keys(v.colunas).length && !obsTemp) return NextResponse.json({ erro: "Nada para salvar." }, { status: 400 });

  const supabase = getSupabaseRouteClient();
  // Temperatura: evento no histórico quando a escolha muda ou vem observação.
  const mexeTemp = "temperatura" in v.colunas || "probabilidade" in v.colunas;
  if (mexeTemp || obsTemp) {
    const { data: atual } = await supabase.from("gp_processos").select("*").eq("id", params.id).maybeSingle();
    if (!atual) return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });
    const antes = { temperatura: ehTemperatura(atual.temperatura) ? atual.temperatura : null, probabilidade: atual.probabilidade == null ? null : Number(atual.probabilidade) };
    const depois = {
      temperatura: "temperatura" in v.colunas ? (v.colunas.temperatura as any) ?? null : antes.temperatura,
      probabilidade: "probabilidade" in v.colunas ? (v.colunas.probabilidade as number | null) ?? null : antes.probabilidade,
    };
    const mudou = antes.temperatura !== depois.temperatura || antes.probabilidade !== depois.probabilidade;
    if (mudou || obsTemp) {
      const historico = Array.isArray(atual.historico_etapas) ? atual.historico_etapas : [];
      v.colunas.historico_etapas = [...historico, {
        evento: "temperatura", ...depois, anterior: mudou ? antes : null, observacao: obsTemp || null,
        data: hoje, alterado_em: new Date().toISOString(), alterado_por: profile.id,
      }];
    }
  }
  if (!Object.keys(v.colunas).length) return NextResponse.json({ ok: true });
  const erroProc = await aplicarProcedimento(supabase, v.colunas);
  if (erroProc) return NextResponse.json({ erro: erroProc }, { status: 400 });
  // Trocou o cliente: o contato antigo não vale mais.
  if (v.colunas.orgao_id && !Object.prototype.hasOwnProperty.call(v.colunas, "contato_id")) {
    const { data: atual } = await supabase.from("gp_processos").select("orgao_id").eq("id", params.id).maybeSingle();
    if (atual && atual.orgao_id !== v.colunas.orgao_id) v.colunas.contato_id = null;
  }
  const salvar = () => supabase
    .from("gp_processos")
    .update({ ...v.colunas, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();
  let { data, error } = await salvar();
  if (error && faltaColunaProcedimento(error)) {
    delete v.colunas.procedimento_id;
    ({ data, error } = await salvar());
  }
  if (error && "temperatura" in v.colunas && faltaMigracaoCrm(error) && /temperatura/i.test(error.message || "")) {
    return NextResponse.json({ erro: "A temperatura precisa da migração 20261123100000_asp_crm_temperatura no Supabase. Peça ao administrador para rodá-la." }, { status: 409 });
  }
  if (error && "probabilidade" in v.colunas && faltaMigracaoCrm(error) && /probabilidade/i.test(error.message || "")) {
    return NextResponse.json({ erro: "O percentual próprio precisa da migração 20261124100000_asp_crm_probabilidade no Supabase. Peça ao administrador para rodá-la." }, { status: 409 });
  }
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ erro: MSG_MIGRACAO_CRM }, { status: 409 });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });

  return NextResponse.json({ ok: true });
}

/** Exclui o processo, seus arquivos exclusivos no storage e devolve ao drop
 * os ofícios do catálogo que estavam vinculados a ele. RLS garante que só o
 * dono (ou admin) consegue excluir. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: processo } = await supabase
    .from("gp_processos")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  // arquivos exclusivos do processo (prefixo {id}/...); ofícios do catálogo
  // (prefixo oficios/...) são compartilhados e permanecem no storage
  const caminhos: string[] = Object.values(processo.arquivos || {}) as string[];
  for (const info of Object.values(processo.documentos || {}) as { arquivo?: string }[]) {
    if (info?.arquivo?.startsWith(`${params.id}/`)) caminhos.push(info.arquivo);
  }
  // Arquivos das versões da proposta (antes da migração: nenhum).
  const { data: propostas } = await supabase.from("gp_processo_propostas").select("arquivo").eq("processo_id", params.id);
  for (const pr of (propostas || []) as { arquivo: string | null }[]) if (pr.arquivo) caminhos.push(pr.arquivo);
  await removerArquivos(caminhos);

  // ofícios vinculados voltam ao drop
  await supabase.from("gp_oficios").update({ job_id: null }).eq("job_id", params.id);

  const { error } = await supabase.from("gp_processos").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
