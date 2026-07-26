import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarEmail } from "@/lib/email";
import { emailAgendamentoHtml } from "@/lib/email-templates";
import { gerarIcsAgendamento } from "@/lib/ics";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://asp-plataform.vercel.app";

export const runtime = "nodejs";

const PERFIS_AGENDA = ["admin", "comercial", "gerencia"];

interface MembroEquipe { id: string; nome: string }
interface NovoAgendamentoBody {
  inspecaoId: string;
  tipo?: "inspecao" | "execucao";
  dataVisita?: string;
  hora?: string;
  equipe?: MembroEquipe[];
  equipamentos?: string[];
  checklist?: { item: string; ok?: boolean }[];
}

function fmtData(iso?: string) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

/** Lista agendamentos (para o calendário do Dashboard). Filtro opcional por
 * inspeção via ?inspecaoId=. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const inspecaoId = req.nextUrl.searchParams.get("inspecaoId");
  const supabase = getSupabaseRouteClient();
  let query = supabase
    .from("gp_agendamentos")
    .select("id, tipo, data_visita, hora, equipe, equipamentos, checklist, criado_em, inspecao:gp_inspecoes(id, identificacao, projeto:gp_projetos(id, codigo_projeto, pedido_compra))")
    .order("data_visita", { ascending: true });
  if (inspecaoId) query = query.eq("inspecao_id", inspecaoId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, agendamentos: data || [] });
}

/** Cria um agendamento e notifica a equipe designada (in-app + e-mail). */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_AGENDA.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Agendamento é responsabilidade do Comercial." }, { status: 403 });
  }

  const body = (await req.json()) as NovoAgendamentoBody;
  if (!body.inspecaoId) {
    return NextResponse.json({ erro: "Inspeção obrigatória." }, { status: 400 });
  }
  if (!body.dataVisita) {
    return NextResponse.json({ erro: "Informe a data da visita." }, { status: 400 });
  }
  const tipo = body.tipo === "execucao" ? "execucao" : "inspecao";
  const equipe = (body.equipe || []).filter((m) => m && m.id);

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_agendamentos")
    .insert({
      inspecao_id: body.inspecaoId,
      tipo,
      data_visita: body.dataVisita,
      hora: body.hora?.trim() || null,
      equipe,
      equipamentos: body.equipamentos ?? [],
      checklist: body.checklist ?? [],
      criado_por: profile.id,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // Notifica os envolvidos (equipe designada) — in-app + e-mail (se configurado).
  if (equipe.length > 0) {
    const admin = getSupabaseAdmin();
    const { data: insp } = await admin
      .from("gp_inspecoes")
      .select("identificacao, projeto:gp_projetos(codigo_projeto, pedido_compra, endereco, cliente:gp_orgaos(razao_social))")
      .eq("id", body.inspecaoId)
      .single();
    const ident = insp?.identificacao || "Inspeção";
    const projeto: any = insp?.projeto;
    const projLabel = projeto?.codigo_projeto || projeto?.pedido_compra || "";
    const endereco = projeto?.endereco || "";
    const clienteNome = projeto?.cliente?.razao_social || "";
    const tipoLabel = tipo === "execucao" ? "Execução" : "Inspeção";
    const quando = `${fmtData(body.dataVisita)}${body.hora ? " às " + body.hora : ""}`;
    const titulo = `${tipoLabel} agendada — ${ident}${projLabel ? ` (${projLabel})` : ""}`;
    const mensagem = `${tipoLabel} de ${ident}${projLabel ? ` (${projLabel})` : ""} agendada para ${quando}.`;
    const link = `/inspecoes/${body.inspecaoId}`;

    await admin.from("gp_notificacoes").insert(
      equipe.map((m) => ({
        usuario_id: m.id, tipo: "agendamento", titulo, mensagem, link,
        inspecao_id: body.inspecaoId, criado_por: profile.id,
      }))
    );

    // Destinatários: equipe (para) + Gerência/Comercial em cópia.
    const { data: eqPerfis } = await admin.from("gp_profiles").select("email").in("id", equipe.map((m) => m.id));
    const paraEmails = (eqPerfis || []).map((p: any) => p.email).filter(Boolean);
    const { data: gestores } = await admin.from("gp_profiles").select("email").in("perfil", ["gerencia", "comercial"]).eq("ativo", true);
    const ccEmails = (gestores || []).map((p: any) => p.email).filter(Boolean);

    const html = emailAgendamentoHtml({
      tipoLabel, ident, cliente: clienteNome, projeto: projLabel, endereco, quando,
      equipe: equipe.map((m) => m.nome),
      equipamentos: body.equipamentos || [],
      checklist: body.checklist || [],
      link: `${APP_URL}${link}`,
    });
    const ics = gerarIcsAgendamento({
      uid: `${data.id}@asp-plataforma`,
      titulo, descricao: mensagem,
      local: endereco || projLabel || undefined,
      data: body.dataVisita, hora: body.hora,
      organizador: process.env.EMAIL_REMETENTE?.match(/<(.+)>/)?.[1],
      participantes: paraEmails,
    });
    const resultadoEmail = await enviarEmail(
      paraEmails, titulo, html,
      [{ filename: "inspecao.ics", content: ics, contentType: "text/calendar" }],
      { cc: ccEmails }
    );
    return NextResponse.json({ ok: true, agendamento: data, email: { destinatarios: paraEmails.length, ...resultadoEmail } });
  }

  return NextResponse.json({ ok: true, agendamento: data, email: { destinatarios: 0, ignorado: true, motivo: "nenhum usuário na equipe" } });
}
