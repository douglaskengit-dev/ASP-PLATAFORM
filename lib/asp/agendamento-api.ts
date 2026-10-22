/** Lado servidor do agendamento (Fase 2): contexto do banco para
 *  lib/validacao/agendamento.ts e os avisos (in-app, push, e-mail + .ics).
 *  Usado por /api/agendamentos (POST), /api/agendamentos/[id] (PATCH/DELETE)
 *  e /api/agendamentos/verificar — a mesma regra nas três. Lê com a chave
 *  de serviço: conflito de equipe/equipamento olha TODAS as OSs.
 *
 *  Ativo = substituido_em is null. Remarcação nunca apaga: a linha antiga
 *  ganha substituido_em/substituido_por e só aparece no histórico. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarEmail } from "@/lib/email";
import { emailAgendamentoHtml } from "@/lib/email-templates";
import { gerarIcsAgendamento } from "@/lib/ics";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import {
  AgendamentoRef, ContextoAgendamento, DadosAgendamento, hojeBrasil, MembroEquipe, nomeDoCatalogo, normalizarEspacos,
} from "@/lib/validacao";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://asp-plataform.vercel.app";

export const PERFIS_AGENDA = ["admin", "comercial", "gerencia"];

/** Tipo da notificação in-app do aviso "data a definir". */
export const TIPO_AVISO_A_DEFINIR = "agendamento_a_definir";

const CAMPOS_REF =
  "id, inspecao_id, tipo, data_visita, a_definir, equipe, equipamentos, " +
  "inspecao:gp_inspecoes(identificacao, excluido_em, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, excluido_em))";

/** Dados como vieram da tela → limpos: espaços colapsados, "data a definir"
 *  sem data/hora, equipe e itens vazios fora. Equipamento escrito de outro
 *  jeito que um item do Catálogo vira o nome do Catálogo. */
export function limparDados(d: Partial<DadosAgendamento>, catalogo: string[] = []): DadosAgendamento {
  const aDefinir = !!d.aDefinir;
  const texto = (v: unknown) => normalizarEspacos(typeof v === "string" ? v : "");
  const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  return {
    tipo: d.tipo === "execucao" ? "execucao" : "inspecao",
    aDefinir,
    dataVisita: aDefinir ? null : texto(d.dataVisita) || null,
    hora: aDefinir ? null : texto(d.hora) || null,
    dataExecucao: texto(d.dataExecucao) || null,
    lembrarEm: aDefinir ? texto(d.lembrarEm) || null : null,
    equipe: lista(d.equipe).filter((m) => m && m.id).map((m) => ({ id: String(m.id), nome: texto(m.nome) || "usuário" })),
    equipamentos: lista(d.equipamentos).map(texto).filter(Boolean).map((e) => nomeDoCatalogo(e, catalogo)),
    checklist: lista(d.checklist).filter((c) => c && texto(c.item)).map((c) => ({ item: texto(c.item), ok: !!c.ok })),
  };
}

/** O que a notificação/e-mail precisa saber da OS. */
export interface InfoOS {
  id: string;
  ident: string;
  projetoId: string | null;
  projLabel: string;
  endereco: string;
  clienteNome: string;
  dataAbertura: string | null;
}

function paraRef(a: any): AgendamentoRef {
  const p = a.inspecao?.projeto;
  return {
    id: a.id, inspecao_id: a.inspecao_id, tipo: a.tipo, data_visita: a.data_visita, a_definir: !!a.a_definir,
    equipe: a.equipe || [], equipamentos: a.equipamentos || [],
    os: a.inspecao?.identificacao || null,
    projeto_id: p?.id || null, projeto: p?.codigo_projeto || p?.pedido_compra || null, endereco: p?.endereco || null,
  };
}

/** OS (ou projeto) na lixeira não conta como conflito. */
function daLixeira(a: any): boolean {
  return !!a.inspecao?.excluido_em || !!a.inspecao?.projeto?.excluido_em;
}

export async function infoDaOS(inspecaoId: string): Promise<InfoOS | null> {
  const { data } = await getSupabaseAdmin()
    .from("gp_inspecoes")
    .select("id, identificacao, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, data_abertura, cliente:gp_orgaos(razao_social))")
    .eq("id", inspecaoId)
    .maybeSingle();
  if (!data) return null;
  const p: any = data.projeto;
  return {
    id: data.id, ident: data.identificacao || "OS",
    projetoId: p?.id || null, projLabel: p?.codigo_projeto || p?.pedido_compra || "",
    endereco: p?.endereco || "", clienteNome: p?.cliente?.razao_social || "", dataAbertura: p?.data_abertura || null,
  };
}

