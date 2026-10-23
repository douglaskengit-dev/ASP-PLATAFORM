/** Lado servidor do agendamento (Fase 2): contexto do banco para
 *  lib/validacao/agendamento.ts e os avisos (in-app, push, e-mail + .ics).
 *  Usado por /api/agendamentos (POST), /api/agendamentos/[id] (PATCH/DELETE)
 *  e /api/agendamentos/verificar — a mesma regra nas três. Lê com a chave
 *  de serviço: conflito de equipe/equipamento olha TODAS as OSs.
 *
 *  Ativo = substituido_em is null. Remarcação nunca apaga: a linha antiga
 *  ganha substituido_em/substituido_por e só aparece no histórico.
 *
 *  Fase 6: a execução pode ter PERÍODO (data_visita = início, data_fim =
 *  último dia). Conflito de equipe/equipamento olha qualquer dia em comum;
 *  e-mail/.ics saem como evento de vários dias. Uma execução ativa por OS
 *  (índice uq_gp_agendamentos_execucao_ativa): a anterior sai de cena ANTES
 *  de a nova ser gravada (tirarDeCena → insert → ligarSubstituidos). */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarEmail } from "@/lib/email";
import { emailAgendamentoHtml } from "@/lib/email-templates";
import { gerarIcsAgendamento } from "@/lib/ics";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import {
  AgendamentoRef, ContextoAgendamento, DadosAgendamento, hojeBrasil, MembroEquipe, nomeDoCatalogo, nomesEquipamentosProcedimento,
  APP_URL_PADRAO, normalizarBaseUrl, normalizarEspacos, periodoDe, textoPeriodoLongo,
  provedorEmail, remetenteEmail, separarRemetente,
} from "@/lib/validacao";

// Sem barra no fim (NEXT_PUBLIC_APP_URL pode vir "https://…app/" → "//inspecoes").
const APP_URL = normalizarBaseUrl(process.env.NEXT_PUBLIC_APP_URL) || APP_URL_PADRAO;

export const PERFIS_AGENDA = ["admin", "comercial", "gerencia"];

/** Tipo da notificação in-app do aviso "data a definir". */
export const TIPO_AVISO_A_DEFINIR = "agendamento_a_definir";

const CAMPOS_REF =
  "id, inspecao_id, tipo, data_visita, data_fim, data_execucao, a_definir, equipe, equipamentos, " +
  "inspecao:gp_inspecoes(identificacao, excluido_em, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, excluido_em))";

/** Dados como vieram da tela → limpos: espaços colapsados, "data a definir"
 *  sem data/hora, equipe e itens vazios fora. Equipamento escrito de outro
 *  jeito que um item do Catálogo vira o nome do Catálogo. */
