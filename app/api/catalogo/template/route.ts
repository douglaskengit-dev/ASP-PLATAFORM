import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { uploadArquivo, baixarArquivo, DOCX_MIME } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

const PERFIS_EDICAO = ["admin", "operacoes", "gerencia"];

/** Modelo .docx próprio de um procedimento.
 *
 *  Permite ter vários TIPOS de relatório sem duplicar o formulário: o
 *  procedimento aponta para o seu modelo e o gerador usa aquele arquivo no
 *  lugar do padrão. O caminho fica em gp_procedimentos.template_path. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o catálogo." }, { status: 403 });
  }

  const form = await req.formData();
  const f = form.get("arquivo");
  const codigo = String(form.get("codigo") || "procedimento").replace(/[^\w-]+/g, "-");
  if (!(f instanceof Blob) || !(f as File).name) {
    return NextResponse.json({ erro: "Envie o modelo no campo 'arquivo'." }, { status: 400 });
  }
  const arquivo = f as File;
  if (!arquivo.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ erro: "O modelo precisa ser um arquivo .docx." }, { status: 400 });
  }

  const caminho = `catalogo/modelos/${codigo}-${Date.now()}.docx`;
  try {
    await uploadArquivo(caminho, Buffer.from(await arquivo.arrayBuffer()), DOCX_MIME);
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o modelo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho, nome: arquivo.name });
}

/** Serve o modelo para o gerador (roda no navegador): ?caminho=... */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminho.startsWith("catalogo/modelos/")) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  try {
    const buf = await baixarArquivo(caminho);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": DOCX_MIME, "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return NextResponse.json({ erro: "Modelo não encontrado." }, { status: 404 });
  }
}