/** Contexto do banco para validar um agendamento desta OS na data dada. */
export async function contextoAgendamento(opts: {
  inspecaoId: string;
  dataVisita?: string | null;
  original?: { id: string; data_visita: string | null } | null;
}): Promise<{ ctx: ContextoAgendamento; info: InfoOS | null }> {
  const admin = getSupabaseAdmin();
  const [info, daOS, noDia, ativos, catalogo] = await Promise.all([
    infoDaOS(opts.inspecaoId),
    admin.from("gp_agendamentos").select(CAMPOS_REF).eq("inspecao_id", opts.inspecaoId).is("substituido_em", null),
    opts.dataVisita
      ? admin.from("gp_agendamentos").select(CAMPOS_REF).eq("data_visita", opts.dataVisita).is("substituido_em", null).neq("inspecao_id", opts.inspecaoId)
      : Promise.resolve({ data: [] as any[] }),
    admin.from("gp_profiles").select("id").eq("ativo", true),
    admin.from("gp_equipamentos").select("nome"),
  ]);
  const ctx: ContextoAgendamento = {
    hoje: hojeBrasil(),
    inspecaoId: opts.inspecaoId,
    dataAbertura: info?.dataAbertura || null,
    local: info ? { projetoId: info.projetoId, endereco: info.endereco || null } : undefined,
    original: opts.original || null,
    daOS: (daOS.data || []).map(paraRef),
    noDia: (noDia.data || []).filter((a: any) => !daLixeira(a)).map(paraRef),
    usuariosAtivos: (ativos.data || []).map((u: any) => u.id),
    catalogo: (catalogo.data || []).map((e: any) => e.nome).filter(Boolean),
  };
  return { ctx, info };
}

function fmtData(iso?: string | null) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

const rotuloTipo = (tipo: string) => (tipo === "execucao" ? "Execução" : "Inspeção");

/** Visita com data: avisa a equipe (in-app + push + e-mail com .ics, Gerência/
 *  Comercial em cópia). `remarcadoDe` = data anterior → texto de remarcação. */
export async function notificarEquipe(opts: {
  ag: any;
  info: InfoOS;
  autorId: string;
  remarcadoDe?: string | null;
}): Promise<Record<string, unknown>> {
  const { ag, info } = opts;
  const equipe: MembroEquipe[] = (ag.equipe || []).filter((m: any) => m && m.id);
  if (equipe.length === 0) return { destinatarios: 0, ignorado: true, motivo: "nenhum usuário na equipe" };

  const admin = getSupabaseAdmin();
  const tipoLabel = rotuloTipo(ag.tipo);
  const quando = `${fmtData(ag.data_visita)}${ag.hora ? " às " + ag.hora : ""}`;
  const proj = info.projLabel ? ` (${info.projLabel})` : "";
  const titulo = opts.remarcadoDe
    ? `${tipoLabel} remarcada — ${info.ident}${proj}`
    : `${tipoLabel} agendada — ${info.ident}${proj}`;
  const mensagem = opts.remarcadoDe
    ? `${tipoLabel} da OS ${info.ident}${proj} remarcada de ${fmtData(opts.remarcadoDe)} para ${quando}.`
    : `${tipoLabel} da OS ${info.ident}${proj} agendada para ${quando}.`;
  const link = `/inspecoes/${info.id}`;

  await admin.from("gp_notificacoes").insert(
    equipe.map((m) => ({
      usuario_id: m.id, tipo: "agendamento", titulo, mensagem, link,
      inspecao_id: info.id, criado_por: opts.autorId,
    }))
  );

  // Push (Web Push/VAPID) — best-effort; não bloqueia o agendamento se falhar.
  try {
    await enviarPushParaUsuarios(equipe.map((m) => m.id), { titulo, mensagem, link });
  } catch (e) { /* ignora: push é complementar ao in-app/e-mail */ }

  // Destinatários: equipe (para) + Gerência/Comercial em cópia.
  const { data: eqPerfis } = await admin.from("gp_profiles").select("email").in("id", equipe.map((m) => m.id));
  const paraEmails = (eqPerfis || []).map((p: any) => p.email).filter(Boolean);
  const { data: gestores } = await admin.from("gp_profiles").select("email").in("perfil", ["gerencia", "comercial"]).eq("ativo", true);
  const ccEmails = (gestores || []).map((p: any) => p.email).filter(Boolean);

  const html = emailAgendamentoHtml({
    tipoLabel, ident: info.ident, cliente: info.clienteNome, projeto: info.projLabel, endereco: info.endereco, quando,
    equipe: equipe.map((m) => m.nome),
    equipamentos: ag.equipamentos || [],
    checklist: ag.checklist || [],
    link: `${APP_URL}${link}`,
    remarcadoDe: opts.remarcadoDe ? fmtData(opts.remarcadoDe) : undefined,
  });
  const ics = gerarIcsAgendamento({
    uid: `${ag.id}@asp-plataforma`,
    titulo, descricao: mensagem,
    local: info.endereco || info.projLabel || undefined,
    data: ag.data_visita, hora: ag.hora,
    organizador: process.env.EMAIL_REMETENTE?.match(/<(.+)>/)?.[1],
    participantes: paraEmails,
  });
  const resultado = await enviarEmail(
    paraEmails, titulo, html,
    [{ filename: "agendamento.ics", content: ics, contentType: "text/calendar" }],
    { cc: ccEmails }
  );
  return { destinatarios: paraEmails.length, ...resultado };
}

