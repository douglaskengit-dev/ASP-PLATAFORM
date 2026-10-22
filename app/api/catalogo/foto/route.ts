import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { uploadArquivo, baixarArquivo } from "@/lib/processos/arquivos";
import { examinarFotoCatalogo, PERFIS_EDICAO_CATALOGO, removerSeSemUso } from "@/lib/asp/catalogo-api";
import { caminhoFotoCatalogoValido, FOTO_CATALOGO_MAX_BYTES, PASTA_FOTOS_CATALOGO } from "@/lib/validacao";

export const runtime = "nodejs";

/** Envia a foto de um equipamento. Confere pelos BYTES (JPEG ou PNG — o
 *  navegador já converteu WebP/GIF/HEIC — até 10 MB) e devolve o caminho e
 *  o SHA-256. A foto só passa a fazer parte do equipamento quando ele é
 *  salvo; o PATCH confere de novo. Caminho com uuid (não o slug): a pasta
 *  não depende de nada que o usuário digita. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o Catálogo." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const f = form?.get("arquivo");
  if (!(f instanceof Blob)) {
    return NextResponse.json({ erro: "Envie a imagem no campo “arquivo”." }, { status: 400 });
  }
  if (f.size > FOTO_CATALOGO_MAX_BYTES) {
    return NextResponse.json({ erro: "A imagem passa de 10 MB — reduza a resolução e envie de novo." }, { status: 400 });
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  const ex = examinarFotoCatalogo(bytes);
  if (ex.erro || !ex.formato) return NextResponse.json({ erro: ex.erro }, { status: 400 });
  const ext = ex.formato === "png" ? "png" : "jpg";
  const caminho = `${PASTA_FOTOS_CATALOGO}${randomUUID()}.${ext}`;
  try {
    await uploadArquivo(caminho, bytes, ex.formato === "png" ? "image/png" : "image/jpeg");
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho, hash: ex.hash });
}

/** Serve a imagem: /api/catalogo/foto?caminho=... */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminhoFotoCatalogoValido(caminho)) {
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

/** Descarta uma foto enviada e não usada (ex.: edição cancelada):
 *  ?caminho=... — só apaga se NENHUM equipamento salvo a usa. Tirar a foto
 *  de um equipamento acontece ao salvar (o PATCH apaga as que saíram). */
export async function DELETE(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminhoFotoCatalogoValido(caminho)) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  const removidos = await removerSeSemUso([caminho]);
  return NextResponse.json({ ok: true, removida: removidos.length > 0 });
}
