/** Fase 10 — lado servidor do ENCERRAMENTO da OS. Não é rota: só funções.
 *
 *  · garantirOsAberta(ids): a trava de SOMENTE LEITURA. Toda rota que muda
 *    algo de uma OS (coletas, fotos, RDOs, relatórios, agendamentos,
 *    checklist, cadastro da OS, ações de fase, lixeira) chama antes de
 *    gravar; OS encerrada → 409 "OS encerrada em … por …". Um RDO que cobre
 *    várias OSs fica travado se QUALQUER uma estiver encerrada. Downloads e
 *    entregas ao cliente seguem liberados.
 *  · contextoEncerramento(id): lê do banco o que lib/validacao/encerramento
 *    precisa (pendências, última atividade, entregas) — a tela mostra o que
 *    vem daqui, e o POST de encerrar recalcula do mesmo jeito.
 *  · arquivosParaEntrega(id): os documentos finais da OS (relatórios
 *    assinados/aprovados, laudos, RDOs .docx, anexos de coleta).
 *  · recalcularConclusaoProjeto(projetoId): concluido_em do projeto quando a
 *    última OS ativa é encerrada; limpo ao reabrir/criar/restaurar OS.
 *
 *  Lê com a chave de serviço e `select("*")`: sem a migração da Fase 10 as
 *  colunas novas só não existem (OS conta como aberta) — nada quebra. */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { registroVazio, type RegistroFotosExecucao } from "@/lib/asp/fotos-execucao";
import { numeroRdo } from "@/lib/asp/rdo";
import {
  dataBrCompleta, execucaoAtiva, hojeBrasil, pendenciasEncerramento, periodoDe, procedimentoUsaLaudo, projetoConcluido,
  textoEncerrada, ultimaAtividade, type ArquivoEntrega, type PendenciaEncerramento,
} from "@/lib/validacao";

export interface EstadoOS {
  id: string;
  identificacao: string;
  projeto_id: string;
  fase: number;
  procedimento: string | null;
  excluido_em: string | null;
  encerrada_em: string | null;
  encerrada_por: string | null;
  encerramento_manual: boolean;
  encerramento_justificativa: string | null;
  encerramento_pendencias: string[] | null;
}

function paraEstado(o: any): EstadoOS {
  return {
    id: o.id, identificacao: o.identificacao, projeto_id: o.projeto_id, fase: Number(o.fase) || 2,
    procedimento: o.procedimento ?? null, excluido_em: o.excluido_em ?? null,
    encerrada_em: o.encerrada_em ?? null, encerrada_por: o.encerrada_por ?? null,
    encerramento_manual: !!o.encerramento_manual, encerramento_justificativa: o.encerramento_justificativa ?? null,
    encerramento_pendencias: Array.isArray(o.encerramento_pendencias) ? o.encerramento_pendencias : null,
  };
}

export async function lerOS(id: string): Promise<EstadoOS | null> {
  const { data } = await getSupabaseAdmin().from("gp_inspecoes").select("*").eq("id", id).maybeSingle();
  return data ? paraEstado(data) : null;
}

