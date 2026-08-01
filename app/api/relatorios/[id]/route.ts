import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";

export const runtime = "nodejs";

const PERFIS_ENVIO = ["admin", "operacoes", "gerencia"];

/** Envia um relatório em rascunho para aprovação: PATCH { enviar: true }.
 *  Separa a geração do documento (que só anexa o arquivo ao card) do ato de
 *  submetê-lo à Gerência, que é o que move a inspeção de fase. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!PERFIS_ENVIO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "Envio de relatório é responsabilidade de Operações." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body?.enviar) return NextResponse.json({ ok: true });

  const supabase = getSupabaseRouteClient();
  const { data: rel } = await supabase
    .from("gp_relatorios").select("id, tipo, status, inspecao_id").eq("id", params.id).single();
  if (!rel) return NextResponse.json({ erro: "Relatório não encontrado." }, { status: 404 });
  if (rel.status !== "rascunho") {
    return NextResponse.json({ erro: "Só rascunhos podem ser enviados para aprovação." }, { status: 400 });
  }

  const { error } = await supabase
    .from("gp_relatorios")
    .update({ status: "em_aprovacao", enviado_em: new Date().toISOString(), enviado_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const colStatus = rel.tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
  await supabase.from("gp_inspecoes").update({ [colStatus]: "em_aprovacao" }).eq("id", rel.inspecao_id);

  return NextResponse.json({ ok: true });
}
