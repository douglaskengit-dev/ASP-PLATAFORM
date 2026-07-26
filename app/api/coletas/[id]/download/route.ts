import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { baixarArquivo, respostaArquivo } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

/** Download do PDF de uma coleta. A leitura do registro passa pelo RLS; o
 * arquivo em si vem do bucket privado via cliente admin. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: coleta } = await supabase.from("gp_coletas").select("tipo, pdf_path").eq("id", params.id).single();
  if (!coleta?.pdf_path) {
    return NextResponse.json({ erro: "Coleta sem PDF anexado." }, { status: 404 });
  }

  try {
    const conteudo = await baixarArquivo(coleta.pdf_path);
    return respostaArquivo(conteudo, `Coleta-${coleta.tipo}.pdf`, "application/pdf");
  } catch {
    return NextResponse.json({ erro: "Arquivo não encontrado no storage." }, { status: 404 });
  }
}
