import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { baixarArquivo, respostaArquivo, DOCX_MIME } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

/** Download de uma versão de relatório (PDF/DOCX). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: rel } = await supabase
    .from("gp_relatorios")
    .select("tipo, versao, arquivo_path")
    .eq("id", params.id)
    .single();
  if (!rel?.arquivo_path) {
    return NextResponse.json({ erro: "Relatório sem arquivo." }, { status: 404 });
  }

  const ehDocx = rel.arquivo_path.endsWith(".docx");
  const nome = `Relatorio-${rel.tipo}-v${rel.versao}.${ehDocx ? "docx" : "pdf"}`;
  try {
    const conteudo = await baixarArquivo(rel.arquivo_path);
    return respostaArquivo(conteudo, nome, ehDocx ? DOCX_MIME : "application/pdf");
  } catch {
    return NextResponse.json({ erro: "Arquivo não encontrado no storage." }, { status: 404 });
  }
}
