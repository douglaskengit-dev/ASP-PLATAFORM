import { NextRequest, NextResponse } from "next/server";
import { extrairTextoPdf } from "@/lib/pdfExtract";
import { lerLaudoTexto, MINIMO_TEXTO_LAUDO, type LaudoLido } from "@/lib/asp/laudo-leitura";
import { iaDisponivel, lerLaudoViaIA } from "@/lib/asp/laudo-ia";
import { getProfileAtual } from "@/lib/supabase/route";
import { assinaturaArquivo } from "@/lib/validacao";

// pdf-parse precisa de Node (Buffer), não Edge.
export const runtime = "nodejs";
// PDF em imagem é lido pela IA — pode passar dos 10 s padrão.
export const maxDuration = 60;

/** O laudo é texto e tabela — bem abaixo disso. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Lê os valores do laudo do laboratório (Relatório de Ensaio em PDF) para
 *  preencher o formulário do relatório de execução. Só LÊ: o PDF não é
 *  guardado aqui (o anexo do laudo continua pelo campo próprio). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const f = form?.get("arquivo");
  if (!(f instanceof Blob)) return NextResponse.json({ erro: "Envie o laudo em PDF no campo “arquivo”." }, { status: 400 });
  if (f.size > MAX_BYTES) return NextResponse.json({ erro: "O PDF passa de 10 MB — não parece o laudo do laboratório." }, { status: 400 });

  const bytes = Buffer.from(await f.arrayBuffer());
  if (assinaturaArquivo(bytes) !== "pdf") {
    return NextResponse.json({ erro: "O arquivo não é um PDF de verdade (o conteúdo não confere)." }, { status: 400 });
  }

  let texto = "";
  try {
    texto = await extrairTextoPdf(bytes);
  } catch {
    return NextResponse.json({ erro: "Não foi possível ler o PDF. Confira se é o laudo original do laboratório." }, { status: 422 });
  }
  // PDF sem texto (impresso como imagem ou escaneado): a IA lê a imagem.
  let laudo: LaudoLido;
  let origem: "texto" | "ia" = "texto";
  if (texto.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "").trim().length < MINIMO_TEXTO_LAUDO) {
    if (!iaDisponivel()) {
      return NextResponse.json({
        erro: "Este PDF não tem texto — foi impresso como imagem (“Imprimir em PDF”) ou escaneado — e a leitura por IA " +
          "não está configurada. Use o PDF original enviado pelo laboratório, ou digite os valores.",
        semTexto: true,
      }, { status: 422 });
    }
    try {
      laudo = await lerLaudoViaIA(bytes);
      origem = "ia";
    } catch (e) {
      console.error("laudo/ler — IA:", e);
      return NextResponse.json({
        erro: "Este PDF é imagem e a leitura por IA falhou agora. Tente de novo em instantes, ou digite os valores.",
        semTexto: true,
      }, { status: 502 });
    }
  } else {
    laudo = lerLaudoTexto(texto);
  }
  if (!laudo.ehRelatorioDeEnsaio) {
    return NextResponse.json({ erro: "Este PDF não é um Relatório de Ensaio do laboratório (não tem o cabeçalho nem os Resultados Analíticos)." }, { status: 422 });
  }
  if (laudo.lidos === 0) {
    return NextResponse.json({ erro: "Nenhum parâmetro do laudo foi reconhecido — o formato não é o do Relatório de Ensaio padrão." }, { status: 422 });
  }
  return NextResponse.json({ laudo, origem });
}
