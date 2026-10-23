import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { uploadArquivo, removerArquivos, DOCX_MIME } from "@/lib/processos/arquivos";
import { caminhoRdo } from "@/lib/asp/rdo";
import { podePrepararRdo } from "@/lib/asp/permissoes";
import { garantirOsAberta, osDoRdo } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** Limite folgado: o RDO só tem os dois logos do modelo (~50 KB). Cabe no
 *  corpo da função serverless, então dispensa a URL assinada dos relatórios
 *  — e assim o envio também passa pela fila offline (enviarArquivo). */
const MAX_BYTES = 3 * 1024 * 1024;

/** Recebe o .docx gerado no navegador (multipart: arquivo) e o grava em
 *  rdos/<projeto>/RDO-<nº>-<data>.docx. Marca `arquivo_em`: o arquivo vale
 *  até a próxima alteração dos dados. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  // Gerar/enviar o .docx: perfil OU função com "Preparar RDO".
  if (!podePrepararRdo(profile)) {
    return NextResponse.json({ erro: "RDO é com Operações, Gerência, Admin ou uma função com a permissão “Preparar RDO”." }, { status: 403 });
  }
  const supabase = getSupabaseRouteClient();
  const { data: rdo } = await supabase.from("gp_rdos")
    .select("id, projeto_id, numero, data, arquivo_path").eq("id", params.id).is("excluido_em", null).maybeSingle();
  if (!rdo) return NextResponse.json({ erro: "RDO não encontrado." }, { status: 404 });
  // ⛔ Gerar de novo o .docx é alterar o RDO: travado se cobre OS encerrada.
  const travada = await garantirOsAberta(await osDoRdo(params.id), { rdo: true });
  if (travada) return travada;

  const form = await req.formData();
  const f = form.get("arquivo");
  if (!(f instanceof Blob) || f.size === 0) return NextResponse.json({ erro: "Envie o arquivo do RDO." }, { status: 400 });
  if (f.size > MAX_BYTES) return NextResponse.json({ erro: "Arquivo do RDO grande demais." }, { status: 400 });
  const buf = Buffer.from(await f.arrayBuffer());
  // .docx é um ZIP: começa com "PK".
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ erro: "O RDO deve ser um .docx." }, { status: 400 });

  const caminho = caminhoRdo(rdo.projeto_id, rdo.numero, rdo.data);
  try {
    await uploadArquivo(caminho, buf, DOCX_MIME);
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : "Falha ao salvar o arquivo." }, { status: 500 });
  }
  const { data, error } = await supabase.from("gp_rdos")
    .update({ arquivo_path: caminho, arquivo_em: new Date().toISOString() })
    .eq("id", rdo.id).select("id, arquivo_path, arquivo_em").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  // A data mudou desde o último envio: o arquivo antigo tinha outro nome.
  if (rdo.arquivo_path && rdo.arquivo_path !== caminho) await removerArquivos([rdo.arquivo_path]);
  return NextResponse.json({ ok: true, rdo: data });
}
