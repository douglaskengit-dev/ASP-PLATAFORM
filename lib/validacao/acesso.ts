/** Acesso por e-mail: convite (primeiro acesso) e redefinição de senha.
 * Puro (sem React/Supabase): regras usadas pelas APIs em app/api/acesso e
 * app/api/admin/users e pelas telas /definir-senha e /esqueci-senha.
 *
 *   ⛔ convite vale 24 horas; redefinição vale 1 hora (prazo NOSSO, gravado
 *      em gp_links_acesso.expira_em — independe do prazo de OTP do Supabase)
 *   ⛔ cada link é de uso único; emitir outro do mesmo tipo invalida os
 *      anteriores ainda não usados; desativar/excluir o usuário invalida todos
 *   ⛔ "Esqueci minha senha": resposta sempre neutra (não revela se o e-mail
 *      existe); no máximo 3 pedidos por e-mail a cada 15 min e 10 por IP por
 *      hora; conta inativa nunca recebe link
 *   ⛔ links só em HTTPS (exceto localhost), sem barra dupla */
import { SENHA_MINIMA } from "./usuario";

export type TipoLinkAcesso = "convite" | "redefinicao";

export const VALIDADE_LINK_MS: Record<TipoLinkAcesso, number> = {
  convite: 24 * 60 * 60 * 1000,
  redefinicao: 60 * 60 * 1000,
};

/** "24 horas" / "1 hora" — vai no e-mail e na tela. */
export const VALIDADE_LINK_TEXTO: Record<TipoLinkAcesso, string> = {
  convite: "24 horas",
  redefinicao: "1 hora",
};

/** sessionStorage: e-mail levado de /login ou /definir-senha para /esqueci-senha
 *  (sem pôr o e-mail na URL). */
export const CHAVE_EMAIL_ESQUECI = "asp_esqueci_email";

export const APP_URL_PADRAO = "https://asp-plataform.vercel.app";

export const MSG_ESQUECI_NEUTRA = "Se houver uma conta ativa com este e-mail, você receberá um link em instantes.";
export const MSG_ESQUECI_LIMITE = "Muitas solicitações seguidas. Aguarde alguns minutos e tente de novo.";

/** Limites do "Esqueci minha senha" (contados em gp_acesso_tentativas). */
export const LIMITES_ESQUECI = {
  email: { max: 3, janelaMs: 15 * 60 * 1000 },
  ip: { max: 10, janelaMs: 60 * 60 * 1000 },
} as const;

export function tipoLinkValido(t: unknown): t is TipoLinkAcesso {
  return t === "convite" || t === "redefinicao";
}

export function expiraEm(tipo: TipoLinkAcesso, agora: Date = new Date()): Date {
  return new Date(agora.getTime() + VALIDADE_LINK_MS[tipo]);
}

export type EstadoLinkAcesso = "valido" | "expirado" | "usado" | "invalido";

export interface LinkAcessoRef {
  usuario_id: string | null;
  expira_em: string;
  usado_em: string | null;
  invalidado_em: string | null;
}

/** Estado do link no momento do clique. `perfilAtivo` = gp_profiles.ativo
 *  (null = perfil não existe mais). Ordem: usado > invalidado > expirado. */
export function estadoLink(link: LinkAcessoRef | null | undefined, agora: Date, perfilAtivo: boolean | null): EstadoLinkAcesso {
  if (!link || !link.usuario_id) return "invalido";
  if (link.usado_em) return "usado";
  if (link.invalidado_em) return "invalido";
  if (perfilAtivo !== true) return "invalido";
  const exp = Date.parse(link.expira_em);
  if (!Number.isFinite(exp) || exp <= agora.getTime()) return "expirado";
  return "valido";
}

export const MSG_ESTADO_LINK: Record<Exclude<EstadoLinkAcesso, "valido">, string> = {
  expirado: "Este link expirou. Por segurança, ele vale por pouco tempo — peça um novo.",
  usado: "Este link já foi usado. Cada link só pode ser usado uma vez — se precisar, peça um novo.",
  invalido: "Este link não é válido (foi substituído por um mais novo, ou a conta não está ativa).",
};

function ehLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

/** "https://x.app/" → "https://x.app" (sem barra no fim, sem caminho);
 *  http vira https fora de localhost. Inválida → null. */
export function normalizarBaseUrl(url: string | null | undefined): string | null {
  const bruto = (url || "").trim();
  if (!bruto) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) && !/^https?:\/\//i.test(bruto)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const proto = u.protocol === "http:" && !ehLocal(u.host) ? "https:" : u.protocol;
  const caminho = u.pathname.replace(/\/+$/, "");
  return `${proto}//${u.host}${caminho}`;
}

/** Endereço do app nos links do e-mail: NEXT_PUBLIC_APP_URL → origem da
 *  requisição (só se for um host conhecido — evita "Host header injection"
 *  num pedido anônimo de Esqueci minha senha) → APP_URL_PADRAO. */
export function baseAppUrl(o: { envUrl?: string | null; origem?: string | null; hostsPermitidos?: (string | null | undefined)[] }): string {
  const env = normalizarBaseUrl(o.envUrl);
  if (env) return env;
  const origem = normalizarBaseUrl(o.origem);
  if (origem) {
    const host = new URL(origem).host.toLowerCase();
    const permitidos = new Set(
      [APP_URL_PADRAO, ...(o.hostsPermitidos || [])]
        .map((h) => normalizarBaseUrl(h || ""))
        .filter((h): h is string => !!h)
        .map((h) => new URL(h).host.toLowerCase())
    );
    if (ehLocal(host) || permitidos.has(host)) return origem;
  }
  return APP_URL_PADRAO;
}

