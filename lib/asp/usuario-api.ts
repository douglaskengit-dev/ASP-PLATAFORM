/** Lado servidor da Administração de usuários: contexto do banco para
 *  lib/validacao/usuario.ts, tradução dos erros do Supabase Auth, versão
 *  (concorrência) e a saída da pessoa das equipes futuras ao ser desativada.
 *  Usado por /api/admin/users e /api/admin/users/[id]. Chave de serviço. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import {
  agendamentosFuturosDoUsuario, emQuando, hojeBrasil, nomeDoUsuario, quandoCurto, removerDaEquipe,
  type AgendamentoEquipe, type MembroRef, type UsuarioRef,
} from "@/lib/validacao";

export const CAMPOS_USUARIO = "id, email, nome_completo, perfil, funcao, ativo, created_at, updated_at";

export interface UsuarioLinha extends UsuarioRef {
  funcao: string | null;
  created_at?: string;
  updated_at: string | null;
}

export async function carregarUsuarios(): Promise<{ usuarios: UsuarioLinha[]; erro: string | null }> {
  const { data, error } = await getSupabaseAdmin().from("gp_profiles").select(CAMPOS_USUARIO).order("created_at", { ascending: true });
  if (error) {
    console.error("[admin/users] carregar:", error.message);
    return { usuarios: [], erro: "Não foi possível carregar os usuários. Tente de novo em instantes." };
  }
  return { usuarios: (data || []) as UsuarioLinha[], erro: null };
}

/** Mesma versão (updated_at) — tolera formatos diferentes do mesmo instante. */
export function mesmaVersao(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && (a === b || Date.parse(a) === Date.parse(b));
}

/** "Outro administrador alterou este usuário às 14:05 — recarregue." */
export function msgVersaoUsuario(updatedAt: string | null | undefined): string {
  let hora = "";
  try {
    if (updatedAt) {
      hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(updatedAt));
    }
  } catch { /* sem hora */ }
  return `Outro administrador alterou este usuário${hora ? ` às ${hora}` : ""} — recarregue (sua alteração não foi gravada).`;
}

/** Erro do Supabase Auth (inglês) → mensagem em português + campo + status. */
export function traduzirErroAuth(err: { message?: string; code?: string; status?: number } | null | undefined): {
  erro: string; campo: string | null; status: number;
} {
  const msg = (err?.message || "").toLowerCase();
  const code = err?.code || "";
  if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists/.test(msg)) {
    return { erro: "Já existe um login com este e-mail (pode ter sido criado por outro sistema que usa o mesmo acesso).", campo: "email", status: 409 };
  }
  if (code === "email_address_invalid" || (code === "validation_failed" && /email/.test(msg)) || /invalid.*email|email.*invalid|unable to validate email/.test(msg)) {
    return { erro: "E-mail inválido (use o formato nome@dominio.com).", campo: "email", status: 400 };
  }
  if (code === "weak_password" || /password/.test(msg)) {
    return { erro: "Senha recusada pelo servidor de login — use pelo menos 6 caracteres.", campo: "senha", status: 400 };
  }
  if (code === "over_request_rate_limit" || err?.status === 429 || /rate limit/.test(msg)) {
    return { erro: "Muitas tentativas seguidas — aguarde um minuto e tente de novo.", campo: null, status: 429 };
  }
  if (code === "user_not_found" || err?.status === 404 || /not found/.test(msg)) {
    return { erro: "Login do usuário não encontrado.", campo: null, status: 404 };
  }
  return { erro: "O servidor de login recusou a operação. Tente de novo em instantes.", campo: null, status: 500 };
}

/** Erro do banco ao gravar gp_profiles → português. */
export function traduzirErroPerfil(error: { code?: string; message?: string }): { erro: string; campo: string | null; status: number } {
  const m = error.message || "";
  if (/gp_ultimo_admin/.test(m)) {
    return { erro: "Não é possível: este é o último administrador ativo — promova outro usuário a Administrador antes.", campo: "perfil", status: 409 };
  }
  if (error.code === "23505" && /email/.test(m)) return { erro: "Já existe um usuário com este e-mail.", campo: "email", status: 409 };
  if (error.code === "23514" && /perfil/.test(m)) return { erro: "Área / Acesso inválida.", campo: "perfil", status: 400 };
  if ((error.code === "23514" || error.code === "23503") && /funcao/.test(m)) {
    return { erro: "Função inválida — escolha uma das funções cadastradas.", campo: "funcao", status: 400 };
  }
  console.error("[admin/users] gravar perfil:", error.code, m);
  return { erro: "Não foi possível gravar o usuário. Tente de novo em instantes.", campo: null, status: 500 };
}

