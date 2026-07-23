import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { uploadArquivo } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

/** Anexa (ou substitui) o relatório em PDF exportado pela ferramenta Medidor
 * de Sedimento — usada na etapa "Coleta de dados de Campo". O PDF é gerado
 * localmente no navegador (a ferramenta não envia dados para o servidor); o
 * usuário exporta e depois anexa aqui manualmente. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: processo } = await supabase
    .from("gp_processos")
    .select("id, arquivos")
    .eq("id", params.id)
    .single();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const form = await req.formData();
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof Blob) || !(arquivo as File).name) {
    return NextResponse.json({ erro: "Envie o relatório no campo 'arquivo'." }, { status: 400 });
  }

  const nome = (arquivo as File).name;
  if (!nome.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ erro: "Envie o relatório exportado em PDF." }, { status: 400 });
  }

  const caminho = `${params.id}/Medicao-Sedimento.pdf`;
  await uploadArquivo(caminho, Buffer.from(await arquivo.arrayBuffer()), "application/pdf");

  const arquivos = { ...(processo.arquivos || {}), medicao_sedimento: caminho };
  const { error } = await supabase
    .from("gp_processos")
    .update({ arquivos, updated_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
