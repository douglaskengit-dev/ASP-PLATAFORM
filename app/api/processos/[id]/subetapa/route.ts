import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { ETAPAS_FLUXO } from "@/lib/processos/etapas";
import {
  AcaoSubetapa,
  GrupoSubetapas,
  SubetapasProcesso,
  etapaTemSubetapas,
  nomeSubetapa,
  podeExecutarAcao,
  transicaoValida,
} from "@/lib/processos/subetapas";

export const runtime = "nodejs";

const ACOES: AcaoSubetapa[] = ["enviar", "revisar_aprovar", "revisar_reprovar", "aprovar"];

/** Avança a subetapa de revisão/aprovação do relatório — só vale enquanto o
 * processo está em "Relatório" ou "Relatório de Limpeza" (ETAPAS_FLUXO). Ao
 * aprovar (subetapa "aprovado"), o processo avança sozinho para a próxima
 * macrofase — é a única transição de etapa principal que acontece sem pedir
 * a data de autenticação manual (fica registrada como automática). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  const { acao, motivo } = (await req.json().catch(() => ({}))) as { acao?: AcaoSubetapa; motivo?: string };
  if (!acao || !ACOES.includes(acao)) {
    return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
  }
  if (!podeExecutarAcao(profile.perfil, acao)) {
    return NextResponse.json({ erro: "Você não tem permissão para esta ação." }, { status: 403 });
  }
  if (acao === "revisar_reprovar" && !motivo?.trim()) {
    return NextResponse.json({ erro: "Informe o motivo da reprovação." }, { status: 400 });
  }

  const supabase = getSupabaseRouteClient();
  const { data: processo, error: erroBusca } = await supabase
    .from("gp_processos")
    .select("etapa, subetapas, historico_etapas")
    .eq("id", params.id)
    .single();
  if (erroBusca || !processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const etapaAtual = processo.etapa as number;
  const nomeEtapaAtual = ETAPAS_FLUXO[etapaAtual]?.nome;
  if (!etapaTemSubetapas(nomeEtapaAtual)) {
    return NextResponse.json({ erro: "A fase atual deste processo não tem subetapas." }, { status: 400 });
  }

  const subetapas = (processo.subetapas || {}) as SubetapasProcesso;
  const chaveGrupo = String(etapaAtual);
  const grupo: GrupoSubetapas = subetapas[chaveGrupo] || { atual: null, historico: [] };

  const novoEstado = transicaoValida(grupo.atual, acao);
  if (!novoEstado) {
    return NextResponse.json(
      { erro: `Não é possível fazer essa ação a partir de "${nomeSubetapa(grupo.atual)}".` },
      { status: 400 }
    );
  }

  const responsavelNome = profile.nome_completo || profile.email || "—";
  const novoHistorico = [
    ...grupo.historico,
    {
      de: grupo.atual,
      para: novoEstado,
      responsavel_id: profile.id,
      responsavel_nome: responsavelNome,
      em: new Date().toISOString(),
      ...(motivo?.trim() ? { motivo: motivo.trim() } : {}),
    },
  ];

  const novasSubetapas: SubetapasProcesso = {
    ...subetapas,
    [chaveGrupo]: { atual: novoEstado, historico: novoHistorico },
  };

  const atualizacao: Record<string, unknown> = {
    subetapas: novasSubetapas,
    updated_at: new Date().toISOString(),
  };

  // Estado final do grupo: avança a macrofase sozinho.
  let etapaFinal = etapaAtual;
  if (novoEstado === "aprovado" && etapaAtual + 1 < ETAPAS_FLUXO.length) {
    etapaFinal = etapaAtual + 1;
    const historicoEtapas = Array.isArray(processo.historico_etapas) ? processo.historico_etapas : [];
    atualizacao.etapa = etapaFinal;
    atualizacao.historico_etapas = [
      ...historicoEtapas,
      {
        etapa: etapaFinal,
        nome: ETAPAS_FLUXO[etapaFinal].nome,
        data_autenticacao: new Date().toISOString().slice(0, 10),
        alterado_em: new Date().toISOString(),
        alterado_por: profile.id,
        automatico: true,
      },
    ];
  }

  const { error } = await supabase.from("gp_processos").update(atualizacao).eq("id", params.id);
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, subetapa: novoEstado, etapa: etapaFinal });
}
