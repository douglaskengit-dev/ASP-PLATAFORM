import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { uploadArquivo } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

const PERFIS_COLETA = ["admin", "operacoes", "gerencia"];

interface NovaColetaJson {
  inspecaoId: string;
  tipo?: string;
  dados?: unknown;
  pdfPath?: string;
}

/** Salva uma coleta (medidor de sedimento): medição completa em jsonb + PDF.
 * Persistir os dados permite reabrir/editar depois, não só o PDF (COWORK-ASP §2.5).
 * Aceita JSON (só dados) ou multipart/form-data (dados + PDF exportado). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_COLETA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Coleta é responsabilidade de Operações." }, { status: 403 });
  }

  const supabase = getSupabaseRouteClient();
  const contentType = req.headers.get("content-type") || "";

  let inspecaoId = "";
  let tipo = "sedimento";
  let dados: unknown = {};
  let arquivo: File | null = null;
  let pdfPathInformado: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    inspecaoId = String(form.get("inspecaoId") || "");
    tipo = String(form.get("tipo") || "sedimento").trim() || "sedimento";
    const dadosRaw = form.get("dados");
    if (typeof dadosRaw === "string" && dadosRaw.trim()) {
      try { dados = JSON.parse(dadosRaw); } catch { dados = {}; }
    }
    const f = form.get("arquivo");
    if (f instanceof Blob && (f as File).name) arquivo = f as File;
  } else {
    const body = (await req.json()) as NovaColetaJson;
    inspecaoId = body.inspecaoId;
    tipo = body.tipo?.trim() || "sedimento";
    dados = body.dados ?? {};
    pdfPathInformado = body.pdfPath || null;
  }

  if (!inspecaoId) {
    return NextResponse.json({ erro: "Inspeção obrigatória." }, { status: 400 });
  }
  if (arquivo && !arquivo.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ erro: "Anexe o relatório exportado em PDF." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("gp_coletas")
    .insert({
      inspecao_id: inspecaoId,
      tipo,
      dados: dados ?? {},
      pdf_path: pdfPathInformado,
      criado_por: profile.id,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // Sobe o PDF (se veio) e grava o caminho na coleta recém-criada.
  if (arquivo) {
    const caminho = `coletas/${inspecaoId}/${data.id}.pdf`;
    try {
      await uploadArquivo(caminho, Buffer.from(await arquivo.arrayBuffer()), "application/pdf");
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o PDF." }, { status: 500 });
    }
    await supabase.from("gp_coletas").update({ pdf_path: caminho, atualizado_em: new Date().toISOString() }).eq("id", data.id);
    data.pdf_path = caminho;
  }

  return NextResponse.json({ ok: true, coleta: data });
}
