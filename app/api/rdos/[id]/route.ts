import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { dataIsoValida } from "@/lib/asp/rdo";
import { CAMPOS_RDO, PERFIS_RDO, MSG_DIA_DUPLICADO, bloqueiosDoRdo, erroDasInspecoes, erroDeDuplicidade, erroDosDados } from "@/lib/asp/rdo-api";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const { data, error } = await getSupabaseRouteClient()
    .from("gp_rdos").select(CAMPOS_RDO).eq("id", params.id).is("excluido_em", null).maybeSingle();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ erro: "RDO não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true, rdo: data });
}

/** PATCH: { dados?, data?, inspecoes? } ou { restaurar: true } (lixeira).
 *  Qualquer mudança atualiza `atualizado_em` — o arquivo gerado antes passa
 *  a contar como desatualizado até ser gerado de novo. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_RDO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "RDO é responsabilidade de Operações." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const supabase = getSupabaseRouteClient();
  const { data: atual } = await supabase.from("gp_rdos")
    .select("id, projeto_id, excluido_em, data, inspecoes, dados").eq("id", params.id).maybeSingle();
  if (!atual) return NextResponse.json({ erro: "RDO não encontrado." }, { status: 404 });

  const mudanca: Record<string, unknown> = {};
  if (b?.restaurar) {
    mudanca.excluido_em = null;
    mudanca.excluido_por = null;
  } else if (atual.excluido_em) {
    return NextResponse.json({ erro: "RDO está na lixeira." }, { status: 404 });
  }
  if (b?.dados !== undefined) {
    const erroDados = erroDosDados(b.dados);
    if (erroDados) return NextResponse.json({ erro: erroDados }, { status: 400 });
    mudanca.dados = b.dados;
  }
  if (b?.data !== undefined) {
    if (!dataIsoValida(b.data)) return NextResponse.json({ erro: "Data inválida." }, { status: 400 });
    mudanca.data = b.data;
  }
  if (b?.inspecoes !== undefined) {
    const erroInsp = await erroDasInspecoes(supabase, atual.projeto_id, b.inspecoes);
    if (erroInsp) return NextResponse.json({ erro: erroInsp }, { status: 400 });
    mudanca.inspecoes = Array.from(new Set(b.inspecoes as string[]));
  }
  if (Object.keys(mudanca).length === 0) return NextResponse.json({ erro: "Nada para alterar." }, { status: 400 });

  // Fase 7: o RDO como fica depois da mudança não pode ter dado duplicado,
  // ambíguo ou impossível (só restaurar da lixeira não revalida).
  if (b?.dados !== undefined || b?.data !== undefined || b?.inspecoes !== undefined) {
    const bloq = bloqueiosDoRdo(
      mudanca.dados ?? atual.dados, String(mudanca.data ?? atual.data),
      (mudanca.inspecoes ?? atual.inspecoes ?? []) as string[],
    );
    if (bloq) return NextResponse.json(bloq, { status: 400 });
  }

  const { data, error } = await supabase.from("gp_rdos")
    .update({ ...mudanca, atualizado_em: new Date().toISOString() })
    .eq("id", params.id).select(CAMPOS_RDO).single();
  if (erroDeDuplicidade(error)) return NextResponse.json({ erro: MSG_DIA_DUPLICADO }, { status: 409 });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rdo: data });
}

/** Exclusão — lixeira (recuperável por 30 dias; o arquivo fica no storage). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  if (!PERFIS_RDO.includes(profile.perfil)) {
    return NextResponse.json({ erro: "RDO é responsabilidade de Operações." }, { status: 403 });
  }
  const { error } = await getSupabaseRouteClient().from("gp_rdos")
    .update({ excluido_em: new Date().toISOString(), excluido_por: profile.id })
    .eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lixeira: true });
}
