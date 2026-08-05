import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/processos/arquivos";

export const runtime = "nodejs";

const PERFIS_ENVIO = ["admin", "operacoes", "gerencia"];

/** Gera uma URL assinada para o navegador enviar o arquivo DIRETO ao storage.
 *
 *  Funções serverless da Vercel recusam corpos acima de ~4,5 MB, e relatórios
 *  com fotos passam disso facilmente. Com a URL assinada o arquivo não trafega
 *  pela função: o navegador fala direto com o storage, e a API só registra o
 *  caminho depois. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_ENVIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Envio de relatório é responsabilidade de Operações." }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const inspecaoId = String(b?.inspecaoId || "");
  const tipo = b?.tipo === "execucao" ? "execucao" : "inspecao";
  const ext = String(b?.ext || "").toLowerCase();
  if (!inspecaoId) return NextResponse.json({ erro: "Inspeção obrigatória." }, { status: 400 });
  if (ext !== "pdf" && ext !== "docx") {
    return NextResponse.json({ erro: "Envie o relatório em PDF ou DOCX." }, { status: 400 });
  }

  // Próxima versão deste bloco, para o caminho não colidir.
  const { data: ultima } = await getSupabaseRouteClient()
    .from("gp_relatorios").select("versao")
    .eq("inspecao_id", inspecaoId).eq("tipo", tipo)
    .order("versao", { ascending: false }).limit(1).maybeSingle();
  const versao = (ultima?.versao || 0) + 1;
  const caminho = `relatorios/${inspecaoId}/${tipo}-v${versao}-${Date.now()}.${ext}`;

  const { data, error } = await getSupabaseAdmin()
    .storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error || !data) {
    return NextResponse.json({ erro: error?.message || "Falha ao preparar o envio." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho, token: data.token, versao });
}
