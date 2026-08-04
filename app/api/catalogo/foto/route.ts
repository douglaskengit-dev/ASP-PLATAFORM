import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { uploadArquivo, baixarArquivo, removerArquivos } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

const PERFIS_EDICAO = ["admin", "operacoes", "gerencia"];

/** Envia a foto de um equipamento. Devolve o caminho no storage, que fica
 *  guardado no jsonb `fotos` do equipamento. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o catálogo." }, { status: 403 });
  }
  const form = await req.formData();
  const f = form.get("arquivo");
  const slug = String(form.get("slug") || "equipamento");
  if (!(f instanceof Blob) || !(f as File).name) {
    return NextResponse.json({ erro: "Envie a imagem no campo 'arquivo'." }, { status: 400 });
  }
  const arquivo = f as File;
  const ext = (arquivo.name.split(".").pop() || "jpg").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
    return NextResponse.json({ erro: "Use PNG, JPG ou WEBP." }, { status: 400 });
  }
  const caminho = `catalogo/${slug}/${Date.now()}.${ext}`;
  try {
    await uploadArquivo(caminho, Buffer.from(await arquivo.arrayBuffer()), arquivo.type || `image/${ext}`);
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho });
}

/** Serve a imagem: /api/catalogo/foto?caminho=... */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminho.startsWith("catalogo/")) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  try {
    const buf = await baixarArquivo(caminho);
    const ext = caminho.split(".").pop()?.toLowerCase() || "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ erro: "Imagem não encontrada." }, { status: 404 });
  }
}

/** Remove a imagem do storage: ?caminho=... */
export async function DELETE(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminho.startsWith("catalogo/")) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  try { await removerArquivos([caminho]); } catch { /* órfão não bloqueia */ }
  return NextResponse.json({ ok: true });
}