export async function nomeUsuario(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const { data } = await getSupabaseAdmin().from("gp_profiles").select("nome_completo, email").eq("id", id).maybeSingle();
  return (data as any)?.nome_completo || (data as any)?.email || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ⛔ Somente leitura: devolve a resposta 409 se alguma das OSs está
 *  encerrada, ou null (pode gravar). `rdo` muda a explicação: o RDO cobre
 *  várias OSs e trava se qualquer uma estiver encerrada. */
export async function garantirOsAberta(
  ids: string | (string | null | undefined)[] | null | undefined,
  opts: { rdo?: boolean } = {},
): Promise<NextResponse | null> {
  const lista = Array.from(new Set((Array.isArray(ids) ? ids : [ids]).filter((i): i is string => typeof i === "string" && UUID.test(i))));
  if (!lista.length) return null;
  const { data, error } = await getSupabaseAdmin().from("gp_inspecoes").select("*").in("id", lista);
  if (error || !data) return null;
  const fechada = (data as any[]).map(paraEstado).find((o) => !!o.encerrada_em);
  if (!fechada) return null;
  const quem = await nomeUsuario(fechada.encerrada_por);
  const base = textoEncerrada(fechada.encerrada_em, quem, fechada.encerramento_manual);
  const erro = opts.rdo
    ? `Este RDO cobre a OS “${fechada.identificacao}”, ${base.replace(/^OS /, "")} — um RDO que cobre uma OS encerrada não pode ser criado, alterado nem excluído. Reabra a OS (Admin/Gerência) para mexer nele.`
    : `${base} (“${fechada.identificacao}”) — está só para consulta. Para alterar, Admin/Gerência precisa reabrir a OS.`;
  return NextResponse.json({ erro, encerrada: true, inspecaoId: fechada.id }, { status: 409 });
}

/** OS de um registro filho (coleta, relatório, agendamento, checklist). */
export async function osDe(tabela: "gp_coletas" | "gp_relatorios" | "gp_agendamentos" | "gp_checklist_equipamentos", id: string | null | undefined): Promise<string | null> {
  if (!id || !UUID.test(id)) return null;
  const { data } = await getSupabaseAdmin().from(tabela).select("inspecao_id").eq("id", id).maybeSingle();
  return (data as any)?.inspecao_id || null;
}

/** OSs cobertas por um RDO. */
export async function osDoRdo(id: string | null | undefined): Promise<string[]> {
  if (!id || !UUID.test(id)) return [];
  const { data } = await getSupabaseAdmin().from("gp_rdos").select("inspecoes").eq("id", id).maybeSingle();
  return Array.isArray((data as any)?.inspecoes) ? (data as any).inspecoes : [];
}

// ── Contexto do encerramento ─────────────────────────────────────────────────

export interface ContextoServidor {
  os: EstadoOS;
  pendencias: PendenciaEncerramento[];
  ultima: { dia: string; origem: string } | null;
  entregas: number;
  hoje: string;
}

export async function contextoEncerramento(os: EstadoOS): Promise<ContextoServidor> {
  const admin = getSupabaseAdmin();
  const hoje = hojeBrasil();
  const [rels, proc, rdos, ags, fotos, coletas, entregas] = await Promise.all([
    admin.from("gp_relatorios").select("*").eq("inspecao_id", os.id).is("excluido_em", null),
    os.procedimento
      ? admin.from("gp_procedimentos").select("*").eq("codigo", os.procedimento).maybeSingle()
      : Promise.resolve({ data: null as any }),
    admin.from("gp_rdos").select("id, numero, data, arquivo_path, arquivo_em, atualizado_em")
      .contains("inspecoes", [os.id]).is("excluido_em", null),
    admin.from("gp_agendamentos").select("*").eq("inspecao_id", os.id),
    admin.from("gp_fotos_execucao").select("*").eq("inspecao_id", os.id).maybeSingle(),
    admin.from("gp_coletas").select("data_coleta, excluido_em").eq("inspecao_id", os.id).is("excluido_em", null),
    admin.from("gp_entregas").select("id").eq("inspecao_id", os.id).is("excluido_em", null),
  ]);
  const relatorios = ((rels.data || []) as any[]).map((r) => ({
    id: r.id, tipo: r.tipo, versao: Number(r.versao) || 0, status: r.status, dados: r.dados || null,
    avaliado_em: r.avaliado_em || null, assinado_em: r.assinado_em || null,
  }));
  const periodo = periodoDe(execucaoAtiva((ags.data || []) as any[]));
  const rdoLista = ((rdos.data || []) as any[]).map((r) => ({
    numero: r.numero, data: String(r.data).slice(0, 10), arquivo_path: r.arquivo_path, arquivo_em: r.arquivo_em, atualizado_em: r.atualizado_em,
  }));
  const coleta: RegistroFotosExecucao = (fotos.data as any) || registroVazio(!!(proc.data as any)?.agua_potavel);
  const pendencias = pendenciasEncerramento({
    relatorios, usaLaudo: procedimentoUsaLaudo(proc.data as any), rdos: rdoLista, periodo, hoje, coleta,
  });
  const ultima = ultimaAtividade({ rdos: rdoLista, relatorios, coletas: (coletas.data || []) as any[], periodo });
  return { os, pendencias, ultima, entregas: entregas.error ? -1 : (entregas.data || []).length, hoje };
}

// ── Documentos finais (entrega) ──────────────────────────────────────────────

const ROT: Record<string, string> = { inspecao: "inspeção", execucao: "execução" };

export async function arquivosParaEntrega(inspecaoId: string): Promise<(ArquivoEntrega & { href: string })[]> {
  const admin = getSupabaseAdmin();
  const [rels, rdos, coletas] = await Promise.all([
    admin.from("gp_relatorios").select("*").eq("inspecao_id", inspecaoId).is("excluido_em", null).order("versao", { ascending: false }),
    admin.from("gp_rdos").select("id, numero, data, arquivo_path, arquivo_em")
      .contains("inspecoes", [inspecaoId]).is("excluido_em", null).order("data", { ascending: true }),
    admin.from("gp_coletas").select("*").eq("inspecao_id", inspecaoId).is("excluido_em", null).order("criado_em", { ascending: true }),
  ]);
  const out: (ArquivoEntrega & { href: string })[] = [];
  for (const r of (rels.data || []) as any[]) {
    const tipo = ROT[r.tipo] || r.tipo;
    if (r.status === "assinado" && r.assinado_path) {
      out.push({ chave: `relatorio_assinado:${r.id}`, tipo: "relatorio_assinado", id: r.id, caminho: r.assinado_path,
        nome: `Relatório de ${tipo} v${r.versao} — assinado (PDF)`, hash: r.assinado_hash || null, data: r.assinado_em || r.avaliado_em || null,
        href: `/api/relatorios/${r.id}/download?arquivo=assinado` });
    } else if ((r.status === "aprovado" || r.status === "assinado") && r.arquivo_path) {
      out.push({ chave: `relatorio:${r.id}`, tipo: "relatorio", id: r.id, caminho: r.arquivo_path,
        nome: `Relatório de ${tipo} v${r.versao} — aprovado (sem assinatura)`, hash: r.arquivo_hash || null, data: r.avaliado_em || r.enviado_em || null,
        href: `/api/relatorios/${r.id}/download` });
    }
  }
  const laudos = new Set<string>();
  for (const r of (rels.data || []) as any[]) {
    const l = r.dados?.laudoPdf;
    if (r.tipo !== "execucao" || r.status === "substituido" || !l?.caminho || laudos.has(l.caminho)) continue;
    laudos.add(l.caminho);
    out.push({ chave: `laudo:${l.caminho}`, tipo: "laudo", id: r.id, caminho: l.caminho,
      nome: `Laudo do laboratório — ${l.nome || "PDF"}`, hash: l.hash || null, data: l.enviado_em || r.enviado_em || null,
      href: `/api/relatorios/${r.id}/download?arquivo=laudo` });
  }
  for (const r of (rdos.data || []) as any[]) {
    if (!r.arquivo_path) continue;
    out.push({ chave: `rdo:${r.id}`, tipo: "rdo", id: r.id, caminho: r.arquivo_path,
      nome: `RDO nº ${numeroRdo(r.numero)} — ${dataBrCompleta(String(r.data))} (.docx)`, hash: null, data: r.arquivo_em || r.data,
      href: `/api/rdos/${r.id}/download` });
  }
  for (const c of (coletas.data || []) as any[]) {
    if (!c.pdf_path) continue;
    out.push({ chave: `coleta:${c.id}`, tipo: "coleta", id: c.id, caminho: c.pdf_path,
      nome: c.tipo === "anexo" ? `Anexo — ${c.descricao || "PDF"}` : `Medição (${c.tipo || "sedimento"})${c.data_coleta ? ` de ${dataBrCompleta(c.data_coleta)}` : ""} — PDF`,
      hash: c.arquivo_hash || null, data: c.data_coleta || c.criado_em || null,
      href: `/api/coletas/${c.id}/download` });
  }
  return out;
}

// ── Conclusão do projeto ─────────────────────────────────────────────────────

/** Projeto concluído = todas as OSs ativas encerradas (automático). Reabrir,
 *  criar ou restaurar OS limpa. Sem a coluna (migração não rodada), nada. */
export async function recalcularConclusaoProjeto(projetoId: string | null | undefined): Promise<void> {
  if (!projetoId) return;
  const admin = getSupabaseAdmin();
  const [{ data: proj }, { data: oss }] = await Promise.all([
    admin.from("gp_projetos").select("*").eq("id", projetoId).maybeSingle(),
    admin.from("gp_inspecoes").select("*").eq("projeto_id", projetoId),
  ]);
  if (!proj || !("concluido_em" in (proj as any))) return;
  const concluido = projetoConcluido((oss || []) as any[]);
  if (concluido && !(proj as any).concluido_em) {
    await admin.from("gp_projetos").update({ concluido_em: new Date().toISOString(), concluido_automaticamente: true })
      .eq("id", projetoId).is("concluido_em", null);
  } else if (!concluido && (proj as any).concluido_em) {
    await admin.from("gp_projetos").update({ concluido_em: null, concluido_automaticamente: false }).eq("id", projetoId);
  }
}

/** Projeto de uma OS (para recalcular depois de mexer nela). */
export async function projetoDaOS(inspecaoId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin().from("gp_inspecoes").select("projeto_id").eq("id", inspecaoId).maybeSingle();
  return (data as any)?.projeto_id || null;
}
