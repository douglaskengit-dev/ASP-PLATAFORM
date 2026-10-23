/** Regras puras do envio de e-mail (sem rede, sem nodemailer): qual
 * provedor usar, remetente, máscara para o diagnóstico e tradução dos erros
 * do SMTP (Gmail) para português. O envio em si fica em lib/email.ts.
 *
 * Provedor:
 *  - EMAIL_PROVEDOR=smtp  → SMTP (precisa de SMTP_USER e SMTP_PASS);
 *  - EMAIL_PROVEDOR=resend → Resend (precisa de RESEND_API_KEY);
 *  - sem EMAIL_PROVEDOR: SMTP se SMTP_HOST estiver definido, senão Resend se
 *    RESEND_API_KEY existir, senão nenhum (e-mail vira no-op). */

export type ProvedorEmail = "smtp" | "resend" | "nenhum";

type Env = Record<string, string | undefined>;

export const SMTP_HOST_PADRAO = "smtp.gmail.com";
export const SMTP_PORTA_PADRAO = 465;
/** Prazos curtos: a função serverless não pode ficar presa num SMTP mudo. */
export const SMTP_TIMEOUT_MS = 10_000;

const v = (env: Env, k: string) => (env[k] || "").trim();

/** Provedor escolhido pela configuração (antes de checar credenciais). */
export function provedorEmail(env: Env): ProvedorEmail {
  const forcado = v(env, "EMAIL_PROVEDOR").toLowerCase();
  if (forcado === "smtp") return "smtp";
  if (forcado === "resend") return "resend";
  if (v(env, "SMTP_HOST")) return "smtp";
  if (v(env, "RESEND_API_KEY")) return "resend";
  return "nenhum";
}

/** Senha de app do Google aparece em blocos de 4 ("abcd efgh ijkl mnop"). */
export function normalizarSenhaApp(senha: string | undefined | null): string {
  return (senha || "").replace(/\s+/g, "");
}

export interface ConfigSmtp {
  host: string;
  port: number;
  /** true na 465 (TLS direto); na 587 o TLS vem por STARTTLS. */
  secure: boolean;
  user: string;
  pass: string;
  ehGmail: boolean;
}

export function configSmtp(env: Env): ConfigSmtp {
  const host = v(env, "SMTP_HOST") || SMTP_HOST_PADRAO;
  const p = parseInt(v(env, "SMTP_PORT"), 10);
  const port = Number.isFinite(p) && p > 0 ? p : SMTP_PORTA_PADRAO;
  return {
    host, port, secure: port === 465,
    user: v(env, "SMTP_USER"),
    pass: normalizarSenhaApp(env.SMTP_PASS),
    ehGmail: /(^|\.)(gmail|googlemail)\.com$/i.test(host),
  };
}

/** "Nome <email>" ou "email" → partes. */
export function separarRemetente(s: string): { nome: string; email: string } {
  const t = (s || "").trim();
  const m = t.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>]+?)\s*>\s*$/);
  if (m) return { nome: m[1].trim(), email: m[2].trim() };
  return { nome: "", email: t };
}

