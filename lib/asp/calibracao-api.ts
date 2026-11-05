/**
 * Calibração dos equipamentos — leitura no banco e avisos (servidor).
 * Regras puras em lib/validacao/calibracao.ts.
 *
 * Avisos: a rotina do banco (pg_cron + pg_net, migração
 * 20261112100000_asp_calibracao.sql) chama /api/cron/calibracao todo dia às
 * 8h (Brasília). Cada unidade avisa uma vez por etapa e vencimento —
 * gp_calibracao_avisos guarda o que já foi (a chamada repetida não duplica).
 * Todos os usuários ativos recebem UMA notificação com as unidades do dia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hojeBrasil } from "@/lib/validacao/formatos";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { removerArquivos } from "@/lib/processos/arquivos";
import {
  caminhoCertificadoValido, etapaAvisoCalibracao, mensagemAvisoCalibracao,
  type CalibracaoDoEquipamento, type ItemAvisoCalibracao, type UnidadeEquipamento,
} from "@/lib/validacao/calibracao";

export const LINK_CALIBRACOES = "/dashboard#calibracoes";
export const CAMPOS_UNIDADE =
  "id, equipamento_id, identificacao, observacao, ativo, calibrado_em, vence_em, validade_meses, certificado, laboratorio, certificado_path, atualizado_em";

/** Mensagem para quando a migração da calibração ainda não rodou. */
export const MSG_MIGRACAO_CALIBRACAO =
  "O banco ainda não tem as tabelas da calibração — rode a migração 20261112100000_asp_calibracao.sql (ou o verificacao-db-asp.sql).";

export function faltaMigracaoCalibracao(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205" || e.code === "PGRST204"
    || /does not exist|could not find the table|schema cache/i.test(e.message || ""));
}

/** Unidades (todas) + equipamentos com a marcação ou com unidade. */
export async function carregarCalibracao(supabase: SupabaseClient): Promise<{
  equipamentos: { id: string; slug: string; nome: string; ativo: boolean; exige_calibracao: boolean }[];
  unidades: UnidadeEquipamento[];
  erro?: string;
}> {
  const [eq, un] = await Promise.all([
    supabase.from("gp_equipamentos").select("id, slug, nome, ativo, exige_calibracao"),
    supabase.from("gp_equipamento_unidades").select(CAMPOS_UNIDADE).order("identificacao"),
  ]);
  if (faltaMigracaoCalibracao(eq.error) || faltaMigracaoCalibracao(un.error)) {
    return { equipamentos: [], unidades: [], erro: MSG_MIGRACAO_CALIBRACAO };
  }
  if (eq.error || un.error) return { equipamentos: [], unidades: [], erro: (eq.error || un.error)!.message };
  const unidades = (un.data || []) as UnidadeEquipamento[];
  const comUnidade = new Set(unidades.map((u) => u.equipamento_id));
  const equipamentos = ((eq.data || []) as any[])
    .filter((e) => e.exige_calibracao || comUnidade.has(e.id))
    .map((e) => ({ id: e.id, slug: e.slug, nome: e.nome, ativo: e.ativo !== false, exige_calibracao: !!e.exige_calibracao }));
  return { equipamentos, unidades };
}

/** Para o agendamento: equipamentos ativos que exigem calibração, pelo nome
 *  (é o nome que o agendamento guarda). Erro de leitura = undefined (não
 *  avisa sem saber). */
export async function calibracoesParaAgendamento(supabase: SupabaseClient): Promise<CalibracaoDoEquipamento[] | undefined> {
  const { equipamentos, unidades, erro } = await carregarCalibracao(supabase);
  if (erro) return undefined;
  return equipamentos.filter((e) => e.exige_calibracao && e.ativo).map((e) => ({
    nome: e.nome,
    unidades: unidades.filter((u) => u.equipamento_id === e.id && u.ativo !== false)
      .map((u) => ({ identificacao: u.identificacao, vence_em: u.vence_em || null })),
  }));
}

/** Copia para a unidade a calibração mais recente do histórico (ou limpa,
 *  se não sobrou nenhuma). */
