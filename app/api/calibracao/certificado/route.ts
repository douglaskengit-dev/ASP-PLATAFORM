import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { BUCKET, uploadArquivo } from "@/lib/processos/arquivos";
import { removerCertificadoSemUso } from "@/lib/asp/calibracao-api";
import { PERFIS_EDICAO_CATALOGO } from "@/lib/asp/catalogo-api";
import { caminhoCertificadoValido, CERTIFICADO_MAX_BYTES, PASTA_CERTIFICADOS } from "@/lib/validacao";

export const runtime = "nodejs";

/** Envia o PDF do certificado de calibração (campo "arquivo"). Confere pelos
 *  BYTES (começa com %PDF-), até 4 MB. Só passa a valer quando a calibração
 *  é registrada (POST /api/calibracao confere que o arquivo existe). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para editar calibrações." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const f = form?.get("arquivo");
  if (!(f instanceof Blob)) return NextResponse.json({ erro: "Envie o PDF no campo “arquivo”." }, { status: 400 });
  if (f.size > CERTIFICADO_MAX_BYTES) {
    return NextResponse.json({ erro: "O PDF passa de 4 MB — reduza (ex.: “Salvar como PDF reduzido”) e envie de novo." }, { status: 400 });
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  const cabeca = new TextDecoder().decode(bytes.slice(0, 5));
  if (cabeca !== "%PDF-") return NextResponse.json({ erro: "O arquivo não é um PDF (o conteúdo não confere)." }, { status: 400 });
  const caminho = `${PASTA_CERTIFICADOS}${randomUUID()}.pdf`;
  try {
    await uploadArquivo(caminho, bytes, "application/pdf");
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho });
}

/** Abre o certificado: ?caminho=… → link assinado do storage (o PDF não
 *  passa pela function). */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminhoCertificadoValido(caminho)) return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) return NextResponse.json({ erro: "Certificado não encontrado." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 302);
}

/** Descarta um PDF enviado e não usado (formulário cancelado): ?caminho=… —
 *  só apaga se nenhuma calibração o usa. */
export async function DELETE(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  const caminho = req.nextUrl.searchParams.get("caminho");
  if (!caminhoCertificadoValido(caminho)) return NextResponse.json({ erro: "Caminho inválido." }, { status: 400 });
  const removido = await removerCertificadoSemUso(caminho);
  return NextResponse.json({ ok: true, removido });
}