// ── Agendamentos futuros × desativação ───────────────────────────────────────

export interface AgendamentoAfetado {
  id: string;
  inspecaoId: string;
  os: string;
  projeto: string;
  tipo: string;
  tipoLabel: string;
  quando: string;
  /** A pessoa era a única da equipe: ficará sem ninguém. */
  ficaSemEquipe: boolean;
}

interface LinhaAgendamento extends AgendamentoEquipe {
  inspecao_id: string;
  atualizado_em: string | null;
  inspecao?: any;
}

const CAMPOS_AG =
  "id, inspecao_id, tipo, data_visita, data_fim, a_definir, substituido_em, equipe, atualizado_em, " +
  "inspecao:gp_inspecoes(identificacao, excluido_em, projeto:gp_projetos(codigo_projeto, pedido_compra, excluido_em))";

const rotuloTipo = (t: string) => (t === "execucao" ? "Execução" : "Inspeção");

function naLixeira(a: LinhaAgendamento): boolean {
  return !!a.inspecao?.excluido_em || !!a.inspecao?.projeto?.excluido_em;
}

async function lerAgendamentosDoUsuario(usuarioId: string): Promise<{ lista: LinhaAgendamento[]; erro: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("gp_agendamentos")
    .select(CAMPOS_AG)
    .is("substituido_em", null)
    .filter("equipe", "cs", JSON.stringify([{ id: usuarioId }]));
  if (error) {
    console.error("[admin/users] agendamentos:", error.message);
    return { lista: [], erro: "Não foi possível ler os agendamentos do usuário." };
  }
  const hoje = hojeBrasil();
  const lista = agendamentosFuturosDoUsuario((data || []) as unknown as LinhaAgendamento[], usuarioId, hoje).filter((a) => !naLixeira(a));
  return { lista, erro: null };
}

function paraAfetado(a: LinhaAgendamento, usuarioId: string): AgendamentoAfetado {
  const p = a.inspecao?.projeto;
  return {
    id: a.id, inspecaoId: a.inspecao_id, os: a.inspecao?.identificacao || "OS",
    projeto: p?.codigo_projeto || p?.pedido_compra || "",
    tipo: a.tipo, tipoLabel: rotuloTipo(a.tipo), quando: quandoCurto(a),
    ficaSemEquipe: removerDaEquipe(a.equipe, usuarioId).vazia,
  };
}

/** Para a confirmação na tela, antes de desativar. Ordem: data (a definir no fim). */
export async function agendamentosFuturosAfetados(usuarioId: string): Promise<{ agendamentos: AgendamentoAfetado[]; erro: string | null }> {
  const { lista, erro } = await lerAgendamentosDoUsuario(usuarioId);
  const ordenada = [...lista].sort((x, y) => (x.data_visita || "9999").localeCompare(y.data_visita || "9999"));
  return { agendamentos: ordenada.map((a) => paraAfetado(a, usuarioId)), erro };
}

export interface ResultadoRemocao {
  /** Agendamentos cuja equipe mudou. */
  alterados: number;
  /** Desses, quantos ficaram sem ninguém. */
  semEquipe: number;
  /** Não foi possível gravar (ex.: alterado por outra pessoa duas vezes). */
  falhas: number;
  agendamentos: AgendamentoAfetado[];
}

/** Desativação: tira o usuário da equipe dos agendamentos futuros, avisa
 *  quem ficou na equipe e, se a equipe esvaziou, Comercial + Gerência. Cada
 *  agendamento é gravado com a versão lida (atualizado_em); se alguém o
 *  alterou no meio, relê e tenta de novo uma vez. Reativar não devolve. */
