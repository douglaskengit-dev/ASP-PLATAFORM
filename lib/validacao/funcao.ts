/** Funções do usuário (gp_funcoes) e permissões por função. Puro (sem
 * React/Supabase): roda na tela (Administração de usuários → Funções /
 * Permissões por função) e na API (app/api/admin/funcoes) — a API repete as
 * mesmas checagens.
 *
 *   ⛔ nome obrigatório, até 60 caracteres, único sem diferença de caixa,
 *      acento ou espaço ("Técnico" = "tecnico")
 *   ⛔ nome no RDO obrigatório (sugestão: "<nome> de operações")
 *   ⛔ excluir só função sem nenhum usuário (senão: desativar)
 *   ⛔ atribuir a um usuário só função cadastrada e ativa (quem já tem uma
 *      função desativada continua com ela)
 *   ⚠️ renomear atualiza os usuários que têm a função ("N usuários serão
 *      atualizados"); RDOs já gerados mantêm o cargo antigo.
 *
 * As permissões que dependem só do perfil (Admin/Gerência/Comercial) ficam
 * em lib/asp/permissoes.ts — a função só ACRESCENTA direitos. */
import { addAviso, addErro, novoResultado, type ResultadoValidacao } from "./resultado";
import { normalizarEspacos, normalizarTexto } from "./texto";

export const PERMISSOES_FUNCAO = [
  {
    chave: "pode_aprovar_medicao",
    rotulo: "Aprovar medição na coleta",
    ajuda: "Valida a medição que vale para o relatório (Fase 3), mesmo sendo de outra área.",
    perfisSempre: "Administrador e Gerência",
  },
  {
    chave: "pode_excluir_projetos",
    rotulo: "Excluir projetos/OS (lixeira)",
    ajuda: "Exclui e restaura projetos, OSs, clientes e contatos; esvazia a lixeira.",
    perfisSempre: "Administrador, Gerência e Comercial",
  },
  {
    chave: "pode_editar_revisao",
    rotulo: "Editar revisão/código do relatório",
    ajuda: "Corrige à mão a revisão (RevN) e o código do relatório, que o sistema calcula sozinho.",
    perfisSempre: "Administrador e Gerência",
  },
  {
    chave: "pode_registrar_medicao",
    rotulo: "Registrar medições / batimetria",
    ajuda: "Na coleta da OS: Nova medição, Digitar e Importar batimetria, Anexar PDF; edita a medição e escolhe data e responsável ao salvar. Não aprova nem exclui.",
    perfisSempre: "Administrador, Gerência e Operações",
  },
  {
    chave: "pode_registrar_fotos",
    rotulo: "Registrar coleta de fotos",
    ajuda: "Na coleta de fotos da execução: envia, troca e remove fotos, preenche pH/cloro e marca água antes/depois e limpeza confirmada.",
    perfisSempre: "Administrador, Gerência e Operações",
  },
  {
    chave: "pode_preparar_rdo",
    rotulo: "Preparar RDO",
    ajuda: "Cria e edita o RDO do dia e gera o arquivo .docx. Não exclui RDO.",
    perfisSempre: "Administrador, Gerência e Operações",
  },
  {
    chave: "lideranca_equipe",
    rotulo: "Conta como liderança da equipe (aviso da execução)",
    ajuda: "Sem ninguém com esta marca na equipe da execução, o agendamento avisa “equipe sem liderança”.",
    perfisSempre: null,
  },
] as const;

export type ChavePermissaoFuncao = (typeof PERMISSOES_FUNCAO)[number]["chave"];
export const CHAVES_PERMISSAO_FUNCAO: ChavePermissaoFuncao[] = PERMISSOES_FUNCAO.map((p) => p.chave);

export type PermissoesFuncao = Record<ChavePermissaoFuncao, boolean>;

export interface FuncaoRef extends PermissoesFuncao {
  id?: string;
  nome: string;
  nome_rdo: string | null;
  ordem: number;
  ativo: boolean;
  /** Versão (concorrência). */
  updated_at?: string | null;
}

export const NOME_FUNCAO_MAX = 60;

export const ROTULOS_FUNCAO: Record<string, string> = {
  nome: "Nome",
  nome_rdo: "Nome no RDO",
  excluir: "Excluir",
  ativo: "Ativo",
};

export function semPermissoes(): PermissoesFuncao {
  return {
    pode_aprovar_medicao: false, pode_excluir_projetos: false, pode_editar_revisao: false,
    pode_registrar_medicao: false, pode_registrar_fotos: false, pode_preparar_rdo: false,
    lideranca_equipe: false,
  };
}

/** Carga inicial da migração 20261105100000 — usada só se a tabela ainda não
 * existe no banco (código publicado antes de rodar a migração): mantém o
 * comportamento de antes (Coordenador = aprovar/excluir/revisão/liderança;
 * Engenheiro = liderança). As marcas de registro em campo (medição, fotos,
 * RDO — migração 20261106100000) ficam desligadas aqui: sem a migração o
 * banco (RLS) também não as reconhece. */
export const FUNCOES_PADRAO: FuncaoRef[] = [
  { nome: "Coordenador", nome_rdo: "Coordenador de operações", ordem: 1, ativo: true,
    ...semPermissoes(), pode_aprovar_medicao: true, pode_excluir_projetos: true, pode_editar_revisao: true, lideranca_equipe: true },
  { nome: "Engenheiro", nome_rdo: "Engenheiro de operações", ordem: 2, ativo: true,
    ...semPermissoes(), lideranca_equipe: true },
  { nome: "Técnico", nome_rdo: "Técnico de operações", ordem: 3, ativo: true, ...semPermissoes() },
  { nome: "Auxiliar", nome_rdo: "Auxiliar de operações", ordem: 4, ativo: true, ...semPermissoes() },
  { nome: "Supervisor", nome_rdo: "Supervisor de operações", ordem: 5, ativo: true, ...semPermissoes() },
];

