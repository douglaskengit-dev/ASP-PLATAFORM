/** Lado servidor do acesso por e-mail (convite e redefinição de senha).
 * Regras puras em lib/validacao/acesso.ts. Chave de serviço: as tabelas
 * gp_links_acesso e gp_acesso_tentativas não têm policy para anon/
 * authenticated (migração 20261104100000).
 *
 * Mecânica do link (sem depender do prazo de OTP nem das Redirect URLs do
 * Supabase): o e-mail leva SÓ um token aleatório nosso (32 bytes). No banco
 * fica apenas o SHA-256 dele — nem o banco consegue reconstruir o link. Ao
 * definir a senha, dentro do NOSSO prazo, o servidor pede ao Supabase um
 * link de recuperação (auth.admin.generateLink, que não envia e-mail) e o
 * consome na hora (verifyOtp) com o cliente de rota — a sessão fica no
 * cookie. Como generateLink e verifyOtp acontecem no mesmo segundo, o
 * "Email OTP Expiration" do Supabase não importa. Tokens nunca vão para log. */
import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarEmail } from "@/lib/email";
import { assuntoEmailAcesso, emailAcessoHtml, emailAcessoTexto } from "@/lib/email-templates";
import {
  baseAppUrl, expiraEm, montarLinkAcesso, resultadoEnvio, VALIDADE_LINK_TEXTO, type TipoLinkAcesso,
} from "@/lib/validacao";

export const TABELA_LINKS = "gp_links_acesso";
export const TABELA_TENTATIVAS = "gp_acesso_tentativas";

export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Senha aleatória forte (conta criada sem senha conhecida: ninguém a vê). */
export function senhaAleatoria(): string {
  return randomBytes(36).toString("base64url");
}

/** Chave anônima do limite (não grava e-mail/IP em claro). */
export function chaveTentativa(tipo: "email" | "ip", valor: string): string {
  return `${tipo}:${createHash("sha256").update(valor.trim().toLowerCase(), "utf8").digest("hex")}`;
}

// ── Requisição ───────────────────────────────────────────────────────────────

export function ipDaRequisicao(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return (req.headers.get("x-real-ip") || req.ip || "").slice(0, 64);
}

export function userAgent(req: NextRequest): string {
  return (req.headers.get("user-agent") || "").slice(0, 300);
}

/** CSRF: POST só da própria origem (Origin = host da requisição). */
export function mesmaOrigem(req: NextRequest): boolean {
  const origem = req.headers.get("origin");
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  if (origem) {
    try {
      return new URL(origem).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  // Sem Origin (navegadores antigos): aceita só o que o navegador marca como
  // mesma origem.
  return req.headers.get("sec-fetch-site") === "same-origin";
}

/** Endereço base do app para os links (ver baseAppUrl). */
export function baseDaRequisicao(req: NextRequest): string {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "") || "https").split(",")[0].trim();
  return baseAppUrl({
    envUrl: process.env.NEXT_PUBLIC_APP_URL,
    origem: host ? `${proto}://${host}` : null,
    hostsPermitidos: [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL],
  });
}

// ── Links ────────────────────────────────────────────────────────────────────

export interface LinkAcessoLinha {
  id: string;
  usuario_id: string | null;
  email: string;
  tipo: TipoLinkAcesso;
  criado_por: string | null;
  criado_em: string;
  expira_em: string;
  usado_em: string | null;
  invalidado_em: string | null;
  destino: string | null;
  envio_status: string;
  envio_erro: string | null;
}

const CAMPOS_LINK = "id, usuario_id, email, tipo, criado_por, criado_em, expira_em, usado_em, invalidado_em, destino, envio_status, envio_erro";

/** Invalida links não usados do usuário (de um tipo, ou todos). */
export async function invalidarLinks(usuarioId: string, motivo: string, tipo?: TipoLinkAcesso, excetoId?: string): Promise<void> {
  let q = getSupabaseAdmin().from(TABELA_LINKS)
    .update({ invalidado_em: new Date().toISOString(), invalidado_motivo: motivo })
    .eq("usuario_id", usuarioId).is("usado_em", null).is("invalidado_em", null);
  if (tipo) q = q.eq("tipo", tipo);
  if (excetoId) q = q.neq("id", excetoId);
  const { error } = await q;
  if (error) console.error("[acesso] invalidar links:", error.code, error.message);
}

