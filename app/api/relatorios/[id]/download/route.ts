import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { baixarArquivo, respostaArquivo, DOCX_MIME } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

/** Download de uma versão de relatório (PDF/DOCX). `?arquivo=assinado` baixa
 *  a versão assinada (o documento final); sem isso, o arquivo enviado.
 *
 *  Registra que ESTE usuário abriu ESTA versão (gp_relatorio_visualizacoes):
 *  a aprovação avisa quem aprova sem ter aberto o arquivo. Melhor esforço —
 *  falha no registro não impede o download. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const assinado = req.nextUrl.searchParams.get("arquivo") === "assinado";
  const supabase = getSupabaseRouteClient();
  const { data: rel } = await supabase
    .from("gp_relatorios")
    .select(assinado ? "id, tipo, versao, arquivo_path, assinado_path" : "id, tipo, versao, arquivo_path")
    .eq("id", params.id)
    .single();
  const r: any = rel;
  const caminho: string | null = assinado ? r?.assinado_path : r?.arquivo_path;
  if (!caminho) {
    return NextResponse.json({ erro: assinado ? "Este relatório não tem versão assinada." : "Relatório sem arquivo." }, { status: 404 });
  }

  const ehDocx = caminho.endsWith(".docx");
  const nome = `Relatorio-${r.tipo}-v${r.versao}${assinado ? "-assinado" : ""}.${ehDocx ? "docx" : "pdf"}`;
  try {
    const conteudo = await baixarArquivo(caminho);
    // ?registrar=0: ZIP do "Arquivos" — baixar em lote não é abrir a versão.
    if (req.nextUrl.searchParams.get("registrar") !== "0") try {
      await getSupabaseAdmin().from("gp_relatorio_visualizacoes")
        .upsert({ relatorio_id: params.id, usuario_id: profile.id, em: new Date().toISOString() }, { onConflict: "relatorio_id,usuario_id" });
    } catch { /* melhor esforço */ }
    return respostaArquivo(conteudo, nome, ehDocx ? DOCX_MIME : "application/pdf");
  } catch {
    return NextResponse.json({ erro: "Arquivo não encontrado no storage." }, { status: 404 });
  }
}
