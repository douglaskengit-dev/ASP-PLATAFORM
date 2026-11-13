/** Follow-up (CRM) — lado servidor. Não é rota.
 *
 *  · gerarLembretesProximaAcao(): passo IDEMPOTENTE que avisa o responsável
 *    quando a próxima ação de uma oportunidade aberta chega no dia (ou já
 *    passou). Sem cron: roda quando Comercial/Gerência/Admin abrem o app
 *    (notificações) ou o Follow-up. Um aviso por oportunidade e data: a chave
 *    única de gp_lembretes_proxima_acao decide quem notifica.
 *  · faltaMigracaoCrm(): erro de coluna/tabela ausente antes da migração
 *    20261114100000_asp_crm_followup (e 20261115100000_asp_crm_procedimento). */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { enviarPushParaUsuarios } from "@/lib/push/send";
import { hojeBrasil } from "@/lib/validacao";

export const TIPO_NOTIFICACAO_PROXIMA_ACAO = "proxima_acao";
export const MSG_MIGRACAO_CRM =
  "O Follow-up novo precisa da migração 20261114100000_asp_crm_followup no Supabase. Peça ao administrador para rodá-la.";

export function faltaMigracaoCrm(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "42P01" || e.code === "PGRST204" || e.code === "PGRST205"
    || /column .* does not exist|relation .* does not exist|could not find the .* column/i.test(e.message || "");
}

/** Título vinculado ao procedimento: confere que ele existe no Catálogo e
 *  usa o nome dele como título. Sem procedimento ("Outros"), vale o título
 *  digitado. Devolve o erro, se houver. */
export async function aplicarProcedimento(
  supabase: { from: (t: string) => any },
  colunas: Record<string, unknown>,
): Promise<string | null> {
  if (!colunas.procedimento_id) return null;
  const { data } = await supabase.from("gp_procedimentos").select("id, nome").eq("id", colunas.procedimento_id).maybeSingle();
  if (!data) return "Procedimento não encontrado no Catálogo.";
  colunas.titulo = data.nome;
  return null;
}

/** Falta só a coluna procedimento_id (migração 20261115100000 ainda não
 *  rodou): salva sem o vínculo. */
export function faltaColunaProcedimento(e: { code?: string; message?: string } | null | undefined): boolean {
  return faltaMigracaoCrm(e) && /procedimento_id/.test(e?.message || "");
}

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

let ultimaGeracao = 0;
const INTERVALO_MS = 5 * 60 * 1000;

export async function gerarLembretesProximaAcao(opts: { forcar?: boolean; hoje?: string } = {}): Promise<number> {
  const agora = Date.now();
  if (!opts.forcar && agora - ultimaGeracao < INTERVALO_MS) return 0;
  ultimaGeracao = agora;
  const hoje = opts.hoje || hojeBrasil();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("gp_processos")
    .select("id, titulo, proxima_acao, proxima_acao_em, responsavel_id, criado_por, orgao:gp_orgaos(razao_social)")
    .eq("resultado", "aberta").not("proxima_acao_em", "is", null).lte("proxima_acao_em", hoje);
  if (error) return 0;   // sem a migração: nada a lembrar
  let gerados = 0;
  for (const p of (data || []) as any[]) {
    const destino = p.responsavel_id || p.criado_por;
    if (!destino) continue;
    const { data: novo, error: e2 } = await admin.from("gp_lembretes_proxima_acao")
      .insert({ processo_id: p.id, data: p.proxima_acao_em }).select("id").maybeSingle();
    if (e2 || !novo) continue;   // já lembrado (23505)
    gerados++;
    const atrasada = p.proxima_acao_em < hoje;
    const titulo = `${atrasada ? "Próxima ação atrasada" : "Próxima ação para hoje"} — ${p.titulo}`;
    const mensagem = `${p.orgao?.razao_social ? `${p.orgao.razao_social}: ` : ""}${p.proxima_acao || "ação"} (${fmt(p.proxima_acao_em)}).`;
    const link = `/followup?processo=${p.id}`;
    await admin.from("gp_notificacoes").insert({ usuario_id: destino, tipo: TIPO_NOTIFICACAO_PROXIMA_ACAO, titulo, mensagem, link });
    try { await enviarPushParaUsuarios([destino], { titulo, mensagem, link }); } catch { /* push é complementar */ }
  }
  return gerados;
}

/** Linha do banco → objeto da API (campos do CRM com padrão antes da migração). */
export function processoParaApi(p: any, ehAdmin: boolean) {
  return {
    id: p.id,
    titulo: p.titulo,
    orgao: p.orgao,
    data: p.created_at,
    atualizado_em: p.updated_at,
    tr_nome: p.tr_nome || "",
    etapa: Number(p.etapa) || 0,
    documentos: p.documentos || {},
    arquivos: Object.keys(p.arquivos || {}),
    cadastro_tr_id: p.cadastro_tr_id,
    cadastro_tr_status: p.cadastro_tr?.status || null,
    proposta_aprovada: !!p.proposta_aprovada,
    historico_etapas: p.historico_etapas || [],
    subetapas: p.subetapas || {},
    resultado: p.resultado || "aberta",
    resultado_em: p.resultado_em || null,
    motivo_perda: p.motivo_perda || null,
    motivo_perda_detalhe: p.motivo_perda_detalhe || null,
    valor: p.valor == null ? null : Number(p.valor),
    origem: p.origem || null,
    responsavel_id: p.responsavel_id || null,
    contato_id: p.contato_id || null,
    previsao_fechamento: p.previsao_fechamento || null,
    proxima_acao: p.proxima_acao || null,
    proxima_acao_em: p.proxima_acao_em || null,
    procedimento_id: p.procedimento_id || null,
    migrado: p.resultado !== undefined,
    criado_por: ehAdmin
      ? { id: p.criador?.id ?? p.criado_por, nome: p.criador?.nome_completo || p.criador?.email || "—" }
      : null,
  };
}
