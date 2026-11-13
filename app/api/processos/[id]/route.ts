import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { removerArquivos } from "@/lib/processos/arquivos";
import { aplicarProcedimento, faltaMigracaoCrm, MSG_MIGRACAO_CRM } from "@/lib/processos/crm-api";
import { hojeBrasil, podeUsarCrm, validarOportunidade } from "@/lib/validacao";

export const runtime = "nodejs";

/** Edita a oportunidade: só os campos enviados (título/procedimento, cliente, contato,
 * valor, origem, responsável, previsão de fechamento e próxima ação). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!podeUsarCrm(profile.perfil)) {
    return NextResponse.json({ erro: "O Follow-up é do Comercial, da Gerência e da Administração." }, { status: 403 });
  }

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validarOportunidade(corpo, hojeBrasil());
  if ("erro" in v) return NextResponse.json({ erro: v.erro }, { status: 400 });
  if (!Object.keys(v.colunas).length) return NextResponse.json({ erro: "Nada para salvar." }, { status: 400 });

  const supabase = getSupabaseRouteClient();
  const erroProc = await aplicarProcedimento(supabase, v.colunas);
  if (erroProc) return NextResponse.json({ erro: erroProc }, { status: 400 });
  // Trocou o cliente: o contato antigo não vale mais.
  if (v.colunas.orgao_id && !Object.prototype.hasOwnProperty.call(v.colunas, "contato_id")) {
    const { data: atual } = await supabase.from("gp_processos").select("orgao_id").eq("id", params.id).maybeSingle();
    if (atual && atual.orgao_id !== v.colunas.orgao_id) v.colunas.contato_id = null;
  }
  const { data, error } = await supabase
    .from("gp_processos")
    .update({ ...v.colunas, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();
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
  await removerArquivos(caminhos);

  // ofícios vinculados voltam ao drop
  await supabase.from("gp_oficios").update({ job_id: null }).eq("job_id", params.id);

  const { error } = await supabase.from("gp_processos").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
