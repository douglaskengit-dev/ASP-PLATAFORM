/** Cliente recorrente — lado servidor (chave de serviço). Não é rota.
 *
 *  · situacaoRecorrencia(ids?): próximo serviço de cada cliente recorrente
 *    (regras em lib/validacao/recorrencia.ts) — lista e detalhe do cliente,
 *    lembretes.
 *  · gerarLembretesRecorrencia(): passo IDEMPOTENTE que gera os lembretes
 *    vencidos/em breve. Não há cron: roda quando o Comercial/Gerência abre
 *    o app (busca das notificações), no Dashboard e em
 *    GET /api/recorrencia/lembretes. No máximo UM lembrete por cliente e
 *    vencimento: a chave única de gp_lembretes_recorrencia (orgao_id,
 *    vencimento) decide quem notifica — duas chamadas ao mesmo tempo, só uma
 *    insere; a outra recebe 23505 e não notifica.
 *
 *  Sem a migração (colunas/tabela), nada quebra: nenhum cliente é
 *  recorrente e os lembretes não são gerados. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import {
  diaBrasilia, hojeBrasil, lembreteDevido, proximoServico, type OSRecorrencia, type ProximoServico,
} from "@/lib/validacao";

export const TIPO_NOTIFICACAO_RECORRENCIA = "recorrencia";
/** Perfis avisados do próximo serviço. */
export const PERFIS_LEMBRETE_RECORRENCIA = ["comercial", "gerencia"];

export interface SituacaoCliente {
  id: string;
  razao_social: string;
  periodicidade_meses: number | null;
  aviso_antecedencia_dias: number;
  proximo: ProximoServico;
}

async function lotes<T>(ids: string[], ler: (lote: string[]) => any): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await ler(ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
  }
  return out;
}

/** Próximo serviço de cada cliente RECORRENTE ativo (ou só de `ids`). */
export async function situacaoRecorrencia(ids?: string[], hoje: string = hojeBrasil()): Promise<Map<string, SituacaoCliente>> {
  const admin = getSupabaseAdmin();
  let q = admin.from("gp_orgaos").select("*").is("excluido_em", null);
  if (ids?.length) q = q.in("id", ids);
  const { data: orgaos, error } = await q;
  if (error) throw new Error(error.message);
  const recorrentes = ((orgaos || []) as any[]).filter((o) => o.recorrente === true);
  const out = new Map<string, SituacaoCliente>();
  if (!recorrentes.length) return out;

  const projetos = await lotes<any>(recorrentes.map((o) => o.id), (l) =>
    admin.from("gp_projetos").select("id, cliente_id").in("cliente_id", l).is("excluido_em", null));
  const clienteDoProjeto = new Map(projetos.map((p) => [p.id as string, p.cliente_id as string]));
  const oss = projetos.length
    ? await lotes<any>(projetos.map((p) => p.id), (l) =>
      admin.from("gp_inspecoes").select("id, projeto_id, criado_em, encerrada_em").in("projeto_id", l).is("excluido_em", null))
    : [];
  const ags = oss.length
    ? await lotes<any>(oss.map((o) => o.id), (l) =>
      admin.from("gp_agendamentos").select("inspecao_id, tipo, data_visita, data_fim, a_definir")
        .in("inspecao_id", l).eq("tipo", "execucao").is("substituido_em", null))
    : [];

  const porCliente = new Map<string, OSRecorrencia[]>();
  for (const o of oss) {
    const cli = clienteDoProjeto.get(o.projeto_id);
    if (!cli) continue;
    const lista = porCliente.get(cli) || [];
    lista.push({
      id: o.id, criadaEm: diaBrasilia(o.criado_em), encerradaEm: o.encerrada_em || null,
      agendamentos: ags.filter((a) => a.inspecao_id === o.id),
    });
    porCliente.set(cli, lista);
  }
  for (const o of recorrentes) {
    const cfg = { periodicidadeMeses: o.periodicidade_meses, avisoAntecedenciaDias: o.aviso_antecedencia_dias };
    out.set(o.id, {
      id: o.id, razao_social: o.razao_social, periodicidade_meses: o.periodicidade_meses ?? null,
      aviso_antecedencia_dias: o.aviso_antecedencia_dias ?? 30,
      proximo: proximoServico(cfg, porCliente.get(o.id) || [], hoje),
    });
  }
  return out;
}

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Texto do lembrete (in-app e push). */
export function textoLembrete(s: SituacaoCliente): { titulo: string; mensagem: string } {
  const p = s.proximo;
  const venc = p.vencimento ? fmt(p.vencimento) : "—";
  const titulo = p.status === "vencido"
    ? `Serviço recorrente vencido — ${s.razao_social}`
    : `Próximo serviço recorrente em breve — ${s.razao_social}`;
  const mensagem = `${s.razao_social}: serviço a cada ${s.periodicidade_meses} meses; última execução em `
    + `${p.ultimaExecucao ? fmt(p.ultimaExecucao) : "—"}; próximo vence em ${venc}`
    + `${p.status === "vencido" ? " (vencido)" : ""}. Abra um novo projeto para o cliente.`;
  return { titulo, mensagem };
}

let ultimaGeracao = 0;
const INTERVALO_MS = 5 * 60 * 1000;

/** Gera os lembretes devidos (idempotente). `forcar` ignora o intervalo
 *  mínimo entre execuções nesta instância (5 min — só economia; a chave
 *  única é que garante um lembrete por ciclo). */
export async function gerarLembretesRecorrencia(opts: { forcar?: boolean; hoje?: string } = {}): Promise<{ gerados: number; situacoes: SituacaoCliente[] }> {
  const agora = Date.now();
  if (!opts.forcar && agora - ultimaGeracao < INTERVALO_MS) return { gerados: 0, situacoes: [] };
  ultimaGeracao = agora;
  const admin = getSupabaseAdmin();
  const mapa = await situacaoRecorrencia(undefined, opts.hoje || hojeBrasil());
  const situacoes = Array.from(mapa.values());
  const devidos = situacoes.filter((s) => lembreteDevido(s.proximo));
  if (!devidos.length) return { gerados: 0, situacoes };

  const { data: usuarios } = await admin.from("gp_profiles").select("id").in("perfil", PERFIS_LEMBRETE_RECORRENCIA).eq("ativo", true);
  const destinatarios = ((usuarios || []) as any[]).map((u) => u.id as string);
  let gerados = 0;
  for (const s of devidos) {
    // Quem insere o (cliente, vencimento) primeiro notifica; os demais param aqui.
    const { data: novo, error } = await admin.from("gp_lembretes_recorrencia")
      .insert({ orgao_id: s.id, vencimento: s.proximo.vencimento, destinatarios: destinatarios.length })
      .select("id").maybeSingle();
    if (error || !novo) continue;   // 23505 (já lembrado) ou tabela ausente
    gerados++;
    if (!destinatarios.length) continue;
    const { titulo, mensagem } = textoLembrete(s);
    const link = `/orgaos/${s.id}`;
    await admin.from("gp_notificacoes").insert(destinatarios.map((id) => ({
      usuario_id: id, tipo: TIPO_NOTIFICACAO_RECORRENCIA, titulo, mensagem, link,
    })));
    try {
      await enviarPushParaUsuarios(destinatarios, { titulo, mensagem, link });
    } catch { /* push é complementar */ }
  }
  return { gerados, situacoes };
}
