/**
 * Envio de e-mail (scaffold). O canal in-app já funciona; o e-mail depende de
 * um provedor configurado por variável de ambiente. Enquanto RESEND_API_KEY
 * não existir, esta função é um no-op seguro (não quebra o fluxo).
 *
 * Para ativar: crie uma conta no Resend (ou outro provedor), defina
 *   RESEND_API_KEY  e  EMAIL_REMETENTE  (ex.: "ASP <no-reply@seu-dominio>")
 * na Vercel e no .env.local.
 */
export async function enviarEmail(
  para: string[],
  assunto: string,
  html: string
): Promise<{ ok: boolean; ignorado?: boolean; erro?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE || "ASP <onboarding@resend.dev>";
  const destinatarios = para.filter(Boolean);
  if (!apiKey || destinatarios.length === 0) {
    return { ok: true, ignorado: true };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remetente, to: destinatarios, subject: assunto, html }),
    });
    if (!resp.ok) return { ok: false, erro: `HTTP ${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "falha no envio" };
  }
}
