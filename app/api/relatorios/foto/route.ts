import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { baixarArquivo } from "@/lib/processos/arquivos";
import { caminhoFotoValido } from "@/lib/validacao";

export const runtime = "nodejs";

/** Foto salva com um rascunho de relatório (ou da coleta da execução da
 *  mesma OS): GET ?inspecaoId=…&caminho=… — reabrir o rascunho a restaura. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId") || "";
  const caminho = req.nextUrl.searchParams.get("caminho") || "";
  if (!caminhoFotoValido(caminho, inspecaoId)) return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  try {
    const buf = await baixarArquivo(caminho);
    const mime = caminho.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    // o nome é o SHA-256 do conteúdo: mesmo caminho = mesma imagem
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" } });
  } catch {
    return NextResponse.json({ erro: "Foto não encontrada." }, { status: 404 });
  }
}
