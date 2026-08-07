import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { uploadArquivo, DOCX_MIME } from "@/lib/processos/arquivos";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "gp-arquivos";

export const runtime = "nodejs";

const PERFIS_ENVIO = ["admin", "operacoes", "gerencia"];

/** Envia (faz upload de) um relatório de inspeção/execução. Cada envio é uma
 * NOVA versão (nova linha) — preserva o histórico de envios (COWORK-ASP §2.3).
 * Entra como 'em_aprovacao' e coloca a inspeção nesse status para a fila da
 * Gerência (fases 5/9). Upload manual de PDF/DOCX. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ENVIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Envio de relatório é responsabilidade de Operações." }, { status: 403 });
  }

  const form = await req.formData();
  const inspecaoId = String(form.get("inspecaoId") || "");
  const tipo = String(form.get("tipo") || "") === "execucao" ? "execucao" : "inspecao";
  // Rascunho: fica anexado ao card sem ir para a fila da Gerência. O envio
  // para aprovação é um segundo passo, explícito (PATCH .../enviar).
  const ehRascunho = String(form.get("rascunho") || "") === "1";
  // Snapshot do formulário — permite reabrir o rascunho para edição.
  let dadosForm: any = null;
  try { const raw = String(form.get("dados") || ""); if (raw) dadosForm = JSON.parse(raw); } catch {}
  // Editar rascunho: salva EM CIMA do registro existente (mesma versão),
  // trocando o arquivo — em vez de empilhar uma versão nova a cada salvamento.
  const substituirId = String(form.get("substituirId") || "");
  const f = form.get("arquivo");
  // Arquivo já enviado direto ao storage (URL assinada) — a função só registra.
  const arquivoPath = String(form.get("arquivoPath") || "");
  const nomeInformado = String(form.get("nomeArquivo") || "");

  if (!inspecaoId) {
    return NextResponse.json({ erro: "Inspeção obrigatória." }, { status: 400 });
  }
  if (!arquivoPath && (!(f instanceof Blob) || !(f as File).name)) {
    return NextResponse.json({ erro: "Envie o relatório no campo 'arquivo'." }, { status: 400 });
  }
  const arquivo = f as File;
  const nomeLower = (arquivoPath || nomeInformado || arquivo?.name || "").toLowerCase();
  const ehPdf = nomeLower.endsWith(".pdf");
  const ehDocx = nomeLower.endsWith(".docx");
  if (!ehPdf && !ehDocx) {
    return NextResponse.json({ erro: "Envie o relatório em PDF ou DOCX." }, { status: 400 });
  }

  const supabase = getSupabaseRouteClient();

  // Próxima versão para este bloco (inspeção/execução) desta inspeção.
  const { data: ultima } = await supabase
    .from("gp_relatorios")
    .select("versao")
    .eq("inspecao_id", inspecaoId)
    .eq("tipo", tipo)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versao = (ultima?.versao || 0) + 1;

  const ext = ehPdf ? "pdf" : "docx";
  let caminho = arquivoPath;
  if (!caminho) {
    caminho = `relatorios/${inspecaoId}/${tipo}-v${versao}.${ext}`;
    try {
      await uploadArquivo(caminho, Buffer.from(await arquivo.arrayBuffer()), ehPdf ? "application/pdf" : DOCX_MIME);
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o arquivo." }, { status: 500 });
    }
  }

  if (substituirId && ehRascunho) {
    const { data: alvo } = await supabase
      .from("gp_relatorios").select("id, status, arquivo_path")
      .eq("id", substituirId).eq("inspecao_id", inspecaoId).maybeSingle();
    if (alvo && alvo.status === "rascunho") {
      const { data: atualizado, error: eUp } = await supabase
        .from("gp_relatorios")
        .update({ arquivo_path: caminho, ...(dadosForm ? { dados: dadosForm } : {}) })
        .eq("id", alvo.id).select("*").single();
      if (eUp) return NextResponse.json({ erro: eUp.message }, { status: 500 });
      // arquivo antigo sai do storage (o novo tem outro nome, não colide)
      if (alvo.arquivo_path && alvo.arquivo_path !== caminho) {
        await getSupabaseAdmin().storage.from(BUCKET).remove([alvo.arquivo_path]).catch(() => {});
      }
      return NextResponse.json({ ok: true, relatorio: atualizado, substituido: true });
    }
    // rascunho sumiu ou já foi enviado: cai no fluxo normal e cria versão nova
  }

  const { data, error } = await supabase
    .from("gp_relatorios")
    .insert({
      inspecao_id: inspecaoId,
      tipo,
      versao,
      arquivo_path: caminho,
      status: ehRascunho ? "rascunho" : "em_aprovacao",
      ...(dadosForm ? { dados: dadosForm } : {}),
      enviado_por: profile.id,
      enviado_em: ehRascunho ? null : new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  if (!ehRascunho) {
    const colStatus = tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
    await supabase.from("gp_inspecoes").update({ [colStatus]: "em_aprovacao" }).eq("id", inspecaoId);
  }

  return NextResponse.json({ ok: true, relatorio: data });
}
