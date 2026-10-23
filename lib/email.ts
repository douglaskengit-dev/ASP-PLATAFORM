/**
 * Envio de e-mail, independente do provedor. O canal in-app funciona sem
 * isto; o e-mail depende de variáveis de ambiente (regras em
 * lib/validacao/email.ts):
 *
 *  - SMTP (ex.: Gmail com senha de app) quando SMTP_HOST estiver definido
 *    (ou EMAIL_PROVEDOR=smtp): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
 *  - Resend quando houver RESEND_API_KEY (ou EMAIL_PROVEDOR=resend).
 *  - Nenhum: no-op seguro ({ ok: true, ignorado: true }) — não quebra o fluxo.
 *
 * EMAIL_REMETENTE ("ASP <conta@gmail.com>") e EMAIL_RESPONDER_PARA (Reply-To)
 * são opcionais. Só roda no runtime Node.js (nodemailer usa sockets) — as
 * rotas que enviam e-mail declaram `runtime = "nodejs"`. Senhas e chaves
 * nunca vão para log. Passo a passo do Gmail: README, "E-mail via Gmail".
 */
import nodemailer from "nodemailer";
import {
  configSmtp, faltandoConfig, provedorEmail, remetenteEmail, resumoErroSmtp, traduzirErroSmtp,
  SMTP_TIMEOUT_MS, type ProvedorEmail,
} from "@/lib/validacao/email";

export interface AnexoEmail {
  filename: string;
  /** Conteúdo do anexo (texto). */
  content: string;
  contentType?: string;
}

export interface ResultadoEmail {
  ok: boolean;
  /** Não enviado por falta de configuração (ou sem destinatários). */
  ignorado?: boolean;
  /** Mensagem do erro. No SMTP, já em português (traduzirErroSmtp). */
  erro?: string;
  /** Detalhe técnico curto (código/resposta do servidor), sem segredos. */
  detalhe?: string;
  provedor?: ProvedorEmail;
}

let avisouRemetente = false;

export async function enviarEmail(
  para: string[],
  assunto: string,
  html: string,
  anexos?: AnexoEmail[],
  opcoes?: { cc?: string[]; /** Versão em texto puro (clientes sem HTML). */ texto?: string }
): Promise<ResultadoEmail> {
  const env = process.env;
  const provedor = provedorEmail(env);
  const destinatarios = para.filter(Boolean);
  const copia = (opcoes?.cc || []).filter((e) => e && !destinatarios.includes(e));
  if (provedor === "nenhum" || destinatarios.length === 0 || faltandoConfig(env, provedor).length > 0) {
    return { ok: true, ignorado: true, provedor };
  }
  const rem = remetenteEmail(env, provedor);
  if (rem.aviso && !avisouRemetente) {
    avisouRemetente = true;
    console.warn("[email]", rem.aviso);
  }
  const responderPara = (env.EMAIL_RESPONDER_PARA || "").trim() || undefined;
  const msg = { from: rem.from, to: destinatarios, cc: copia, subject: assunto, html, texto: opcoes?.texto, replyTo: responderPara, anexos: anexos || [] };
  return provedor === "smtp" ? enviarSmtp(msg) : enviarResend(msg);
}

interface Mensagem {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  texto?: string;
  replyTo?: string;
  anexos: AnexoEmail[];
}

async function enviarSmtp(m: Mensagem): Promise<ResultadoEmail> {
  const cfg = configSmtp(process.env);
  let transporte: ReturnType<typeof nodemailer.createTransport> | null = null;
  try {
    // Sem pool: na função serverless cada envio abre e fecha a conexão.
    transporte = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // 587 (e Gmail fora da 465): exige STARTTLS antes de mandar a senha.
      requireTLS: !cfg.secure && (cfg.port === 587 || cfg.ehGmail),
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      pool: false,
      // Nada de arquivos/URLs como conteúdo de anexo: só o texto que passamos.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await transporte.sendMail({
      from: m.from,
      to: m.to,
      ...(m.cc.length > 0 ? { cc: m.cc } : {}),
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      subject: m.subject,
      html: m.html,
      ...(m.texto ? { text: m.texto } : {}),
      ...(m.anexos.length > 0
        ? { attachments: m.anexos.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType || "application/octet-stream" })) }
        : {}),
    });
    return { ok: true, provedor: "smtp" };
  } catch (e) {
    const err = (e || {}) as Record<string, any>;
    const bruto = { code: err.code, responseCode: err.responseCode, response: err.response, command: err.command, message: err.message };
    const detalhe = resumoErroSmtp(bruto, cfg.pass);
    console.error("[email] SMTP:", detalhe);
    return { ok: false, provedor: "smtp", erro: traduzirErroSmtp(bruto), detalhe };
  } finally {
    try { transporte?.close(); } catch { /* já fechado */ }
  }
}

async function enviarResend(m: Mensagem): Promise<ResultadoEmail> {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  try {
    const body: Record<string, unknown> = { from: m.from, to: m.to, subject: m.subject, html: m.html };
    if (m.cc.length > 0) body.cc = m.cc;
    if (m.replyTo) body.reply_to = m.replyTo;
    if (m.texto) body.text = m.texto;
    if (m.anexos.length > 0) {
      body.attachments = m.anexos.map((a) => ({
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
      return { ok: false, provedor: "resend", erro: `HTTP ${resp.status} — ${texto.slice(0, 300)}` };
    }
    return { ok: true, provedor: "resend" };
  } catch (e) {
    return { ok: false, provedor: "resend", erro: e instanceof Error ? e.message : "falha no envio" };
  }
}