function montarRemetente(nome: string, email: string): string {
  if (!nome) return email;
  const precisaAspas = /[",;:<>()@[\]\\]/.test(nome);
  return precisaAspas ? `"${nome.replace(/["\\]/g, "")}" <${email}>` : `${nome} <${email}>`;
}

export interface RemetenteResolvido {
  /** Valor final do From. */
  from: string;
  /** O endereço de EMAIL_REMETENTE foi trocado pelo SMTP_USER (Gmail). */
  reescrito: boolean;
  aviso: string | null;
}

/** From que será usado. No Gmail, o endereço precisa ser o da conta
 *  (SMTP_USER) — senão o próprio Gmail o reescreve; mantemos o nome. */
export function remetenteEmail(env: Env, provedor: ProvedorEmail = provedorEmail(env)): RemetenteResolvido {
  const configurado = v(env, "EMAIL_REMETENTE");
  if (provedor !== "smtp") {
    return { from: configurado || "ASP <onboarding@resend.dev>", reescrito: false, aviso: null };
  }
  const cfg = configSmtp(env);
  if (!configurado) return { from: montarRemetente("ASP", cfg.user), reescrito: false, aviso: null };
  const { nome, email } = separarRemetente(configurado);
  if (cfg.ehGmail && cfg.user && email.toLowerCase() !== cfg.user.toLowerCase()) {
    return {
      from: montarRemetente(nome || "ASP", cfg.user),
      reescrito: true,
      aviso: `EMAIL_REMETENTE usa ${email}, mas o Gmail só envia como a conta do SMTP_USER — usando ${cfg.user} (nome "${nome || "ASP"}" mantido).`,
    };
  }
  return { from: configurado, reescrito: false, aviso: null };
}

/** "fulano@gmail.com" → "fu***@gmail.com" (para o /api/diag). */
export function mascararEmail(email: string | undefined | null): string {
  const e = (email || "").trim();
  if (!e) return "";
  const at = e.lastIndexOf("@");
  if (at <= 0) return e.length <= 2 ? "***" : `${e.slice(0, 2)}***`;
  const local = e.slice(0, at);
  const vis = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${vis}***${e.slice(at)}`;
}

/** "ASP <fulano@gmail.com>" → "ASP <fu***@gmail.com>". */
export function mascararRemetente(from: string): string {
  const { nome, email } = separarRemetente(from);
  return montarRemetente(nome, mascararEmail(email));
}

/** O que falta para o provedor escolhido funcionar (vazio = completo). */
export function faltandoConfig(env: Env, provedor: ProvedorEmail = provedorEmail(env)): string[] {
  if (provedor === "smtp") {
    const cfg = configSmtp(env);
    return [!cfg.user && "SMTP_USER", !cfg.pass && "SMTP_PASS"].filter(Boolean) as string[];
  }
  if (provedor === "resend") return v(env, "RESEND_API_KEY") ? [] : ["RESEND_API_KEY"];
  return [];
}

/** Resumo da configuração para o /api/diag — nunca devolve senha/chave. */
export function diagnosticoEmail(env: Env) {
  const provedor = provedorEmail(env);
  const rem = remetenteEmail(env, provedor);
  const cfg = configSmtp(env);
  const forcado = v(env, "EMAIL_PROVEDOR").toLowerCase();
  return {
    provedor,
    EMAIL_PROVEDOR: forcado || "(não definido — automático)",
    configCompleta: provedor !== "nenhum" && faltandoConfig(env, provedor).length === 0,
    faltando: faltandoConfig(env, provedor),
    smtp: {
      SMTP_HOST: v(env, "SMTP_HOST") || `(não definido — padrão ${SMTP_HOST_PADRAO})`,
      SMTP_PORT: cfg.port,
      seguranca: cfg.secure ? "TLS direto (465)" : "STARTTLS",
      SMTP_USER: cfg.user ? mascararEmail(cfg.user) : "(não definido)",
      SMTP_PASS_presente: !!cfg.pass,
    },
    RESEND_API_KEY_presente: !!v(env, "RESEND_API_KEY"),
    EMAIL_REMETENTE: v(env, "EMAIL_REMETENTE") ? mascararRemetente(v(env, "EMAIL_REMETENTE")) : "(não definido)",
    // Endereços mascarados (o diagnóstico é visível a qualquer usuário logado).
    remetenteUsado: provedor === "nenhum" ? null : mascararRemetente(rem.from),
    remetenteReescrito: rem.reescrito,
    avisoRemetente: rem.aviso && cfg.user ? rem.aviso.split(cfg.user).join(mascararEmail(cfg.user)) : rem.aviso,
    EMAIL_RESPONDER_PARA: v(env, "EMAIL_RESPONDER_PARA") ? mascararEmail(v(env, "EMAIL_RESPONDER_PARA")) : "(não definido)",
  };
}

// ── Erros do SMTP → português ───────────────────────────────────────────────

export const ERRO_SMTP = {
  auth: "O Gmail recusou o login: confira SMTP_USER e a senha de app (é preciso verificação em 2 etapas)",
  conexao: "Não foi possível conectar ao servidor SMTP",
  limite: "Limite diário de envio do Gmail atingido",
  destinatario: "Destinatário recusado",
  generico: "O servidor SMTP não aceitou o envio",
} as const;

/** Campos que interessam de um erro do nodemailer. */
export interface ErroSmtpBruto {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
  message?: string;
}

/** Erro do nodemailer → mensagem em português (sem segredos). */
export function traduzirErroSmtp(e: ErroSmtpBruto | null | undefined): string {
  const code = (e?.code || "").toUpperCase();
  const rc = e?.responseCode || 0;
  const texto = `${e?.response || ""} ${e?.message || ""}`.toLowerCase();
  const cmd = (e?.command || "").toUpperCase();

  // Limite diário do Gmail: 550 5.4.5 "Daily user sending limit exceeded"
  // ou 421 4.7.0 de cota/taxa.
  if (/5\.4\.5|sending limit|daily (user )?sending|quota|limit exceeded/.test(texto) || (rc === 421 && /4\.7\.0/.test(texto) && /limit|quota|rate|too many/.test(texto))) {
    return ERRO_SMTP.limite;
  }
  if (code === "EAUTH" || rc === 535 || rc === 534 || /username and password not accepted|application-specific password|badcredentials|authentication (failed|unsuccessful)/.test(texto)) {
    return ERRO_SMTP.auth;
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "ETLS", "EGREETING"].includes(code) || /timeout|timed out|econnrefused|getaddrinfo/.test(texto)) {
    return ERRO_SMTP.conexao;
  }
  if (code === "EENVELOPE" || cmd === "RCPT TO" || /recipient|no such user|user unknown|mailbox unavailable|5\.1\.1/.test(texto)) {
    return ERRO_SMTP.destinatario;
  }
  return ERRO_SMTP.generico;
}

/** Texto técnico curto (para log/auditoria), sem credenciais. */
export function resumoErroSmtp(e: ErroSmtpBruto | null | undefined, pass?: string): string {
  const texto = (e?.response || e?.message || "").slice(0, 200);
  const rc = e?.responseCode && !texto.startsWith(String(e.responseCode)) ? e.responseCode : null;
  const partes = [e?.code, rc, texto].filter(Boolean);
  let s = partes.join(" ");
  if (pass) s = s.split(pass).join("***");
  return s;
}
