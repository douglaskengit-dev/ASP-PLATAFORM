import { NextRequest, NextResponse } from "next/server";
import { getProfileAtual, getSupabaseRouteClient } from "@/lib/supabase/route";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ehUuid } from "@/lib/asp/coleta-api";
import { ehViolacaoUnica } from "@/lib/asp/os-validacao-api";
import { PERFIS_EDICAO_CATALOGO } from "@/lib/asp/catalogo-api";
import {
  atualizarVigente, CAMPOS_UNIDADE, carregarCalibracao, faltaMigracaoCalibracao, MSG_MIGRACAO_CALIBRACAO,
  removerCertificadoSemUso,
} from "@/lib/asp/calibracao-api";
import { BUCKET } from "@/lib/processos/arquivos";
import {
  caminhoCertificadoValido, hojeBrasil, normalizarCalibracao, normalizarEspacos, primeiroErro, ROTULOS_CALIBRACAO,
  temErros, validarCalibracao, validarUnidade, type CalibracaoDados, type ResultadoValidacao,
} from "@/lib/validacao";

export const runtime = "nodejs";

/** Calibração dos equipamentos (regras em lib/validacao/calibracao.ts).
 *
 *  GET                         equipamentos com a marcação ou com unidade +
 *                              todas as unidades (calibração vigente)
 *  GET ?historico=<unidadeId>  calibrações registradas da unidade
 *  POST  { acao: "unidade", equipamentoId, identificacao, observacao?, calibracao? }
 *        { acao: "calibracao", unidadeId, calibrado_em, validade_meses | vence_em, certificado?, laboratorio?, certificado_path? }
 *  PATCH { acao: "exige", equipamentoId, exige }
 *        { acao: "unidade", id, identificacao?, observacao?, ativo? }
 *  DELETE ?unidadeId=… | ?calibracaoId=…  (registro errado: a vigente volta
 *        a ser a anterior) */
export async function GET(req: NextRequest) {
  const profile = await getProfileAtual();
  if (!profile) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = getSupabaseRouteClient();
  const historico = req.nextUrl.searchParams.get("historico");
  if (historico) {
    if (!ehUuid(historico)) return NextResponse.json({ erro: "Unidade inválida." }, { status: 400 });
    const { data, error } = await supabase.from("gp_calibracoes")
      .select("id, unidade_id, calibrado_em, vence_em, validade_meses, certificado, laboratorio, certificado_path, registrado_em, registrado_por, autor:gp_profiles(nome_completo)")
      .eq("unidade_id", historico).order("calibrado_em", { ascending: false }).order("registrado_em", { ascending: false });
    if (error) return NextResponse.json({ erro: faltaMigracaoCalibracao(error) ? MSG_MIGRACAO_CALIBRACAO : error.message }, { status: 500 });
    return NextResponse.json({ ok: true, calibracoes: data || [] });
  }
  const r = await carregarCalibracao(supabase);
  return NextResponse.json({
    ok: !r.erro, ...(r.erro ? { erro: r.erro } : {}),
    hoje: hojeBrasil(),
    podeEditar: PERFIS_EDICAO_CATALOGO.includes(profile.perfil),
    equipamentos: r.equipamentos, unidades: r.unidades,
  });
}

async function exigirEditor() {
  const profile = await getProfileAtual();
  if (!profile) return { erro: NextResponse.json({ erro: "Sessão expirada." }, { status: 401 }) };
  if (!PERFIS_EDICAO_CATALOGO.includes(profile.perfil)) {
    return { erro: NextResponse.json({ erro: "Sem permissão para editar calibrações." }, { status: 403 }) };
  }
  return { profile };
}

const respErros = (r: ResultadoValidacao) =>
  NextResponse.json({ erro: primeiroErro(r, ROTULOS_CALIBRACAO), erros: r.erros, avisos: r.avisos }, { status: 400 });

const erroBanco = (e: { code?: string; message?: string }) =>
  NextResponse.json({ erro: faltaMigracaoCalibracao(e) ? MSG_MIGRACAO_CALIBRACAO : e.message }, { status: 500 });