/** Usuário excluído: o perfil some (usuario_id vira null) — invalida pelo e-mail. */
export async function invalidarLinksPorEmail(email: string, motivo: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from(TABELA_LINKS)
    .update({ invalidado_em: new Date().toISOString(), invalidado_motivo: motivo })
    .eq("email", email).is("usado_em", null).is("invalidado_em", null);
  if (error) console.error("[acesso] invalidar links (e-mail):", error.code, error.message);
}

export interface ResultadoEmissao {
  ok: boolean;
  tipo: TipoLinkAcesso;
  /** E-mail aceito pelo provedor. */
  enviado: boolean;
  /** Por que não foi enviado (português). */
  motivo: string | null;
  /** Só quando NÃO foi enviado e quem pediu é admin: para copiar e mandar
   *  por outro meio. Nunca é gravado (no banco fica só o hash). */
  link?: string;
  criadoEm?: string;
  expiraEm?: string;
  erro?: string;
}

/** Emite um link novo (invalidando os anteriores do mesmo tipo) e envia o
 *  e-mail. Grava o resultado do envio na mesma linha (auditoria). */
export async function emitirLinkAcesso(o: {
  usuario: { id: string; email: string; nome_completo?: string | null };
  tipo: TipoLinkAcesso;
  criadoPor: string | null;
  req: NextRequest;
  destino?: string | null;
  /** Devolver o link quando o e-mail não sair (só para admin). */
  devolverLinkSeFalhar: boolean;
}): Promise<ResultadoEmissao> {
  const admin = getSupabaseAdmin();
  const token = gerarToken();
  const agora = new Date();
  const exp = expiraEm(o.tipo, agora);

  await invalidarLinks(o.usuario.id, "substituido", o.tipo);

  const { data: linha, error } = await admin.from(TABELA_LINKS).insert({
    usuario_id: o.usuario.id,
    email: o.usuario.email,
    tipo: o.tipo,
    token_hash: hashToken(token),
    criado_por: o.criadoPor,
    criado_em: agora.toISOString(),
    expira_em: exp.toISOString(),
    destino: o.destino || null,
    ip: ipDaRequisicao(o.req) || null,
    user_agent: userAgent(o.req) || null,
    envio_status: "pendente",
  }).select("id, criado_em, expira_em").maybeSingle();
  if (error || !linha) {
    if (error) console.error("[acesso] gravar link:", error.code, error.message);
    const semTabela = error?.code === "42P01" || error?.code === "PGRST205" || /gp_links_acesso/.test(error?.message || "");
    return {
      ok: false, tipo: o.tipo, enviado: false,
      motivo: null,
      erro: semTabela
        ? "Banco ainda sem a tabela de links de acesso — rode a migração 20261104100000 (ou o verificacao-db-asp.sql) no Supabase."
        : "Não foi possível gerar o link de acesso. Tente de novo em instantes.",
    };
  }

  const link = montarLinkAcesso(baseDaRequisicao(o.req), token);
  const dados = { tipo: o.tipo, nome: o.usuario.nome_completo, email: o.usuario.email, link, validade: VALIDADE_LINK_TEXTO[o.tipo] };
  const r = await enviarEmail([o.usuario.email], assuntoEmailAcesso(o.tipo), emailAcessoHtml(dados), undefined, { texto: emailAcessoTexto(dados) });
  const env = resultadoEnvio(r, process.env.EMAIL_REMETENTE || "onboarding@resend.dev");
  if (env.status === "falhou") console.error("[acesso] envio:", o.tipo, (r.erro || "").slice(0, 300));

  const { error: errEnvio } = await admin.from(TABELA_LINKS).update({
    envio_status: env.status,
    envio_erro: env.status === "enviado" ? null : `${env.motivo || ""}${r.erro ? ` [${r.erro.slice(0, 300)}]` : ""}`.slice(0, 500),
    enviado_em: env.status === "enviado" ? new Date().toISOString() : null,
  }).eq("id", (linha as any).id);
  if (errEnvio) console.error("[acesso] gravar envio:", errEnvio.code, errEnvio.message);

  const enviado = env.status === "enviado";
  return {
    ok: true, tipo: o.tipo, enviado, motivo: env.motivo,
    ...(!enviado && o.devolverLinkSeFalhar ? { link } : {}),
    criadoEm: (linha as any).criado_em, expiraEm: (linha as any).expira_em,
  };
}

