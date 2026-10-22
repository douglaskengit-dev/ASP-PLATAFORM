/** Lado servidor da validação do projeto (Fase 1): lê do banco o contexto
 *  que lib/validacao/projeto.ts precisa. Usado por POST/PATCH de
 *  /api/projetos e por /api/projetos/verificar — a mesma regra nas três.
 *  Lê com a chave de serviço para enxergar também a lixeira (um código
 *  nunca volta a ser usado). Não é rota: só funções. */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ULTIMA_FASE } from "@/lib/asp/fases";
import {
  anoDoCodigo, codigoRepetido, ContatoRef, ContextoProjeto, DadosProjeto, hojeBrasil,
  iniciaisDoNome, normalizarCodigoProjeto, ProjetoRef, ResultadoValidacao, validarProjeto,
} from "@/lib/validacao";

export const PERFIS_ESCRITA = ["admin", "comercial", "gerencia"];

const CAMPOS_REF = "id, codigo_projeto, pedido_compra, endereco, cliente_id, excluido_em, cliente:gp_orgaos(razao_social), inspecoes:gp_inspecoes(fase, excluido_em)";

function paraRef(p: any): ProjetoRef {
  return {
    id: p.id,
    codigo_projeto: p.codigo_projeto,
    pedido_compra: p.pedido_compra,
    endereco: p.endereco,
    cliente_id: p.cliente_id,
    cliente_nome: p.cliente?.razao_social || null,
    excluido: !!p.excluido_em,
    em_aberto: (p.inspecoes || []).some((i: any) => !i.excluido_em && i.fase < ULTIMA_FASE),
  };
}

/** Padrão ILIKE que casa o código com espaços em qualquer lugar e qualquer
 *  caixa ("37/MG/26" → "3%7%/%M%G%/%2%6"). Filtro grosso; o fino (igualdade
 *  normalizada) é feito em JS. */
function padraoCodigo(normalizado: string): string {
  return normalizado.split("").map((c) => c.replace(/[\\%_]/g, (x) => "\\" + x)).join("%");
}

/** Iniciais do usuário (gp_profiles.nome_completo; sem nome, o e-mail). */
export function iniciaisDoPerfil(p: { nome_completo?: string | null; email?: string | null } | null): string {
  return iniciaisDoNome(p?.nome_completo) || iniciaisDoNome((p?.email || "").split("@")[0].replace(/[._-]+/g, " "));
}

/** Códigos já usados no ano de `dataAbertura` (todos os usuários, lixeira inclusa). */
export async function codigosDoAno(dataAbertura: string): Promise<string[]> {
  const { data } = await getSupabaseAdmin()
    .from("gp_projetos")
    .select("codigo_projeto")
    .ilike("codigo_projeto", `%/%${anoDoCodigo(dataAbertura).split("").join("%")}%`);
  return (data || []).map((p: any) => p.codigo_projeto).filter(Boolean);
}

/** Contexto do banco para validar um projeto. `criadoPor` = autor do projeto
 *  (na edição); na criação, quem está abrindo. */
export async function contextoDoBanco(opts: {
  codigo?: string | null;
  clienteId?: string | null;
  excluirId?: string | null;
  iniciaisCriador?: string;
  /** Na edição, o cliente atual pode ser mantido mesmo se foi para a lixeira. */
  clienteAtual?: string | null;
}): Promise<ContextoProjeto> {
  const admin = getSupabaseAdmin();
  const ctx: ContextoProjeto = { hoje: hojeBrasil(), excluirId: opts.excluirId || null, iniciaisCriador: opts.iniciaisCriador };

  const codigo = normalizarCodigoProjeto(opts.codigo);
  if (codigo) {
    const { data } = await admin.from("gp_projetos").select(CAMPOS_REF).ilike("codigo_projeto", padraoCodigo(codigo));
    ctx.projetosCodigo = (data || []).map(paraRef);
  }

  if (opts.clienteId) {
    const [{ data: cli }, { data: projs }, { data: contatos }] = await Promise.all([
      admin.from("gp_orgaos").select("id, excluido_em").eq("id", opts.clienteId).maybeSingle(),
      admin.from("gp_projetos").select(CAMPOS_REF).eq("cliente_id", opts.clienteId).is("excluido_em", null),
      admin.from("gp_orgaos_contatos").select("id, nome_completo").eq("orgao_id", opts.clienteId),
    ]);
    ctx.clienteValido = !!cli && (!cli.excluido_em || opts.clienteAtual === opts.clienteId);
    ctx.projetosCliente = (projs || []).map(paraRef);
    ctx.contatos = (contatos || []) as ContatoRef[];
  }
  return ctx;
}

/** Valida no servidor. Devolve o resultado e, se o código repetiu, o projeto
 *  que já o usa (para a resposta 409 mostrar qual é). */
export async function validarProjetoNoServidor(
  dados: DadosProjeto,
  opts: { excluirId?: string | null; iniciaisCriador?: string; clienteAtual?: string | null }
): Promise<{ resultado: ResultadoValidacao; conflito: ProjetoRef | null }> {
  const ctx = await contextoDoBanco({ codigo: dados.codigoProjeto, clienteId: dados.clienteId, ...opts });
  return { resultado: validarProjeto(dados, ctx), conflito: codigoRepetido(dados.codigoProjeto, ctx) };
}
