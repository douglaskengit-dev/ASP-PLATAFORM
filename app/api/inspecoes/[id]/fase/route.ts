import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { acoesDisponiveis, AcaoFase, ULTIMA_FASE } from "@/lib/asp/fases";

export const runtime = "nodejs";

interface AcaoBody {
  acao: AcaoFase;
  motivo?: string;
}

/**
 * Movimenta a fase da inspeção. Registra data de autenticação + autor no
 * histórico. Reprovação (fases 5/9) volta uma fase, exige motivo e marca o
 * relatório mais recente do bloco como "ajustar". Aprovação avança.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const body = (await req.json()) as AcaoBody;
  const supabase = getSupabaseRouteClient();

  const { data: inspecao, error: erroBusca } = await supabase
    .from("gp_inspecoes")
    .select("id, fase")
    .eq("id", params.id)
    .single();
  if (erroBusca || !inspecao) {
    return NextResponse.json({ erro: "Inspeção não encontrada." }, { status: 404 });
  }

  const faseAtual: number = inspecao.fase;
  const opcoes = acoesDisponiveis(profile.perfil, faseAtual);
  const opcao = opcoes.find((o) => o.acao === body.acao);
  if (!opcao) {
    return NextResponse.json({ erro: "Ação não permitida para o seu perfil nesta fase." }, { status: 403 });
  }
  if (opcao.exigeMotivo && !body.motivo?.trim()) {
    return NextResponse.json({ erro: "Informe o motivo do ajuste." }, { status: 400 });
  }

  const novaFase = Math.min(Math.max(opcao.destino, 2), ULTIMA_FASE);

  // Atualiza status do relatório do bloco quando aprovar/reprovar.
  if (body.acao === "aprovar" || body.acao === "reprovar") {
    const tipo = faseAtual <= 5 ? "inspecao" : "execucao";
    const novoStatus = body.acao === "aprovar" ? "aprovado" : "ajustar";
    await supabase
      .from("gp_relatorios")
      .update({
        status: novoStatus,
        motivo_ajuste: body.acao === "reprovar" ? body.motivo?.trim() : null,
        aprovado_por: body.acao === "aprovar" ? profile.id : null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("inspecao_id", params.id)
      .eq("tipo", tipo)
      .in("status", ["em_aprovacao"]);

    const colStatus = tipo === "inspecao" ? "status_relatorio_inspecao" : "status_relatorio_execucao";
    await supabase.from("gp_inspecoes").update({ [colStatus]: novoStatus }).eq("id", params.id);
  }

  const { error: erroUpdate } = await supabase
    .from("gp_inspecoes")
    .update({ fase: novaFase, atualizado_em: new Date().toISOString() })
    .eq("id", params.id);
  if (erroUpdate) return NextResponse.json({ erro: erroUpdate.message }, { status: 500 });

  await supabase.from("gp_fase_historico").insert({
    inspecao_id: params.id,
    fase_de: faseAtual,
    fase_para: novaFase,
    acao: body.acao,
    motivo: body.motivo?.trim() || null,
    autor: profile.id,
  });

  return NextResponse.json({ ok: true, fase: novaFase });
}