/** "Data a definir": aviso in-app (+ push) para Comercial, Gerência e Admin. */
export async function notificarADefinir(opts: { ag: any; info: InfoOS; autorId: string }): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: gestores } = await admin.from("gp_profiles").select("id").in("perfil", PERFIS_AGENDA).eq("ativo", true);
  const ids = (gestores || []).map((g: any) => g.id);
  if (ids.length === 0) return;
  const proj = opts.info.projLabel ? ` (${opts.info.projLabel})` : "";
  const titulo = `Agendamento com data a definir — ${opts.info.ident}${proj}`;
  const mensagem = `${rotuloTipo(opts.ag.tipo)} da OS ${opts.info.ident}${proj} está sem data.`
    + (opts.ag.lembrar_em ? ` Lembrar em ${fmtData(opts.ag.lembrar_em)}.` : " Defina a data assim que possível.");
  const link = `/inspecoes/${opts.info.id}`;
  await admin.from("gp_notificacoes").insert(ids.map((id: string) => ({
    usuario_id: id, tipo: TIPO_AVISO_A_DEFINIR, titulo, mensagem, link,
    inspecao_id: opts.info.id, criado_por: opts.autorId,
  })));
  try {
    await enviarPushParaUsuarios(ids, { titulo, mensagem, link });
  } catch (e) { /* ignora: push é complementar */ }
}

/** A visita marcada saiu da agenda (virou "data a definir"): avisa in-app a
 *  equipe que estava escalada, para ninguém ir a campo à toa. */
export async function notificarDesmarcacao(opts: { anterior: any; info: InfoOS; autorId: string }): Promise<void> {
  const equipe: MembroEquipe[] = (opts.anterior.equipe || []).filter((m: any) => m && m.id);
  if (equipe.length === 0 || !opts.anterior.data_visita) return;
  const proj = opts.info.projLabel ? ` (${opts.info.projLabel})` : "";
  const titulo = `${rotuloTipo(opts.anterior.tipo)} desmarcada — ${opts.info.ident}${proj}`;
  const mensagem = `A visita de ${fmtData(opts.anterior.data_visita)} da OS ${opts.info.ident}${proj} foi desmarcada; a nova data está a definir.`;
  const link = `/inspecoes/${opts.info.id}`;
  await getSupabaseAdmin().from("gp_notificacoes").insert(equipe.map((m) => ({
    usuario_id: m.id, tipo: "agendamento", titulo, mensagem, link, inspecao_id: opts.info.id, criado_por: opts.autorId,
  })));
  try {
    await enviarPushParaUsuarios(equipe.map((m) => m.id), { titulo, mensagem, link });
  } catch (e) { /* ignora */ }
}

/** A data foi definida (ou o pendente saiu): o aviso deixa de ser pendência. */
export async function resolverAvisoADefinir(inspecaoId: string): Promise<void> {
  await getSupabaseAdmin().from("gp_notificacoes").update({ lida: true })
    .eq("inspecao_id", inspecaoId).eq("tipo", TIPO_AVISO_A_DEFINIR).eq("lida", false);
}

/** Tira de cena os agendamentos substituídos por `novoId` (remarcação). */
export async function marcarSubstituidos(supabase: any, ids: string[], novoId: string): Promise<string | null> {
  if (ids.length === 0) return null;
  const { error } = await supabase.from("gp_agendamentos")
    .update({ substituido_em: new Date().toISOString(), substituido_por: novoId, atualizado_em: new Date().toISOString() })
    .in("id", ids).is("substituido_em", null);
  return error ? error.message : null;
}