/** Link do e-mail. O token vai no FRAGMENTO (#t=…): o navegador não o envia
 *  ao servidor, então não aparece em log de acesso (Vercel/proxy) nem no
 *  Referer; e abrir o link (inclusive por robôs de antivírus de e-mail) não o
 *  consome — só o POST da página, com a senha. */
export function montarLinkAcesso(base: string, token: string): string {
  return `${normalizarBaseUrl(base) || APP_URL_PADRAO}/definir-senha#t=${encodeURIComponent(token)}`;
}

/** Token de "#t=…" (ou "?t=…", por compatibilidade). */
export function tokenDoLink(hash: string | null | undefined, query?: string | null): string {
  const h = (hash || "").replace(/^#/, "");
  const doHash = new URLSearchParams(h).get("t");
  return (doHash || query || "").trim();
}

/** Destino depois de definir a senha: só caminho interno ("/x"), nunca
 *  "//host" nem URL absoluta; páginas de acesso voltam ao Dashboard. */
export function destinoSeguro(proximo: unknown): string {
  if (typeof proximo !== "string") return "/dashboard";
  const p = proximo.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > 300) return "/dashboard";
  if (/^\/(login|definir-senha|esqueci-senha)(\/|\?|$)/.test(p) || p === "/") return "/dashboard";
  return p;
}

/** Limite do "Esqueci minha senha": contagens JÁ incluindo o pedido atual. */
export function avaliarLimiteEsqueci(qtdEmail: number, qtdIp: number): { bloqueado: boolean; motivo: "email" | "ip" | null } {
  if (qtdIp > LIMITES_ESQUECI.ip.max) return { bloqueado: true, motivo: "ip" };
  if (qtdEmail > LIMITES_ESQUECI.email.max) return { bloqueado: true, motivo: "email" };
  return { bloqueado: false, motivo: null };
}

/** Mesma regra da tela de senha de hoje (mínimo 6 + confirmação igual). */
export function validarNovaSenha(senha: unknown, confirmacao: unknown): { campo: "senha" | "confirmar"; erro: string } | null {
  const s = typeof senha === "string" ? senha : "";
  if (!s) return { campo: "senha", erro: "Informe a nova senha." };
  if (s.length < SENHA_MINIMA) return { campo: "senha", erro: `A senha deve ter ao menos ${SENHA_MINIMA} caracteres.` };
  if (s.length > 72) return { campo: "senha", erro: "A senha pode ter no máximo 72 caracteres." };
  if (confirmacao !== undefined && confirmacao !== s) return { campo: "confirmar", erro: "A confirmação não confere com a nova senha." };
  return null;
}

/** Resultado do envio (lib/email.ts) → status gravado + motivo em português.
 *  As mensagens do Resend (remetente de teste, domínio não verificado) só
 *  aparecem quando o provedor é o Resend; no SMTP o erro já vem traduzido. */
export function resultadoEnvio(
  r: { ok: boolean; ignorado?: boolean; erro?: string; provedor?: "smtp" | "resend" | "nenhum" },
  remetente?: string | null,
): {
  status: "enviado" | "nao_configurado" | "falhou";
  motivo: string | null;
} {
  if (r.ok && !r.ignorado) return { status: "enviado", motivo: null };
  if (r.ok && r.ignorado) {
    const motivo = r.provedor === "smtp"
      ? "o envio de e-mail por SMTP está incompleto no servidor (defina SMTP_USER e SMTP_PASS)."
      : r.provedor === "resend"
        ? "o envio de e-mail não está configurado no servidor (RESEND_API_KEY ausente)."
        : "o envio de e-mail não está configurado no servidor (configure o Gmail via SMTP_* ou o Resend).";
    return { status: "nao_configurado", motivo };
  }
  if (r.provedor === "smtp") {
    return { status: "falhou", motivo: r.erro || "o servidor SMTP não aceitou o envio. Tente de novo em instantes." };
  }
  const e = (r.erro || "").toLowerCase();
  const sandbox = /resend\.dev/.test((remetente || "").toLowerCase());
  if (/only send testing emails|testing emails to your own|verify a domain|domain is not verified|not verified/.test(e) || (sandbox && /http 403/.test(e))) {
    return {
      status: "falhou",
      motivo: sandbox
        ? "o remetente ainda é o de teste do Resend (onboarding@resend.dev). Verifique um domínio no Resend e configure EMAIL_REMETENTE."
        : "o domínio do remetente (EMAIL_REMETENTE) não está verificado no Resend. Verifique o domínio em resend.com/domains.",
    };
  }
  if (/http 401|api key is invalid|invalid api key|missing api key/.test(e)) {
    return { status: "falhou", motivo: "a chave do Resend (RESEND_API_KEY) foi recusada." };
  }
  if (/http 429|rate limit|too many/.test(e)) {
    return { status: "falhou", motivo: "limite de envios do Resend atingido — tente de novo em instantes." };
  }
  if (/http 422|invalid.*(to|email)|validation_error/.test(e)) {
    return { status: "falhou", motivo: "o provedor de e-mail recusou o endereço ou o remetente." };
  }
  return { status: "falhou", motivo: "o provedor de e-mail não aceitou o envio. Tente de novo em instantes." };
}

/** "DD/MM HH:MM" no fuso de Brasília. */
export function dataHoraCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${v("day")}/${v("month")} ${v("hour")}:${v("minute")}`;
}