export async function atualizarVigente(admin: SupabaseClient, unidadeId: string, usuarioId: string | null) {
  const { data } = await admin.from("gp_calibracoes")
    .select("calibrado_em, vence_em, validade_meses, certificado, laboratorio, certificado_path")
    .eq("unidade_id", unidadeId).order("calibrado_em", { ascending: false }).order("registrado_em", { ascending: false })
    .limit(1).maybeSingle();
  const c: any = data || {};
  return admin.from("gp_equipamento_unidades").update({
    calibrado_em: c.calibrado_em || null, vence_em: c.vence_em || null, validade_meses: c.validade_meses ?? null,
    certificado: c.certificado || null, laboratorio: c.laboratorio || null, certificado_path: c.certificado_path || null,
    atualizado_em: new Date().toISOString(), atualizado_por: usuarioId,
  }).eq("id", unidadeId).select(CAMPOS_UNIDADE).single();
}

/** Rotina diária: avisa todos os usuários ativos das unidades que entraram
 *  numa etapa nova (30 dias, 7 dias, hoje, vencida — semanal). */
export async function enviarAvisosCalibracao(admin: SupabaseClient, hoje = hojeBrasil()) {
  const { equipamentos, unidades, erro } = await carregarCalibracao(admin);
  if (erro) return { hoje, erro };
  const exigem = new Map(equipamentos.filter((e) => e.exige_calibracao && e.ativo).map((e) => [e.id, e.nome]));
  const candidatas = unidades
    .filter((u) => u.ativo !== false && exigem.has(u.equipamento_id) && u.vence_em)
    .map((u) => ({ u, etapa: etapaAvisoCalibracao(u.vence_em, hoje) }))
    .filter((x): x is { u: UnidadeEquipamento; etapa: string } => !!x.etapa);
  if (!candidatas.length) return { hoje, unidades: 0, avisados: 0 };

  const { data: usuarios } = await admin.from("gp_profiles").select("id").eq("ativo", true);
  const ids = (usuarios || []).map((u: any) => u.id as string);

  // Trava de idempotência: só entra o que ainda não foi avisado nesta etapa
  // (chamada repetida ou duas ao mesmo tempo não duplicam).
  const { data: novas, error } = await admin.from("gp_calibracao_avisos")
    .upsert(candidatas.map(({ u, etapa }) => ({ unidade_id: u.id, vence_em: u.vence_em, etapa, usuarios: ids.length })),
      { onConflict: "unidade_id,vence_em,etapa", ignoreDuplicates: true })
    .select("unidade_id");
  if (error) return { hoje, erro: error.message };
  const entraram = new Set((novas || []).map((n: any) => n.unidade_id as string));
  const itens: ItemAvisoCalibracao[] = candidatas.filter(({ u }) => entraram.has(u.id)).map(({ u }) => ({
    equipamento: exigem.get(u.equipamento_id) || "Equipamento", identificacao: u.identificacao, vence_em: u.vence_em!,
  }));
  if (!itens.length || !ids.length) return { hoje, unidades: itens.length, avisados: 0 };

  const { titulo, mensagem } = mensagemAvisoCalibracao(itens, hoje);
  await admin.from("gp_notificacoes").insert(ids.map((id) => ({
    usuario_id: id, tipo: "calibracao", titulo, mensagem, link: LINK_CALIBRACOES,
  })));
  try {
    await enviarPushParaUsuarios(ids, { titulo, mensagem, link: LINK_CALIBRACOES, tag: "calibracao" });
  } catch { /* push é complementar ao aviso no app */ }
  return { hoje, unidades: itens.length, avisados: ids.length };
}

/** Apaga o PDF do storage se nenhuma calibração (histórico ou vigente) o usa. */
export async function removerCertificadoSemUso(caminho: string | null | undefined): Promise<boolean> {
  if (!caminhoCertificadoValido(caminho)) return false;
  const admin = getSupabaseAdmin();
  const [h, u] = await Promise.all([
    admin.from("gp_calibracoes").select("id").eq("certificado_path", caminho).limit(1),
    admin.from("gp_equipamento_unidades").select("id").eq("certificado_path", caminho).limit(1),
  ]);
  if (h.error || u.error || (h.data || []).length || (u.data || []).length) return false;
  await removerArquivos([caminho]);
  return true;
}