export async function buscarLinkPorToken(token: string): Promise<LinkAcessoLinha | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const { data, error } = await getSupabaseAdmin().from(TABELA_LINKS).select(CAMPOS_LINK).eq("token_hash", hashToken(token)).maybeSingle();
  if (error) console.error("[acesso] buscar link:", error.code, error.message);
  return (data as LinkAcessoLinha) || null;
}

export async function perfilAtivo(usuarioId: string | null): Promise<{ ativo: boolean | null; email: string | null; nome: string | null }> {
  if (!usuarioId) return { ativo: null, email: null, nome: null };
  const { data } = await getSupabaseAdmin().from("gp_profiles").select("id, email, nome_completo, ativo").eq("id", usuarioId).maybeSingle();
  if (!data) return { ativo: null, email: null, nome: null };
  return { ativo: !!(data as any).ativo, email: (data as any).email, nome: (data as any).nome_completo };
}

// ── Limite do "Esqueci minha senha" ──────────────────────────────────────────

/** Registra o pedido e devolve quantos houve na janela (incluindo este). */
export async function registrarEContar(chave: string, janelaMs: number): Promise<number> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from(TABELA_TENTATIVAS).insert({ chave });
  if (error) console.error("[acesso] tentativa:", error.code, error.message);
  const desde = new Date(Date.now() - janelaMs).toISOString();
  const { count, error: e2 } = await admin.from(TABELA_TENTATIVAS).select("id", { count: "exact", head: true }).eq("chave", chave).gte("criado_em", desde);
  if (e2) console.error("[acesso] contar tentativas:", e2.code, e2.message);
  return count ?? 0;
}

/** Limpeza preguiçosa (tentativas com mais de 1 dia). */
export async function limparTentativasAntigas(): Promise<void> {
  const { error } = await getSupabaseAdmin().from(TABELA_TENTATIVAS).delete().lt("criado_em", new Date(Date.now() - 86400000).toISOString());
  if (error) console.error("[acesso] limpar tentativas:", error.code, error.message);
}

// ── Resumo para a lista de usuários ─────────────────────────────────────────

export interface ResumoAcesso {
  /** auth.users.last_sign_in_at (null = nunca entrou). */
  ultimoLogin: string | null;
  /** O login foi lido do Supabase Auth (senão, não sabemos). */
  loginConhecido: boolean;
  convite: ResumoLink | null;
  redefinicao: ResumoLink | null;
}

export interface ResumoLink {
  criadoEm: string;
  status: "pendente" | "aceito" | "expirado" | "invalidado";
  envio: string;
  envioErro: string | null;
}

function resumoLink(l: LinkAcessoLinha, agora: number): ResumoLink {
  const status = l.usado_em ? "aceito" : l.invalidado_em ? "invalidado" : Date.parse(l.expira_em) <= agora ? "expirado" : "pendente";
  return { criadoEm: l.criado_em, status, envio: l.envio_status, envioErro: l.envio_status === "enviado" ? null : (l.envio_erro || "").replace(/\s*\[.*$/, "") || null };
}

export async function resumosDeAcesso(ids: string[]): Promise<Record<string, ResumoAcesso>> {
  const admin = getSupabaseAdmin();
  const out: Record<string, ResumoAcesso> = {};
  ids.forEach((id) => (out[id] = { ultimoLogin: null, loginConhecido: false, convite: null, redefinicao: null }));
  if (!ids.length) return out;

  const { data: links, error } = await admin.from(TABELA_LINKS).select(CAMPOS_LINK).in("usuario_id", ids).order("criado_em", { ascending: false });
  if (error) console.error("[acesso] resumo links:", error.code, error.message);
  const agora = Date.now();
  for (const l of (links || []) as LinkAcessoLinha[]) {
    const r = l.usuario_id ? out[l.usuario_id] : null;
    if (!r) continue;
    if (!r[l.tipo]) r[l.tipo] = resumoLink(l, agora);
  }

  // last_sign_in_at: um getUserById por usuário (o pool de login é
  // compartilhado com outro sistema — listar todos seria mais pesado).
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      try {
        const { data, error: e } = await admin.auth.admin.getUserById(id);
        if (!e && data?.user) {
          out[id].ultimoLogin = data.user.last_sign_in_at || null;
          out[id].loginConhecido = true;
        }
      } catch { /* sem a informação: a tela não oferece "Reenviar convite" */ }
    }));
  }
  return out;
}
