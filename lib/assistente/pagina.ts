/**
 * Página em que o usuário está ao perguntar: "esta OS", "aqui", "deste
 * projeto" passam a valer para ela. O nome é lido com o cliente da sessão
 * (RLS): sem acesso, não há contexto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoPagina = "os" | "projeto" | "cliente";
export interface PaginaAtual { tipo: TipoPagina; id: string; nome: string; link: string }

const ROTAS: Record<string, TipoPagina> = { inspecoes: "os", projetos: "projeto", orgaos: "cliente" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "/inspecoes/<uuid>" → { tipo: "os", id }; outras páginas → null. */
export function rotaDaPagina(caminho: unknown): { tipo: TipoPagina; id: string } | null {
  if (typeof caminho !== "string") return null;
  const [, rota, id, resto] = caminho.split("?")[0].split("/");
  return ROTAS[rota] && UUID.test(id || "") && !resto ? { tipo: ROTAS[rota], id } : null;
}

export async function carregarPagina(sb: SupabaseClient, caminho: unknown): Promise<PaginaAtual | null> {
  const rota = rotaDaPagina(caminho);
  if (!rota) return null;
  const { tipo, id } = rota;
  if (tipo === "os") {
    const { data } = await sb.from("gp_inspecoes").select("identificacao, projeto:gp_projetos(codigo_projeto)").eq("id", id).is("excluido_em", null).maybeSingle();
    const d = data as any;
    return d ? { tipo, id, nome: `${d.identificacao}${d.projeto?.codigo_projeto ? ` (projeto ${d.projeto.codigo_projeto})` : ""}`, link: `/inspecoes/${id}` } : null;
  }
  if (tipo === "projeto") {
    const { data } = await sb.from("gp_projetos").select("codigo_projeto").eq("id", id).is("excluido_em", null).maybeSingle();
    return data ? { tipo, id, nome: (data as any).codigo_projeto, link: `/projetos/${id}` } : null;
  }
  const { data } = await sb.from("gp_orgaos").select("razao_social").eq("id", id).is("excluido_em", null).maybeSingle();
  return data ? { tipo, id, nome: (data as any).razao_social, link: `/orgaos/${id}` } : null;
}

const COMO_CONSULTAR: Record<TipoPagina, (id: string) => string> = {
  os: (id) => `chame detalhar_os com os_id="${id}"`,
  projeto: (id) => `chame detalhar_projeto com projeto_id="${id}"`,
  cliente: () => "chame buscar_clientes com o nome dele (e buscar_projetos com o nome, para os projetos)",
};
const ROTULO: Record<TipoPagina, string> = { os: "da OS", projeto: "do projeto", cliente: "do cliente" };

/** Linha para o contexto da IA. */
export function contextoDaPagina(p: PaginaAtual): string {
  return `O usuário está agora na página ${ROTULO[p.tipo]} "${p.nome}". Quando ele disser "esta", "este", "aqui", "dela" ou não citar outro, a pergunta é sobre ela: ${COMO_CONSULTAR[p.tipo](p.id)}.`;
}

/** Pergunta que aponta para a página aberta ("o que falta aqui?"). */
export const apontaParaPagina = (pergunta: string) => /\b(aqui|nest[ae]s?|dest[ae]s?|nel[ae]|del[ae]|ess[ae]|est[ae])\b/i.test(pergunta);
