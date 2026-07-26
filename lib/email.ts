/**
 * Envio de e-mail (scaffold). O canal in-app já funciona; o e-mail depende de
 * um provedor configurado por variável de ambiente. Enquanto RESEND_API_KEY
 * não existir, esta função é um no-op seguro (não quebra o fluxo).
 *
 * Para ativar: crie uma conta no Resend (ou outro provedor), defina
 *   RESEND_API_KEY  e  EMAIL_REMETENTE  (ex.: "ASP <no-reply@seu-dominio>")
 * na Vercel e no .env.local.
 */
export interface AnexoEmail {
  filename: string;
  /** Conteúdo do anexo (texto). Será convertido para base64. */
  content: string;
  contentType?: string;
}

export async function enviarEmail(
  para: string[],
  assunto: string,
  html: string,
  anexos?: AnexoEmail[],
  opcoes?: { cc?: string[] }
): Promise<{ ok: boolean; ignorado?: boolean; erro?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE || "ASP <onboarding@resend.dev>";
  const destinatarios = para.filter(Boolean);
  const copia = (opcoes?.cc || []).filter((e) => e && !destinatarios.includes(e));
  if (!apiKey || destinatarios.length === 0) {
    return { ok: true, ignorado: true };
  }
  try {
    const body: Record<string, unknown> = { from: remetente, to: destinatarios, subject: assunto, html };
    if (copia.length > 0) body.cc = copia;
    if (anexos && anexos.length > 0) {
      body.attachments = anexos.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "utf-8").toString("base64"),
        content_type: a.contentType || "application/octet-stream",
      }));
    }
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const texto = await resp.text().catch(() => "");
      return { ok: false, erro: `HTTP ${resp.status} — ${texto.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "falha no envio" };
  }
}