/** Chave de comparação (= gp_chave_nome do banco): sem acento, minúscula,
 * espaços colapsados. */
export function chaveFuncao(nome: string | null | undefined): string {
  return normalizarTexto(nome);
}

export function nomeRdoPadrao(nome: string | null | undefined): string {
  const n = normalizarEspacos(nome);
  return n ? `${n} de operações` : "";
}

/** Ativas primeiro, depois pela ordem e pelo nome. */
export function ordenarFuncoes<T extends Pick<FuncaoRef, "ativo" | "ordem" | "nome">>(lista: T[]): T[] {
  return [...lista].sort((a, b) =>
    Number(b.ativo) - Number(a.ativo) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A função pelo nome gravado no usuário (exato; senão pela chave). */
export function encontrarFuncao<T extends Pick<FuncaoRef, "nome">>(nome: string | null | undefined, catalogo: T[] | null | undefined): T | null {
  if (!nome || !catalogo) return null;
  const exata = catalogo.find((f) => f.nome === nome);
  if (exata) return exata;
  const k = chaveFuncao(nome);
  return k ? catalogo.find((f) => chaveFuncao(f.nome) === k) || null : null;
}

/** Permissões que a função dá (função inexistente = nenhuma). Função
 * desativada continua valendo para quem já a tem. */
export function permissoesDaFuncao(nome: string | null | undefined, catalogo: FuncaoRef[] | null | undefined): PermissoesFuncao {
  const f = encontrarFuncao(nome, catalogo);
  const p = semPermissoes();
  if (f) for (const k of CHAVES_PERMISSAO_FUNCAO) p[k] = !!f[k];
  return p;
}

/** Quantos usuários têm a função (ativos e inativos — a FK conta todos). */
export function usuariosComFuncao(nome: string, usuarios: { funcao?: string | null }[]): number {
  return usuarios.filter((u) => (u.funcao || null) === nome).length;
}

export function textoUsuarios(n: number): string {
  return `${n} usuário${n === 1 ? "" : "s"}`;
}

export interface DadosFuncao {
  nome?: string | null;
  nome_rdo?: string | null;
}

export interface ContextoFuncao {
  funcoes: Pick<FuncaoRef, "nome" | "id">[];
  modo: "criar" | "editar";
  /** Função editada (fica fora da comparação de nome). */
  id?: string | null;
  nomeAnterior?: string | null;
  /** Usuários com a função hoje (aviso do renomear). */
  usuariosNaFuncao?: number;
}

/** Valida criar/editar uma função. Em "editar", só os campos presentes. */
export function validarFuncao(d: DadosFuncao, ctx: ContextoFuncao): ResultadoValidacao {
  const r = novoResultado();
  const criar = ctx.modo === "criar";
  const presente = (k: keyof DadosFuncao) => criar || d[k] !== undefined;

  if (presente("nome")) {
    const nome = normalizarEspacos(d.nome);
    if (!nome) addErro(r, "nome", "Informe o nome da função.");
    else if (nome.length > NOME_FUNCAO_MAX) addErro(r, "nome", `Use até ${NOME_FUNCAO_MAX} caracteres.`);
    else {
      const k = chaveFuncao(nome);
      const outra = ctx.funcoes.find((f) => f.id !== ctx.id && chaveFuncao(f.nome) === k);
      if (outra) addErro(r, "nome", `Já existe a função “${outra.nome}”.`);
      const antes = normalizarEspacos(ctx.nomeAnterior);
      if (!criar && antes && antes !== nome && !outra) {
        const n = ctx.usuariosNaFuncao || 0;
        if (n > 0) addAviso(r, "nome", `${textoUsuarios(n)} ${n === 1 ? "será atualizado" : "serão atualizados"} para “${nome}”.`);
        addAviso(r, "nome", "RDOs e relatórios já gerados mantêm o cargo antigo.");
      }
    }
  }

  if (presente("nome_rdo")) {
    const rdo = normalizarEspacos(d.nome_rdo);
    if (!rdo) addErro(r, "nome_rdo", "Informe o nome no RDO (ex.: “Técnico de operações”).");
    else if (rdo.length > 80) addErro(r, "nome_rdo", "Use até 80 caracteres.");
  }
  return r;
}

/** Excluir × desativar: só exclui sem nenhum usuário. */
export function checarExcluirFuncao(f: Pick<FuncaoRef, "nome">, usuarios: { funcao?: string | null }[]): string | null {
  const n = usuariosComFuncao(f.nome, usuarios);
  if (n === 0) return null;
  return `A função “${f.nome}” está em uso por ${textoUsuarios(n)} — desative-a (some da lista para novos cadastros, mas continua com quem já tem).`;
}

/** Função atribuída a um usuário: precisa existir e estar ativa — exceto se
 * é a que ele já tem (função desativada continua com quem já tem). */
export function checarFuncaoUsuario(
  funcao: string | null | undefined,
  catalogo: Pick<FuncaoRef, "nome" | "ativo">[],
  funcaoAtual?: string | null
): string | null {
  if (!funcao) return null;
  if (funcaoAtual && funcao === funcaoAtual) return null;
  const f = catalogo.find((x) => x.nome === funcao);
  if (!f) return "Função inválida — escolha uma das funções cadastradas.";
  if (!f.ativo) return `A função “${f.nome}” está desativada — escolha outra.`;
  return null;
}
