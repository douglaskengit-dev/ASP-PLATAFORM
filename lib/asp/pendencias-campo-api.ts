/**
 * Pendências de campo — leitura no banco e envio dos avisos (servidor).
 * A regra (o que conta como pendência, quem recebe) está em
 * lib/asp/pendencias-campo.ts.
 *
 * Avisos: a rotina do banco (pg_cron + pg_net, migração
 * 20261108100000_asp_pendencias_campo.sql) chama /api/cron/pendencias-campo
 * às 11h, 16h e 17h30 (Brasília). Cada usuário recebe UM aviso por turno —
 * gp_pendencias_campo_envios guarda o que já foi (chamada repetida não
 * duplica) — e quem tocou "Não avisar mais hoje" (gp_pendencias_campo_silencio)
 * fica de fora até amanhã.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeBrasil } from "@/lib/validacao/formatos";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import {
  montarPendencias, pendenciasDoUsuario, mensagemAviso,
  type PendenciaOS, type TurnoAviso,
} from "./pendencias-campo";

export const LINK_PENDENCIAS = "/dashboard#pendencias-campo";

/** Pendências de hoje de todas as execuções em andamento. */
export async function carregarPendencias(supabase: SupabaseClient, hoje = hojeBrasil()): Promise<PendenciaOS[]> {
  const { data: ags } = await supabase.from("gp_agendamentos")
    .select("inspecao_id, tipo, data_visita, data_fim, a_definir, substituido_em, equipe")
    .eq("tipo", "execucao").is("substituido_em", null).lte("data_visita", hoje);
  // período que ainda inclui hoje (data_fim ≥ hoje, ou um dia só = hoje)
  const ativos = (ags || []).filter((a: any) => (a.data_fim || a.data_visita) >= hoje && !a.a_definir);
  if (ativos.length === 0) return [];

  const ids = Array.from(new Set(ativos.map((a: any) => a.inspecao_id as string)));
  const { data: insps } = await supabase.from("gp_inspecoes")
    .select("id, identificacao, fase, procedimento, encerrada_em, excluido_em, projeto_id, projeto:gp_projetos(codigo_projeto, pedido_compra)")
    .in("id", ids).eq("fase", 7);
  const abertas = (insps || []).filter((i: any) => !i.encerrada_em && !i.excluido_em);
  if (abertas.length === 0) return [];

  const idsAbertas = abertas.map((i: any) => i.id as string);
  const projetos = Array.from(new Set(abertas.map((i: any) => i.projeto_id as string)));
  const codigos = Array.from(new Set(abertas.map((i: any) => i.procedimento).filter(Boolean))) as string[];
  const [{ data: fotos }, { data: rdos }, { data: procs }] = await Promise.all([
    supabase.from("gp_fotos_execucao").select("*").in("inspecao_id", idsAbertas),
    supabase.from("gp_rdos").select("projeto_id").in("projeto_id", projetos).eq("data", hoje).is("excluido_em", null),
    codigos.length
      ? supabase.from("gp_procedimentos").select("*").in("codigo", codigos)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return montarPendencias({
    hoje,
    agendamentos: ativos as any,
    inspecoes: abertas as any,
    procedimentos: (procs || []) as any,
    fotos: ((fotos || []) as any[]).map((f) => ({ ...f, itens: f.itens || {} })),
    rdosHoje: (rdos || []) as any,
  });
}

/** O usuário tocou "Não avisar mais hoje"? */
export async function silenciadoHoje(supabase: SupabaseClient, usuarioId: string, hoje = hojeBrasil()): Promise<boolean> {
  const { data } = await supabase.from("gp_pendencias_campo_silencio")
    .select("usuario_id").eq("usuario_id", usuarioId).eq("data", hoje).maybeSingle();
  return !!data;
}

/**
 * Envia o aviso do turno para cada pessoa da equipe com pendência. Usa o
 * cliente admin (sem RLS). Devolve o resumo para o log da rotina.
 */
export async function enviarAvisosPendencias(admin: SupabaseClient, turno: TurnoAviso, hoje = hojeBrasil()) {
  const lista = await carregarPendencias(admin, hoje);
  const usuarios = Array.from(new Set(lista.flatMap((p) => p.equipe)));
  if (usuarios.length === 0) return { turno, hoje, oss: lista.length, avisados: 0, silenciados: 0 };

  const { data: sil } = await admin.from("gp_pendencias_campo_silencio")
    .select("usuario_id").eq("data", hoje).in("usuario_id", usuarios);
  const silenciados = new Set((sil || []).map((s: any) => s.usuario_id as string));

  let avisados = 0;
  for (const uid of usuarios) {
    if (silenciados.has(uid)) continue;
    const minhas = pendenciasDoUsuario(lista, uid, turno);
    if (minhas.length === 0) continue;
    // trava de idempotência: a chave (data, turno, usuário) só entra uma vez —
    // chamada repetida (ou duas ao mesmo tempo) bate no 23505 e não reenvia
    const { error: jaFoi } = await admin.from("gp_pendencias_campo_envios")
      .insert({ data: hoje, turno, usuario_id: uid, oss: minhas.map((p) => p.inspecaoId) });
    if (jaFoi) continue;

    const { titulo, mensagem } = mensagemAviso(minhas, turno);
    await admin.from("gp_notificacoes").insert({
      usuario_id: uid, tipo: "pendencias_campo", titulo, mensagem, link: LINK_PENDENCIAS,
      inspecao_id: minhas.length === 1 ? minhas[0].inspecaoId : null,
    });
    try {
      await enviarPushParaUsuarios([uid], {
        titulo, mensagem, link: LINK_PENDENCIAS, tag: "pendencias-campo",
        acoes: [{ acao: "silenciar-pendencias", titulo: "Não avisar mais hoje" }],
      });
    } catch { /* push é complementar ao aviso no app */ }
    avisados++;
  }
  return { turno, hoje, oss: lista.length, avisados, silenciados: silenciados.size };
}
