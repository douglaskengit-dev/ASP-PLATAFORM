import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_AGENDA = ["admin", "comercial", "gerencia"];

interface NovoAgendamentoBody {
  inspecaoId: string;
  tipo?: "inspecao" | "execucao";
  dataVisita?: string;
  equipe?: string[];
  equipamentos?: string[];
  /** Itens extensíveis (jsonb): [{ item, ok }]. NR-33, NR-10, EPIs, PT... */
  checklist?: { item: string; ok?: boolean }[];
}

/** Cria um agendamento (fases 2 = inspeção, 6 = execução), Comercial.
 * Checklist é jsonb configurável — não colunas fixas (COWORK-ASP §2.3). */
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
  const tipo = body.tipo === "execucao" ? "execucao" : "inspecao";

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_agendamentos")
    .insert({
      inspecao_id: body.inspecaoId,
      tipo,
      data_visita: body.dataVisita || null,
      equipe: body.equipe ?? [],
      equipamentos: body.equipamentos ?? [],
      checklist: body.checklist ?? [],
      criado_por: profile.id,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, agendamento: data });
}