export async function removerDasEquipesFuturas(opts: {
  usuario: Pick<UsuarioRef, "id" | "nome_completo" | "email">;
  autorId: string;
}): Promise<ResultadoRemocao> {
  const admin = getSupabaseAdmin();
  const uid = opts.usuario.id;
  const nome = nomeDoUsuario(opts.usuario);
  const out: ResultadoRemocao = { alterados: 0, semEquipe: 0, falhas: 0, agendamentos: [] };
  const { lista } = await lerAgendamentosDoUsuario(uid);

  const avisosEquipe: { para: string[]; titulo: string; mensagem: string; link: string; inspecaoId: string }[] = [];
  const semEquipe: { titulo: string; mensagem: string; link: string; inspecaoId: string }[] = [];

  for (const original of lista) {
    let a: LinhaAgendamento | null = original;
    let gravado = false;
    for (let tentativa = 0; tentativa < 2 && a && !gravado; tentativa++) {
      const r = removerDaEquipe(a.equipe as MembroRef[], uid);
      if (!r.removido) { a = null; break; }
      let q = admin.from("gp_agendamentos")
        .update({ equipe: r.equipe, atualizado_em: new Date().toISOString() })
        .eq("id", a.id).is("substituido_em", null);
      q = a.atualizado_em ? q.eq("atualizado_em", a.atualizado_em) : q.is("atualizado_em", null);
      const { data, error } = await q.select("id");
      if (!error && data && data.length > 0) {
        gravado = true;
        out.alterados += 1;
        out.agendamentos.push(paraAfetado(a, uid));
        const os = a.inspecao?.identificacao || "OS";
        const link = `/inspecoes/${a.inspecao_id}`;
        const quando = emQuando(a);
        if (r.vazia) {
          out.semEquipe += 1;
          semEquipe.push({
            titulo: `Agendamento sem equipe — ${os}`,
            mensagem: `Agendamento de ${os} ${quando} ficou sem equipe — escale alguém. (${nome} foi desativado.)`,
            link, inspecaoId: a.inspecao_id,
          });
        } else {
          avisosEquipe.push({
            para: r.equipe.map((m) => m.id),
            titulo: `Equipe alterada — ${os}`,
            mensagem: `${nome} foi removido da equipe de ${os} ${quando}.`,
            link, inspecaoId: a.inspecao_id,
          });
        }
        break;
      }
      if (error) { console.error("[admin/users] equipe:", a.id, error.message); break; }
      // Ninguém atualizado: alterado (ou substituído) por outra pessoa — relê.
      const { data: novo } = await admin.from("gp_agendamentos").select(CAMPOS_AG).eq("id", a.id).maybeSingle();
      a = novo && !(novo as any).substituido_em ? (novo as unknown as LinhaAgendamento) : null;
    }
    if (!gravado && a) out.falhas += 1;
  }

  // Avisos (in-app + push, best-effort — a desativação já foi gravada).
  try {
    const linhas = avisosEquipe.flatMap((n) => n.para.map((id) => ({
      usuario_id: id, tipo: "agendamento", titulo: n.titulo, mensagem: n.mensagem, link: n.link,
      inspecao_id: n.inspecaoId, criado_por: opts.autorId,
    })));
    if (semEquipe.length) {
      const { data: gestores } = await admin.from("gp_profiles").select("id").in("perfil", ["comercial", "gerencia"]).eq("ativo", true);
      const ids = (gestores || []).map((g: any) => g.id).filter((id: string) => id !== uid);
      semEquipe.forEach((n) => ids.forEach((id: string) => linhas.push({
        usuario_id: id, tipo: "agendamento", titulo: n.titulo, mensagem: n.mensagem, link: n.link,
        inspecao_id: n.inspecaoId, criado_por: opts.autorId,
      })));
      for (const n of semEquipe) {
        try { await enviarPushParaUsuarios(ids, { titulo: n.titulo, mensagem: n.mensagem, link: n.link }); } catch { /* push é complementar */ }
      }
    }
    if (linhas.length) {
      const { error } = await admin.from("gp_notificacoes").insert(linhas);
      if (error) console.error("[admin/users] notificações:", error.message);
    }
    for (const n of avisosEquipe) {
      try { await enviarPushParaUsuarios(n.para, { titulo: n.titulo, mensagem: n.mensagem, link: n.link }); } catch { /* idem */ }
    }
  } catch (e: any) {
    console.error("[admin/users] avisos:", e?.message || e);
  }

  return out;
}