/** Calibração do corpo, validada e com o PDF conferido no storage. */
async function prepararCalibracao(bruto: any): Promise<{ dados?: ReturnType<typeof normalizarCalibracao>; avisos?: any; resp?: NextResponse }> {
  const d: CalibracaoDados = {
    calibrado_em: typeof bruto?.calibrado_em === "string" ? bruto.calibrado_em : "",
    vence_em: typeof bruto?.vence_em === "string" ? bruto.vence_em : "",
    validade_meses: bruto?.validade_meses === "" || bruto?.validade_meses == null ? null : Number(bruto.validade_meses),
    certificado: typeof bruto?.certificado === "string" ? bruto.certificado : "",
    laboratorio: typeof bruto?.laboratorio === "string" ? bruto.laboratorio : "",
    certificado_path: typeof bruto?.certificado_path === "string" && bruto.certificado_path ? bruto.certificado_path : null,
  };
  const r = validarCalibracao(d, hojeBrasil());
  if (temErros(r)) return { resp: respErros(r) };
  if (d.certificado_path) {
    if (!caminhoCertificadoValido(d.certificado_path)) return { resp: NextResponse.json({ erro: "Certificado inválido — envie o PDF de novo." }, { status: 400 }) };
    const pasta = d.certificado_path.split("/")[0];
    const nome = d.certificado_path.split("/")[1];
    const { data } = await getSupabaseAdmin().storage.from(BUCKET).list(pasta, { search: nome, limit: 1 });
    if (!(data || []).some((f) => f.name === nome)) {
      return { resp: NextResponse.json({ erro: "O PDF do certificado não chegou ao storage — envie de novo." }, { status: 400 }) };
    }
  }
  return { dados: normalizarCalibracao(d), avisos: r.avisos };
}

async function registrarCalibracao(unidadeId: string, dados: ReturnType<typeof normalizarCalibracao>, usuarioId: string) {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("gp_calibracoes").insert({ unidade_id: unidadeId, ...dados, registrado_por: usuarioId });
  if (error) return { error };
  return atualizarVigente(admin, unidadeId, usuarioId);
}

