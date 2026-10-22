import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRIMEIRA_FASE_INSPECAO } from "@/lib/asp/fases";
import { normalizarTanque } from "@/lib/asp/tanque";
import { ehViolacaoUnica, validarOSNoServidor } from "@/lib/asp/os-validacao-api";
import { normalizarEspacos, primeiroErro, ROTULOS_OS, temErros } from "@/lib/validacao";

export const runtime = "nodejs";

const DIAS_LIXEIRA = 30;

interface NovaInspecaoBody {
  projetoId: string;
  identificacao: string;
  ferramentaColeta?: string;
  /** Código do procedimento do Catálogo — define o formato do relatório. */
  procedimento?: string;
  /** Cadastro do tanque: dimensões, capacidade e material. Obrigatório — é
   *  o que alimenta a identificação do tanque em todo relatório da inspeção. */
  tanque?: unknown;
}

/** Lista inspeções de um projeto. ?lixeira=1 lista as excluídas. Limpeza
 * preguiçosa das que passaram de 30 dias. */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  const projetoId = req.nextUrl.searchParams.get("projetoId");
  const lixeira = req.nextUrl.searchParams.get("lixeira") === "1";
  if (!projetoId) return NextResponse.json({ erro: "projetoId é obrigatório." }, { status: 400 });

  const corte = new Date(Date.now() - DIAS_LIXEIRA * 86400000).toISOString();
  await getSupabaseAdmin().from("gp_inspecoes").delete().lt("excluido_em", corte);

  const supabase = getSupabaseRouteClient();
  let query = supabase.from("gp_inspecoes").select("*").eq("projeto_id", projetoId).order("criado_em", { ascending: true });
  query = lixeira ? query.not("excluido_em", "is", null) : query.is("excluido_em", null);
  const { data, error } = await query;
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inspecoes: data || [] });
}

/** Cria uma OS dentro de um projeto (ex.: "Tanque TQ-01"). Nasce na fase 2
 * (Agendamento). As regras de lib/validacao/ordemServico.ts são repetidas
 * aqui — a tela não é confiável: identificação única no projeto (409 com a
 * OS que já a usa), procedimento do Catálogo e tanque completo. */
export async function POST(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) {
    return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }
  if (!["admin", "comercial", "gerencia"].includes(profile.perfil)) {
    return NextResponse.json({ erro: "Sem permissão para criar Ordens de Serviço." }, { status: 403 });
  }

  const body = (await req.json()) as NovaInspecaoBody;
  if (!body.projetoId) {
    return NextResponse.json({ erro: "Projeto obrigatório." }, { status: 400 });
  }
  const identificacao = normalizarEspacos(body.identificacao);
  const dados = { identificacao, procedimento: body.procedimento?.trim() || "", tanque: body.tanque ?? null };
  const { resultado, conflito } = await validarOSNoServidor(dados, { projetoId: body.projetoId });
  if (temErros(resultado)) {
    return NextResponse.json(
      { erro: primeiroErro(resultado, ROTULOS_OS), erros: resultado.erros, avisos: resultado.avisos, conflito },
      { status: conflito ? 409 : 400 }
    );
  }

  const supabase = getSupabaseRouteClient();
  const { data, error } = await supabase
    .from("gp_inspecoes")
    .insert({
      projeto_id: body.projetoId,
      identificacao,
      fase: PRIMEIRA_FASE_INSPECAO,
      ferramenta_coleta: body.ferramentaColeta?.trim() || "sedimento",
      procedimento: dados.procedimento,
      tanque: normalizarTanque(body.tanque),
      criado_por: profile.id,
    })
    .select("*")
    .single();

  if (ehViolacaoUnica(error)) {
    return NextResponse.json({ erro: "Identificação: já usada por outra OS deste projeto." }, { status: 409 });
  }
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inspecao: data, avisos: resultado.avisos });
}
