import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/processos/arquivos";
import { infoOSRelatorio, PERFIS_RELATORIO } from "@/lib/asp/relatorio-api";
import { ehUuid } from "@/lib/asp/coleta-api";
import { erroEnvioAssinado, erroTipoNaFase, pastaFotosRascunho } from "@/lib/validacao";

import { garantirOsAberta } from "@/lib/asp/os-encerrada";

export const runtime = "nodejs";

/** Gera uma URL assinada para o navegador enviar o arquivo DIRETO ao storage.
 *
 *  Funções serverless da Vercel recusam corpos acima de ~4,5 MB, e relatórios
 *  com fotos passam disso facilmente. Com a URL assinada o arquivo não trafega
 *  pela função: o navegador fala direto com o storage, e a API só registra o
 *  caminho depois — e confere o arquivo lá (formato, tamanho, SHA-256).
 *
 *  Usos:
 *   · relatório  { inspecaoId, tipo, ext } → relatorios/<OS>/<tipo>-<uuid>.<ext>
 *     O caminho NÃO leva a versão: ela só é decidida no registro (POST
 *     /api/relatorios), então nome e versão nunca divergem.
 *   · foto de rascunho { inspecaoId, foto: { hash, ext } } →
 *     relatorios/<OS>/rascunho-fotos/<sha256>.<ext>. Mesmo conteúdo = mesmo
 *     caminho: se já existe, responde { existe: true } e não sobe de novo.
 *   · PDF do laudo { inspecaoId, laudo: true } → relatorios/<OS>/laudo-<uuid>.pdf */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const b = await req.json().catch(() => ({}));

  // Versão ASSINADA (Fase 5/9) { assinado: relatorioId } →
  // relatorios/<OS>/<tipo>-assinado-<uuid>.pdf. Comercial/Gerência/Admin; o
  // registro (POST /api/relatorios/[id]/assinado) confere o arquivo de novo.
  if (b?.assinado) {
    const relId = String(b.assinado);
    if (!ehUuid(relId)) return NextResponse.json({ erro: "Relatório inválido." }, { status: 400 });
    const { data: rel } = await getSupabaseAdmin().from("gp_relatorios")
      .select("id, inspecao_id, tipo, status, excluido_em").eq("id", relId).maybeSingle();
    if (!rel || (rel as any).excluido_em) return NextResponse.json({ erro: "Relatório não encontrado." }, { status: 404 });
    const travadaA = await garantirOsAberta((rel as any).inspecao_id);
    if (travadaA) return travadaA;
    const infoA = await infoOSRelatorio((rel as any).inspecao_id);
    if (!infoA) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });
    const erroA = erroEnvioAssinado({
      perfil: profile.perfil, status: (rel as any).status, tipo: (rel as any).tipo, fase: infoA.fase, substituir: !!b.substituir,
    });
    if (erroA) return NextResponse.json({ erro: erroA }, { status: 403 });
    const caminhoA = `relatorios/${infoA.id}/${(rel as any).tipo}-assinado-${randomUUID()}.pdf`;
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(caminhoA);
    if (error || !data) return NextResponse.json({ erro: error?.message || "Falha ao preparar o envio." }, { status: 500 });
    return NextResponse.json({ ok: true, caminho: caminhoA, token: data.token });
  }

  if (!PERFIS_RELATORIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Envio de relatório é responsabilidade de Operações." }, { status: 403 });
  }

  const inspecaoId = String(b?.inspecaoId || "");
  // ⛔ OS encerrada: só consulta.
  const travada = await garantirOsAberta(inspecaoId);
  if (travada) return travada;
  const info = await infoOSRelatorio(inspecaoId);
  if (!info) return NextResponse.json({ erro: "OS não encontrada (ou está na lixeira)." }, { status: 404 });
  const storage = getSupabaseAdmin().storage.from(BUCKET);

  // PDF do laudo do laboratório (relatório de execução, Fase 8) →
  // relatorios/<OS>/laudo-<uuid>.pdf. O registro (salvar o rascunho ou o
  // envio de fora) confere o arquivo no storage: PDF, tamanho e SHA-256.
  if (b?.laudo) {
    const erroL = erroTipoNaFase("execucao", info.fase);
    if (erroL) return NextResponse.json({ erro: erroL }, { status: 400 });
    const caminhoL = `relatorios/${inspecaoId}/laudo-${randomUUID()}.pdf`;
    const { data, error } = await storage.createSignedUploadUrl(caminhoL);
    if (error || !data) return NextResponse.json({ erro: error?.message || "Falha ao preparar o envio do laudo." }, { status: 500 });
    return NextResponse.json({ ok: true, caminho: caminhoL, token: data.token });
  }

  if (b?.foto) {
    const hash = String(b.foto.hash || "").toLowerCase();
    const ext = b.foto.ext === "png" ? "png" : b.foto.ext === "jpg" || b.foto.ext === "jpeg" ? "jpg" : "";
    if (!/^[0-9a-f]{64}$/.test(hash) || !ext) {
      return NextResponse.json({ erro: "Foto inválida (só PNG ou JPEG)." }, { status: 400 });
    }
    const nome = `${hash}.${ext}`;
    const pasta = pastaFotosRascunho(inspecaoId);
    const { data: lista } = await storage.list(pasta.replace(/\/$/, ""), { search: nome, limit: 1 });
    if ((lista || []).some((o: any) => o.name === nome)) {
      return NextResponse.json({ ok: true, existe: true, caminho: pasta + nome });
    }
    const { data, error } = await storage.createSignedUploadUrl(pasta + nome, { upsert: true });
    if (error || !data) return NextResponse.json({ erro: error?.message || "Falha ao preparar o envio da foto." }, { status: 500 });
    return NextResponse.json({ ok: true, caminho: pasta + nome, token: data.token });
  }

  const tipo = b?.tipo === "execucao" ? "execucao" : b?.tipo === "inspecao" ? "inspecao" : "";
  const erroTipo = erroTipoNaFase(tipo, info.fase);
  if (erroTipo) return NextResponse.json({ erro: erroTipo }, { status: 400 });
  const ext = String(b?.ext || "").toLowerCase();
  if (ext !== "pdf" && ext !== "docx") {
    return NextResponse.json({ erro: "Envie o relatório em PDF ou DOCX." }, { status: 400 });
  }

  const caminho = `relatorios/${inspecaoId}/${tipo}-${randomUUID()}.${ext}`;
  const { data, error } = await storage.createSignedUploadUrl(caminho);
  if (error || !data) {
    return NextResponse.json({ erro: error?.message || "Falha ao preparar o envio." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, caminho, token: data.token });
}