export function limparDados(d: Partial<DadosAgendamento>, catalogo: string[] = []): DadosAgendamento {
  const aDefinir = !!d.aDefinir;
  const texto = (v: unknown) => normalizarEspacos(typeof v === "string" ? v : "");
  const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const dataVisita = aDefinir ? null : texto(d.dataVisita) || null;
  // Fim igual ao início = um dia só (null) — o mesmo período não fica com
  // duas grafias.
  const fim = aDefinir ? null : texto(d.dataFim) || null;
  return {
    tipo: d.tipo === "execucao" ? "execucao" : "inspecao",
    aDefinir,
    dataVisita,
    dataFim: fim && fim !== dataVisita ? fim : null,
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
  /** Código do procedimento da OS. */
  procedimento: string | null;
  /** false = OS sem inspeção (sem agendamento/relatório de inspeção). */
  comInspecao: boolean;
}

function paraRef(a: any): AgendamentoRef {
  const p = a.inspecao?.projeto;
  return {
    id: a.id, inspecao_id: a.inspecao_id, tipo: a.tipo, data_visita: a.data_visita, data_fim: a.data_fim || null,
    data_execucao: a.data_execucao || null, a_definir: !!a.a_definir,
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
    // "*": com_inspecao sem quebrar antes da migração.
    .select("*, projeto:gp_projetos(id, codigo_projeto, pedido_compra, endereco, data_abertura, cliente:gp_orgaos(razao_social))")
    .eq("id", inspecaoId)
    .maybeSingle();
  if (!data) return null;
  const p: any = data.projeto;
  return {
    id: data.id, ident: data.identificacao || "OS",
    projetoId: p?.id || null, projLabel: p?.codigo_projeto || p?.pedido_compra || "",
    endereco: p?.endereco || "", clienteNome: p?.cliente?.razao_social || "", dataAbertura: p?.data_abertura || null,
    procedimento: (data as any).procedimento || null,
    comInspecao: (data as any).com_inspecao !== false,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Contexto do banco para validar um agendamento desta OS na data (ou no
 *  período, para a execução) dada. */
export async function contextoAgendamento(opts: {
  inspecaoId: string;
  dataVisita?: string | null;
  /** Execução de vários dias: último dia. */
  dataFim?: string | null;
  original?: { id: string; data_visita: string | null; data_fim?: string | null } | null;
}): Promise<{ ctx: ContextoAgendamento; info: InfoOS | null }> {
  const admin = getSupabaseAdmin();
  const inicio = opts.dataVisita && ISO.test(opts.dataVisita) ? opts.dataVisita : null;
  const fim = inicio && opts.dataFim && ISO.test(opts.dataFim) && opts.dataFim > inicio ? opts.dataFim : inicio;
  const [info, daOS, noDia, ativos, catalogo, relInsp] = await Promise.all([
    infoDaOS(opts.inspecaoId),
    admin.from("gp_agendamentos").select(CAMPOS_REF).eq("inspecao_id", opts.inspecaoId).is("substituido_em", null),
    // Outras OSs com algum dia em comum: começa até o fim E termina (data_fim,
    // ou o próprio dia) a partir do início.
    inicio && fim
      ? admin.from("gp_agendamentos").select(CAMPOS_REF).is("substituido_em", null).neq("inspecao_id", opts.inspecaoId)
        .lte("data_visita", fim).or(`data_fim.gte.${inicio},and(data_fim.is.null,data_visita.gte.${inicio})`)
      : Promise.resolve({ data: [] as any[] }),
    admin.from("gp_profiles").select("id, funcao").eq("ativo", true),
    admin.from("gp_equipamentos").select("*"),
    admin.from("gp_relatorios").select("versao, status").eq("inspecao_id", opts.inspecaoId).eq("tipo", "inspecao").is("excluido_em", null),
  ]);
  const equipCatalogo = (catalogo.data || []) as any[];
  let equipamentosProcedimento: string[] | undefined;
  if (info?.procedimento) {
    const { data: proc } = await admin.from("gp_procedimentos").select("equipamentos").eq("codigo", info.procedimento).limit(1).maybeSingle();
    equipamentosProcedimento = nomesEquipamentosProcedimento((proc as any)?.equipamentos, equipCatalogo.filter((e: any) => e.ativo !== false));
  } else if (info) {
    equipamentosProcedimento = [];
  }
  const ctx: ContextoAgendamento = {
    hoje: hojeBrasil(),
    inspecaoId: opts.inspecaoId,
    dataAbertura: info?.dataAbertura || null,
    local: info ? { projetoId: info.projetoId, endereco: info.endereco || null } : undefined,
    original: opts.original || null,
    daOS: (daOS.data || []).map(paraRef),
    noDia: (noDia.data || []).filter((a: any) => !daLixeira(a)).map(paraRef),
    usuariosAtivos: (ativos.data || []).map((u: any) => u.id),
    // Sugestões ("seria …?"): só equipamentos ativos no Catálogo.
    catalogo: equipCatalogo.filter((e: any) => e.ativo !== false).map((e: any) => e.nome).filter(Boolean),
    funcoes: Object.fromEntries((ativos.data || []).map((u: any) => [u.id, u.funcao || null])),
    // OS sem inspeção: o relatório de inspeção não é cobrado na execução.
    relatoriosInspecao: info && !info.comInspecao ? []
      : relInsp.error ? undefined : (relInsp.data || []).map((r: any) => ({ versao: r.versao, status: r.status })),
    equipamentosProcedimento,
    procedimento: info?.procedimento || null,
  };
  return { ctx, info };
}

function fmtData(iso?: string | null) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

const rotuloTipo = (tipo: string) => (tipo === "execucao" ? "Execução" : "Inspeção");

/** "05/11/2026" ou "05/11 a 07/11/2026" (execução de vários dias). */
export function quandoAgendamento(a: { data_visita: string | null; data_fim?: string | null } | null | undefined): string {
  return textoPeriodoLongo(periodoDe(a)) || fmtData(a?.data_visita);
}

/** Visita com data: avisa a equipe (in-app + push + e-mail com .ics, Gerência/
 *  Comercial em cópia). `remarcadoDe` = agendamento anterior → texto de
 *  remarcação (com o período, se era de vários dias). */
export async function notificarEquipe(opts: {
  ag: any;
  info: InfoOS;
  autorId: string;
  remarcadoDe?: { data_visita: string | null; data_fim?: string | null } | null;
}): Promise<Record<string, unknown>> {
  const { ag, info } = opts;
  const equipe: MembroEquipe[] = (ag.equipe || []).filter((m: any) => m && m.id);
  if (equipe.length === 0) return { destinatarios: 0, ignorado: true, motivo: "nenhum usuário na equipe" };

  const admin = getSupabaseAdmin();
  const tipoLabel = rotuloTipo(ag.tipo);
  const quando = `${quandoAgendamento(ag)}${ag.hora ? " às " + ag.hora : ""}`;
  const anterior = opts.remarcadoDe?.data_visita ? quandoAgendamento(opts.remarcadoDe) : null;
  const proj = info.projLabel ? ` (${info.projLabel})` : "";
  const titulo = anterior
    ? `${tipoLabel} remarcada — ${info.ident}${proj}`
    : `${tipoLabel} agendada — ${info.ident}${proj}`;
  const mensagem = anterior
    ? `${tipoLabel} da OS ${info.ident}${proj} remarcada de ${anterior} para ${quando}.`
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
    remarcadoDe: anterior || undefined,
  });
  const ics = gerarIcsAgendamento({
    uid: `${ag.id}@asp-plataforma`,
    titulo, descricao: mensagem,
    local: info.endereco || info.projLabel || undefined,
    data: ag.data_visita, dataFim: ag.data_fim || null, hora: ag.hora,
    // No SMTP (Gmail) o From efetivo pode ter sido trocado para o SMTP_USER.
    organizador: provedorEmail(process.env) === "smtp"
      ? separarRemetente(remetenteEmail(process.env).from).email || undefined
      : process.env.EMAIL_REMETENTE?.match(/<(.+)>/)?.[1],
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

/** Remarcação, passo 1: tira de cena os agendamentos que o novo vai
 *  substituir ANTES de gravá-lo — com uma execução ativa por OS (índice
 *  único), gravar primeiro seria barrado. Devolve os ids que ESTA chamada
 *  tirou (um envio simultâneo pode ter tirado antes: aí o índice barra o
 *  segundo insert, e só desfazemos o que nós mesmos tiramos). */
export async function tirarDeCena(supabase: any, ids: string[]): Promise<{ ids: string[]; erro: string | null }> {
  if (ids.length === 0) return { ids: [], erro: null };
  const agora = new Date().toISOString();
  const { data, error } = await supabase.from("gp_agendamentos")
    .update({ substituido_em: agora, atualizado_em: agora })
    .in("id", ids).is("substituido_em", null).select("id");
  return { ids: (data || []).map((x: any) => x.id), erro: error ? error.message : null };
}

/** O novo não foi gravado: os que tiramos voltam a valer. */
export async function voltarACena(supabase: any, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabase.from("gp_agendamentos")
    .update({ substituido_em: null, atualizado_em: new Date().toISOString() })
    .in("id", ids).is("substituido_por", null);
}

/** Remarcação, passo 3: liga os tirados de cena ao novo (histórico). */
export async function ligarSubstituidos(supabase: any, ids: string[], novoId: string): Promise<string | null> {
  if (ids.length === 0) return null;
  const { error } = await supabase.from("gp_agendamentos").update({ substituido_por: novoId }).in("id", ids);
  return error ? error.message : null;
}

/** Erro do insert/update → resposta: o índice de uma execução ativa por OS
 *  vira 409 com texto claro. */
export function erroGravacao(error: { code?: string; message: string }): { erro: string; status: number } {
  if (error.code === "23505" && /execucao_ativa/.test(error.message)) {
    return { erro: "Já há outra execução ativa desta OS (gravada agora há pouco?). Recarregue a página e remarque a existente.", status: 409 };
  }
  return { erro: error.message, status: 500 };
}
