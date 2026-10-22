/** Regras de servidor do RDO, comuns às rotas /api/rdos (não são rotas:
 *  o Next só aceita GET/POST/… exportados de um route.ts). */
import type { getSupabaseRouteClient } from "@/lib/supabase/route";

export const PERFIS_RDO = ["admin", "operacoes", "gerencia"];
export const CAMPOS_RDO = "id, projeto_id, data, numero, inspecoes, dados, arquivo_path, arquivo_em, criado_em, atualizado_em, autor:gp_profiles!criado_por(nome_completo)";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fase mínima das inspeções cobertas: o RDO nasce na Execução. */
const FASE_MINIMA = 6;

type Supa = ReturnType<typeof getSupabaseRouteClient>;

/** Confere que as inspeções existem, são do projeto e já chegaram à Execução.
 *  Devolve a mensagem de erro, ou null se está tudo certo. Vale também
 *  no PATCH (mesma regra ao trocar a cobertura). */
export async function erroDasInspecoes(supabase: Supa, projetoId: string, ids: unknown): Promise<string | null> {
  if (!Array.isArray(ids) || ids.length === 0) return "Marque ao menos uma OS coberta por este RDO.";
  if (!ids.every((i) => typeof i === "string" && UUID.test(i))) return "OS inválida.";
  const { data } = await supabase.from("gp_inspecoes")
    .select("id, projeto_id, fase, identificacao").in("id", ids as string[]).is("excluido_em", null);
  const achadas = data || [];
  if (achadas.length !== new Set(ids).size || achadas.some((i: any) => i.projeto_id !== projetoId)) {
    return "OS não encontrada neste projeto.";
  }
  const cedo = achadas.find((i: any) => i.fase < FASE_MINIMA);
  if (cedo) return `"${cedo.identificacao}" ainda não chegou à Execução — o RDO é do bloco de execução.`;
  return null;
}

/** Conflito de unicidade do dia → mensagem para a tela. */
export function erroDeDuplicidade(error: { code?: string; message?: string } | null): boolean {
  return !!error && error.code === "23505" && (error.message || "").includes("uq_gp_rdos_projeto_data");
}
export const MSG_DIA_DUPLICADO = "Já existe RDO para este dia neste projeto.";

/** dados: objeto jsonb de tamanho razoável (o formulário cabe com folga). */
export function erroDosDados(dados: unknown): string | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return "Dados do RDO inválidos.";
  if (JSON.stringify(dados).length > 200_000) return "RDO grande demais.";
  return null;
}

