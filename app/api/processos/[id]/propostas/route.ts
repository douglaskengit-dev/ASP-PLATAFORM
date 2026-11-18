import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { baixarArquivo, removerArquivos, respostaArquivo, uploadArquivo } from "@/lib/processos/arquivos";
import { faltaMigracaoCrm } from "@/lib/processos/crm-api";
import { hojeBrasil, podeUsarCrm, validarArquivoProposta, validarProposta } from "@/lib/validacao";

export const runtime = "nodejs";

const SEM_ACESSO = { erro: "O Follow-up é do Comercial, da Gerência e da Administração." };
const MSG_MIGRACAO =
  "As versões da proposta precisam da migração 20261118100000_asp_crm_propostas_projeto no Supabase. Peça ao administrador para rodá-la.";
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const extensao = (nome: string) => (nome.split(".").pop() || "").toLowerCase();

/** Versões da proposta (mais nova primeiro). Com ?arquivo=<id da versão>,
 *  baixa o arquivo anexado àquela versão. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) return NextResponse.json(SEM_ACESSO, { status: 403 });
  const supabase = getSupabaseRouteClient();

  const idArquivo = req.nextUrl.searchParams.get("arquivo");
  if (idArquivo) {
    const { data } = await supabase.from("gp_processo_propostas").select("arquivo, arquivo_nome, versao")
      .eq("id", idArquivo).eq("processo_id", params.id).maybeSingle();
    if (!data?.arquivo) return NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 });
    const nome = data.arquivo_nome || `Proposta-v${data.versao}.${extensao(data.arquivo)}`;
    return respostaArquivo(await baixarArquivo(data.arquivo), nome, MIME[extensao(data.arquivo)] || "application/octet-stream");
  }

  const { data, error } = await supabase.from("gp_processo_propostas")
    .select("id, versao, data, valor, observacao, arquivo_nome, arquivo, criado_em, criado_por, autor:gp_profiles!gp_processo_propostas_criado_por_fkey(nome_completo)")
    .eq("processo_id", params.id).order("versao", { ascending: false });
  if (error && faltaMigracaoCrm(error)) return NextResponse.json({ ok: true, propostas: [], aviso: MSG_MIGRACAO });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    propostas: (data || []).map((p: any) => ({
      id: p.id, versao: p.versao, data: p.data, valor: p.valor == null ? null : Number(p.valor), observacao: p.observacao,
      arquivo_nome: p.arquivo ? (p.arquivo_nome || `Proposta-v${p.versao}`) : null, criado_em: p.criado_em,
      autor: p.autor?.nome_completo || null, minha: p.criado_por === profile.id,
    })),
  });
}

/** Registra uma nova versão (formulário: data, valor, observacao, arquivo
 *  opcional). O número da versão é o seguinte ao último; com valor, ele passa
 *  a ser o valor da oportunidade. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) return NextResponse.json(SEM_ACESSO, { status: 403 });

  const form = await req.formData();
  const arquivo = form.get("arquivo");
  const temArquivo = arquivo instanceof Blob && arquivo.size > 0 && !!(arquivo as File).name;
  const v = validarProposta({
    data: String(form.get("data") || ""), valor: String(form.get("valor") || ""),
    observacao: String(form.get("observacao") || ""), temArquivo,
  }, hojeBrasil());
  if ("erro" in v) return NextResponse.json({ erro: v.erro }, { status: 400 });
  if (temArquivo) {
    const erroArq = validarArquivoProposta((arquivo as File).name, arquivo.size);
    if (erroArq) return NextResponse.json({ erro: erroArq }, { status: 400 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: processo } = await supabase.from("gp_processos").select("id").eq("id", params.id).maybeSingle();
  if (!processo) return NextResponse.json({ erro: "Oportunidade não encontrada." }, { status: 404 });

  // Número da versão: o seguinte ao maior. A chave única resolve a corrida
  // (duas versões ao mesmo tempo): tenta de novo com o próximo número.
  let criada: { id: string; versao: number } | null = null;
  for (let tentativa = 0; tentativa < 3 && !criada; tentativa++) {
    const { data: ultima, error: eUlt } = await supabase.from("gp_processo_propostas").select("versao")
      .eq("processo_id", params.id).order("versao", { ascending: false }).limit(1).maybeSingle();
    if (eUlt && faltaMigracaoCrm(eUlt)) return NextResponse.json({ erro: MSG_MIGRACAO }, { status: 409 });
    const versao = (ultima?.versao || 0) + 1;
    const { data, error } = await supabase.from("gp_processo_propostas")
      .insert({ processo_id: params.id, versao, data: v.data, valor: v.valor, observacao: v.observacao, criado_por: profile.id })
      .select("id, versao").single();
    if (error && (error as any).code === "23505") continue;
    if (error && faltaMigracaoCrm(error)) return NextResponse.json({ erro: MSG_MIGRACAO }, { status: 409 });
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
    criada = data;
  }
  if (!criada) return NextResponse.json({ erro: "Outra versão foi registrada ao mesmo tempo. Tente de novo." }, { status: 409 });

  if (temArquivo) {
    const nome = (arquivo as File).name;
    const ext = extensao(nome);
    const caminho = `${params.id}/propostas/v${criada.versao}-${Date.now()}.${ext}`;
    try {
      await uploadArquivo(caminho, Buffer.from(await arquivo.arrayBuffer()), MIME[ext] || "application/octet-stream");
    } catch (e: any) {
      await supabase.from("gp_processo_propostas").delete().eq("id", criada.id);
      return NextResponse.json({ erro: e?.message || "Falha ao salvar o arquivo." }, { status: 500 });
    }
    await supabase.from("gp_processo_propostas").update({ arquivo: caminho, arquivo_nome: nome.slice(0, 200) }).eq("id", criada.id);
  }

  const mudanca: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.valor !== null) mudanca.valor = v.valor;
  await supabase.from("gp_processos").update(mudanca).eq("id", params.id);
  return NextResponse.json({ ok: true, id: criada.id, versao: criada.versao });
}

/** Apaga uma versão (?proposta=<id>): o autor ou um administrador. Se era a
 *  mais nova, o valor da oportunidade volta ao da versão anterior com valor. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  if (!podeUsarCrm(profile.perfil)) return NextResponse.json(SEM_ACESSO, { status: 403 });
  const id = req.nextUrl.searchParams.get("proposta");
  if (!id) return NextResponse.json({ erro: "Versão não informada." }, { status: 400 });

  const supabase = getSupabaseRouteClient();
  const { data: maisNova } = await supabase.from("gp_processo_propostas").select("id")
    .eq("processo_id", params.id).order("versao", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("gp_processo_propostas").delete()
    .eq("id", id).eq("processo_id", params.id).select("arquivo");
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ erro: "Versão não encontrada ou de outra pessoa." }, { status: 404 });
  await removerArquivos(data.map((x: any) => x.arquivo).filter(Boolean));

  if (maisNova?.id === id) {
    const { data: anterior } = await supabase.from("gp_processo_propostas").select("valor")
      .eq("processo_id", params.id).not("valor", "is", null).order("versao", { ascending: false }).limit(1).maybeSingle();
    if (anterior) {
      await supabase.from("gp_processos").update({ valor: anterior.valor, updated_at: new Date().toISOString() }).eq("id", params.id);
    }
  }
  return NextResponse.json({ ok: true });
}
