import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { baixarArquivo, respostaArquivo, DOCX_MIME } from "@/lib/processos/arquivos";
import { nomeArquivoRdo, normalizarDadosRdo } from "@/lib/asp/rdo";

export const runtime = "nodejs";

/** Download do .docx do RDO, com o nome no padrão da ASP
 *  ("Guardian - VRO - 25.09.26.docx"). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const { data: rdo } = await getSupabaseRouteClient()
    .from("gp_rdos").select("data, dados, arquivo_path").eq("id", params.id).maybeSingle();
  if (!rdo?.arquivo_path) return NextResponse.json({ erro: "RDO sem arquivo gerado." }, { status: 404 });
  try {
    const conteudo = await baixarArquivo(rdo.arquivo_path);
    return respostaArquivo(conteudo, nomeArquivoRdo(normalizarDadosRdo(rdo.dados), rdo.data), DOCX_MIME);
  } catch {
    return NextResponse.json({ erro: "Arquivo não encontrado no storage." }, { status: 404 });
  }
}
