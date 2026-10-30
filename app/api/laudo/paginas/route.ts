import { NextRequest, NextResponse } from "next/server";
import { renderizarPaginasPdf } from "@/lib/pdfExtract";
import { baixarArquivo } from "@/lib/processos/arquivos";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { caminhoLaudoValido } from "@/lib/validacao";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Páginas por laudo que entram no relatório (o Relatório de Ensaio tem 2). */
const MAX_PAGINAS = 3;
/** ~150 dpi numa A4: legível no relatório sem pesar o .docx. */
const LARGURA_PX = 1240;

/** "Prints" do laudo do laboratório anexado à OS: cada página do PDF em PNG,
 *  para o relatório de execução trazer as páginas como figuras. Só lê o PDF
 *  já guardado (caminho do laudo desta OS). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });

  const corpo = await req.json().catch(() => null) as { inspecaoId?: string; caminho?: string } | null;
  const inspecaoId = String(corpo?.inspecaoId || ""), caminho = String(corpo?.caminho || "");
  if (!inspecaoId || !caminhoLaudoValido(caminho, inspecaoId)) {
    return NextResponse.json({ erro: "Laudo inválido para esta OS." }, { status: 400 });
  }
  // a OS precisa estar visível para quem pede (regras de acesso do banco)
  const { data: os } = await getSupabaseRouteClient().from("gp_inspecoes").select("id").eq("id", inspecaoId).maybeSingle();
  if (!os) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });

  try {
    const pdf = await baixarArquivo(caminho);
    const paginas = await renderizarPaginasPdf(pdf, LARGURA_PX, MAX_PAGINAS);
    return NextResponse.json({ paginas: paginas.map((b) => b.toString("base64")) });
  } catch (e) {
    console.error("laudo/paginas:", e);
    return NextResponse.json({ erro: "Não foi possível gerar as páginas do laudo." }, { status: 422 });
  }
}