export async function POST(req: NextRequest) {
  const { erro, profile } = await exigirEditor();
  if (erro) return erro;
  const b = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  if (b?.acao === "unidade") {
    if (!ehUuid(b.equipamentoId)) return NextResponse.json({ erro: "Equipamento inválido." }, { status: 400 });
    const { data: eq } = await admin.from("gp_equipamentos").select("id, ativo").eq("id", b.equipamentoId).maybeSingle();
    if (!eq) return NextResponse.json({ erro: "Equipamento não encontrado — recarregue." }, { status: 404 });
    const { data: outras, error: eOutras } = await admin.from("gp_equipamento_unidades")
      .select("id, identificacao").eq("equipamento_id", b.equipamentoId);
    if (eOutras) return erroBanco(eOutras);
    const identificacao = normalizarEspacos(b.identificacao);
    const r = validarUnidade({ identificacao }, (outras || []) as any);
    if (temErros(r)) return respErros(r);
    let cal: Awaited<ReturnType<typeof prepararCalibracao>> | null = null;
    if (b.calibracao && (b.calibracao.calibrado_em || b.calibracao.vence_em || b.calibracao.validade_meses)) {
      cal = await prepararCalibracao(b.calibracao);
      if (cal.resp) return cal.resp;
    }
    const { data: un, error } = await admin.from("gp_equipamento_unidades").insert({
      equipamento_id: b.equipamentoId, identificacao,
      observacao: normalizarEspacos(b.observacao) || null, atualizado_por: profile!.id,
    }).select(CAMPOS_UNIDADE).single();
    if (ehViolacaoUnica(error)) return NextResponse.json({ erro: `Já existe a unidade “${identificacao}” neste equipamento.` }, { status: 409 });
    if (error) return erroBanco(error);
    let unidade: any = un;
    if (cal?.dados) {
      const reg = await registrarCalibracao(un.id, cal.dados, profile!.id);
      if (reg.error) return erroBanco(reg.error);
      unidade = (reg as any).data;
    }
    return NextResponse.json({ ok: true, unidade, avisos: cal?.avisos || {} });
  }

  if (b?.acao === "calibracao") {
    if (!ehUuid(b.unidadeId)) return NextResponse.json({ erro: "Unidade inválida." }, { status: 400 });
    const { data: un } = await admin.from("gp_equipamento_unidades").select("id").eq("id", b.unidadeId).maybeSingle();
    if (!un) return NextResponse.json({ erro: "Unidade não encontrada — recarregue." }, { status: 404 });
    const cal = await prepararCalibracao(b);
    if (cal.resp) return cal.resp;
    const reg = await registrarCalibracao(b.unidadeId, cal.dados!, profile!.id);
    if (reg.error) return erroBanco(reg.error);
    return NextResponse.json({ ok: true, unidade: (reg as any).data, avisos: cal.avisos });
  }

  return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  const { erro, profile } = await exigirEditor();
  if (erro) return erro;
  const b = await req.json().catch(() => ({}));
  const admin = getSupabaseAdmin();

  if (b?.acao === "exige") {
    if (!ehUuid(b.equipamentoId) || typeof b.exige !== "boolean") return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
    // Não mexe em atualizado_em: não gera conflito com quem está com a ficha
    // do equipamento aberta no Catálogo.
    const { data, error } = await admin.from("gp_equipamentos").update({ exige_calibracao: b.exige })
      .eq("id", b.equipamentoId).select("id, exige_calibracao").maybeSingle();
    if (error) return erroBanco(error);
    if (!data) return NextResponse.json({ erro: "Equipamento não encontrado — recarregue." }, { status: 404 });
    return NextResponse.json({ ok: true, equipamento: data });
  }

  if (b?.acao === "unidade") {
    if (!ehUuid(b.id)) return NextResponse.json({ erro: "Unidade inválida." }, { status: 400 });
    const { data: atual } = await admin.from("gp_equipamento_unidades").select("id, equipamento_id, identificacao").eq("id", b.id).maybeSingle();
    if (!atual) return NextResponse.json({ erro: "Unidade não encontrada — recarregue." }, { status: 404 });
    const muda: Record<string, unknown> = {};
    if (typeof b.identificacao === "string") {
      const identificacao = normalizarEspacos(b.identificacao);
      const { data: outras } = await admin.from("gp_equipamento_unidades").select("id, identificacao").eq("equipamento_id", atual.equipamento_id);
      const r = validarUnidade({ id: atual.id, identificacao }, (outras || []) as any);
      if (temErros(r)) return respErros(r);
      muda.identificacao = identificacao;
    }
    if (typeof b.observacao === "string") muda.observacao = normalizarEspacos(b.observacao) || null;
    if (typeof b.ativo === "boolean") muda.ativo = b.ativo;
    if (!Object.keys(muda).length) return NextResponse.json({ erro: "Nada para alterar." }, { status: 400 });
    const { data, error } = await admin.from("gp_equipamento_unidades")
      .update({ ...muda, atualizado_em: new Date().toISOString(), atualizado_por: profile!.id })
      .eq("id", b.id).select(CAMPOS_UNIDADE).single();
    if (ehViolacaoUnica(error)) return NextResponse.json({ erro: "Já existe uma unidade com esta identificação neste equipamento." }, { status: 409 });
    if (error) return erroBanco(error);
    return NextResponse.json({ ok: true, unidade: data });
  }

  return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { erro, profile } = await exigirEditor();
  if (erro) return erro;
  const admin = getSupabaseAdmin();
  const unidadeId = req.nextUrl.searchParams.get("unidadeId");
  const calibracaoId = req.nextUrl.searchParams.get("calibracaoId");

  if (calibracaoId) {
    if (!ehUuid(calibracaoId)) return NextResponse.json({ erro: "Registro inválido." }, { status: 400 });
    const { data: c } = await admin.from("gp_calibracoes").select("id, unidade_id, certificado_path").eq("id", calibracaoId).maybeSingle();
    if (!c) return NextResponse.json({ ok: true });
    const { error } = await admin.from("gp_calibracoes").delete().eq("id", calibracaoId);
    if (error) return erroBanco(error);
    const vig = await atualizarVigente(admin, c.unidade_id, profile!.id);
    await removerCertificadoSemUso(c.certificado_path);
    return NextResponse.json({ ok: true, unidade: vig.data || null });
  }

  if (!ehUuid(unidadeId)) return NextResponse.json({ erro: "Unidade inválida." }, { status: 400 });
  const { data: cals } = await admin.from("gp_calibracoes").select("certificado_path").eq("unidade_id", unidadeId);
  const { error } = await admin.from("gp_equipamento_unidades").delete().eq("id", unidadeId);
  if (error) return erroBanco(error);
  for (const c of cals || []) await removerCertificadoSemUso((c as any).certificado_path);
  return NextResponse.json({ ok: true });
}
