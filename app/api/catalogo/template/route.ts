import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { uploadArquivo, baixarArquivo, DOCX_MIME } from "@/lib/processos/arquivos";
import { examinarModeloDocx, PERFIS_EDICAO_CATALOGO, removerSeSemUso } from "@/lib/asp/catalogo-api";
import { caminhoModeloValido, MODELO_MAX_BYTES, PASTA_MODELOS } from "@/lib/validacao";

export const runtime = "nodejs";

/** Modelo .docx próprio de um procedimento.
 *
 *  Permite ter vários TIPOS de relatório sem duplicar o formulário: o
 *  procedimento aponta para o seu modelo e o gerador usa aquele arquivo no
 *  lugar do padrão. O caminho fica em gp_procedimentos.template_path.
 *
 *  Confere pelos BYTES (DOCX de verdade, até 20 MB). O caminho usa um uuid —
 *  não o código, que pode ser renomeado. Só vira o modelo do procedimento
 *  quando ele é salvo; o modelo anterior é apagado depois disso. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar o Catálogo." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const f = form?.get("arquivo");
  if (!(f instanceof Blob)) {
    return NextResponse.json({ erro: "Envie o modelo no campo “arquivo”." }, { status: 400 });
  }
  if (f.size > MODELO_MAX_BYTES) {
    return NextResponse.json({ erro: "O modelo passa de 20 MB — reduza as imagens do .docx e envie de novo." }, { status: 400 });
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  const problema = await examinarModeloDocx(bytes);
  if (problema) return NextResponse.json({ erro: problema }, { status: 400 });

  const caminho = `${PASTA_MODELOS}${randomUUID()}.docx`;
  try {
    await uploadArquivo(caminho, bytes, DOCX_MIME);
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o modelo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho, nome: (f as File).name || "modelo.docx" });
}

/** Serve o modelo para o gerador (roda no navegador): ?caminho=...
 *  Com &baixar=1 vai como anexo, para salvar no computador; &nome= dá o nome
 *  do arquivo (ex.: "Modelo POP 001.docx"). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminhoModeloValido(caminho)) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  try {
    const buf = await baixarArquivo(caminho);
    const headers: Record<string, string> = { "Content-Type": DOCX_MIME, "Cache-Control": "private, max-age=300" };
    if (req.nextUrl.searchParams.get("baixar") === "1") {
      const nome = (req.nextUrl.searchParams.get("nome") || "modelo").replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 80) || "modelo";
      const arquivo = nome.toLowerCase().endsWith(".docx") ? nome : `${nome}.docx`;
      // filename= só aceita ASCII; o nome com acento vai no filename* (RFC 5987)
      const ascii = arquivo.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
      headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(arquivo)}`;
    }
    return new NextResponse(new Uint8Array(buf), { headers });
  } catch {
    return NextResponse.json({ erro: "Modelo não encontrado." }, { status: 404 });
  }
}

/** Descarta um modelo enviado e não usado (edição cancelada): ?caminho=...
 *  — só apaga se nenhum procedimento salvo aponta para ele. */
export async function DELETE(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminho || !caminhoModeloValido(caminho)) {
    return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  }
  const removidos = await removerSeSemUso([caminho]);
  return NextResponse.json({ ok: true, removido: removidos.length > 0 });
}
