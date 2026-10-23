/** Administração de usuários (gp_profiles): regras de cadastro/edição e
 * proteções de acesso. Puro (sem React/Supabase): roda na tela e na API
 * (app/api/admin/users) — a API repete as mesmas checagens.
 *
 *   ⛔ e-mail válido e único (sem diferença de caixa/espaço)
 *   ⛔ nome completo: nome + sobrenome (partículas não contam)
 *   ⛔ Área/Acesso da lista (perfis legados não se atribuem); Função só das
 *      cadastradas e ativas em gp_funcoes (lib/validacao/funcao.ts) — quem
 *      já tem uma função desativada continua com ela
 *   ⛔ senha (quando informada — ex.: modal "Redefinir senha") com pelo menos
 *      6 caracteres. Criar NÃO pede senha: o usuário recebe por e-mail o
 *      link "Criar minha senha" (lib/validacao/acesso.ts).
 *   ⛔ ninguém tira o próprio acesso de admin / se desativa / se exclui
 *   ⛔ o último administrador ativo não perde o acesso
 *   ⚠️ homônimo; iniciais (códigos de projeto) iguais às de outro ativo;
 *      renomear não muda documentos já gerados.
 *
 * Desativar alguém tira a pessoa das equipes dos agendamentos FUTUROS
 * (agendamentosFuturosDoUsuario / removerDaEquipe). */
import { addAviso, addErro, novoResultado, type ResultadoValidacao } from "./resultado";
import { normalizarEspacos, normalizarNome } from "./texto";
import { emailValido, normalizarEmail } from "./formatos";
import { iniciaisDoNome } from "./codigoProjeto";
import { periodoDe, textoPeriodo } from "./periodo";
import { checarFuncaoUsuario, type FuncaoRef } from "./funcao";

/** Perfis que o admin pode atribuir (a "Área" deriva deles). */
export const PERFIS_ATRIBUIVEIS = ["comercial", "operacoes", "gerencia", "admin"] as const;
/** Perfis antigos: ainda aceitos no banco, mas não se atribuem mais. */
export const PERFIS_LEGADO = ["editor", "visualizador"] as const;

export const SENHA_MINIMA = 6;

export const ROTULOS_USUARIO: Record<string, string> = {
  email: "E-mail",
  senha: "Senha",
  nomeCompleto: "Nome completo",
  perfil: "Área / Acesso",
  funcao: "Função",
  ativo: "Ativo",
};

export interface UsuarioRef {
  id: string;
  email: string;
  nome_completo: string | null;
  perfil: string;
  ativo: boolean;
}

/** Como o usuário aparece nas mensagens: nome (ou e-mail, se sem nome). */
export function nomeDoUsuario(u: Pick<UsuarioRef, "nome_completo" | "email"> | null | undefined): string {
  return normalizarEspacos(u?.nome_completo) || u?.email || "usuário";
}

/** Nome + sobrenome: ao menos 2 palavras com 2+ letras, sem contar
 * partículas (de/da/dos…). "Maria da Silva" ok; "Maria" e "Maria S." não. */
export function nomeCompletoValido(nome: string | null | undefined): boolean {
  const palavras = normalizarNome(nome).split(" ").filter((p) => p.replace(/[^a-z]/g, "").length >= 2);
  return palavras.length >= 2;
}

export function ehPerfilLegado(perfil: string | null | undefined): boolean {
  return (PERFIS_LEGADO as readonly string[]).includes(perfil || "");
}

export interface DadosUsuario {
  email?: string | null;
  senha?: string | null;
  nomeCompleto?: string | null;
  perfil?: string | null;
  funcao?: string | null;
}

export interface ContextoUsuario {
  /** Todos os usuários cadastrados (ativos e inativos). */
  usuarios: UsuarioRef[];
  /** "editar": só os campos presentes em `dados` são conferidos. */
  modo: "criar" | "editar";
  /** Usuário sendo editado (fica fora das comparações). */
  id?: string | null;
  /** Nome gravado antes da edição (aviso de renomear). */
  nomeAnterior?: string | null;
  /** Funções cadastradas (gp_funcoes). Sem a lista, a função não é
   * conferida aqui (a API sempre manda; o banco tem a FK). */
  funcoes?: Pick<FuncaoRef, "nome" | "ativo">[] | null;
  /** Função gravada antes da edição (desativada continua aceita). */
  funcaoAnterior?: string | null;
}

/** Outro usuário com o mesmo e-mail (sem diferença de caixa/espaço). */
export function usuarioComEmail(email: string | null | undefined, usuarios: UsuarioRef[], ignorarId?: string | null): UsuarioRef | null {
  const k = normalizarEmail(email);
  if (!k) return null;
  return usuarios.find((u) => u.id !== ignorarId && normalizarEmail(u.email) === k) || null;
}

/** Homônimos: mesmo nome depois de normalizar (acento, caixa, partículas). */
export function homonimos(nome: string | null | undefined, usuarios: UsuarioRef[], ignorarId?: string | null): UsuarioRef[] {
  const k = normalizarNome(nome);
  if (!k) return [];
  return usuarios.filter((u) => u.id !== ignorarId && normalizarNome(u.nome_completo) === k);
}

/** Usuários ATIVOS com as mesmas iniciais (as do código de projeto). */
export function mesmasIniciais(nome: string | null | undefined, usuarios: UsuarioRef[], ignorarId?: string | null): { iniciais: string; usuarios: UsuarioRef[] } {
  const ini = iniciaisDoNome(nome);
  if (ini.length < 2) return { iniciais: ini, usuarios: [] };
  return {
    iniciais: ini,
    usuarios: usuarios.filter((u) => u.id !== ignorarId && u.ativo && iniciaisDoNome(u.nome_completo) === ini),
  };
}

export function msgEmailDuplicado(outro: Pick<UsuarioRef, "nome_completo" | "email">): string {
  return `Já existe um usuário com este e-mail (${nomeDoUsuario(outro)}).`;
}

export const MSG_RENOMEAR = "Documentos já gerados (RDOs, relatórios) mantêm o nome antigo.";

/** Valida os dados do formulário (criar) ou os campos enviados (editar). */
export function validarUsuario(d: DadosUsuario, ctx: ContextoUsuario): ResultadoValidacao {
  const r = novoResultado();
  const criar = ctx.modo === "criar";
  const presente = (k: keyof DadosUsuario) => criar || d[k] !== undefined;

  if (presente("email")) {
    const email = normalizarEmail(d.email);
    if (!email) addErro(r, "email", "Informe o e-mail.");
    else if (!emailValido(email)) addErro(r, "email", "E-mail inválido (use o formato nome@dominio.com).");
    else {
      const outro = usuarioComEmail(email, ctx.usuarios, ctx.id);
      if (outro) addErro(r, "email", msgEmailDuplicado(outro));
    }
  }

  if (d.senha !== undefined && d.senha !== null) {
    const senha = typeof d.senha === "string" ? d.senha : "";
    if (!senha) addErro(r, "senha", "Informe a senha.");
    else if (senha.length < SENHA_MINIMA) addErro(r, "senha", `A senha deve ter ao menos ${SENHA_MINIMA} caracteres.`);
  }

  if (presente("nomeCompleto")) {
    const nome = normalizarEspacos(d.nomeCompleto);
    if (!nome) addErro(r, "nomeCompleto", "Informe o nome completo.");
    else if (!nomeCompletoValido(nome)) addErro(r, "nomeCompleto", "Informe nome e sobrenome (ex.: Maria Silva).");
    else {
      const homs = homonimos(nome, ctx.usuarios, ctx.id);
      homs.forEach((u) => addAviso(r, "nomeCompleto", `Já existe outro usuário com este nome: ${nomeDoUsuario(u)} (${u.email}).`));
      const ja = new Set(homs.map((u) => u.id));
      const { iniciais, usuarios } = mesmasIniciais(nome, ctx.usuarios, ctx.id);
      const outros = usuarios.filter((u) => !ja.has(u.id));
      if (outros.length) {
        addAviso(r, "nomeCompleto",
          `As iniciais ${iniciais} já são usadas por ${outros.map(nomeDoUsuario).join(", ")}; códigos de projeto ficarão ambíguos.`);
      }
      const antes = normalizarEspacos(ctx.nomeAnterior);
      if (!criar && antes && antes !== nome) addAviso(r, "nomeCompleto", MSG_RENOMEAR);
    }
  }

  if (presente("perfil")) {
    const p = d.perfil || "";
    if (!p) addErro(r, "perfil", "Escolha a Área / Acesso.");
    else if (ehPerfilLegado(p)) addErro(r, "perfil", "Perfis antigos (Editor/Visualizador) não podem mais ser atribuídos — escolha Comercial, Operações, Gerência ou Administrador.");
    else if (!(PERFIS_ATRIBUIVEIS as readonly string[]).includes(p)) addErro(r, "perfil", "Área / Acesso inválida.");
  }

  if (presente("funcao")) {
    const erro = ctx.funcoes ? checarFuncaoUsuario(d.funcao, ctx.funcoes, ctx.funcaoAnterior) : null;
    if (erro) addErro(r, "funcao", erro);
  }

  return r;
}

// ── Proteções de acesso (admin) ──────────────────────────────────────────────

export function ehAdminAtivo(u: Pick<UsuarioRef, "perfil" | "ativo"> | null | undefined): boolean {
  return !!u && u.perfil === "admin" && !!u.ativo;
}

export function contarAdminsAtivos(usuarios: Pick<UsuarioRef, "perfil" | "ativo">[]): number {
  return usuarios.filter(ehAdminAtivo).length;
}

export interface AlteracaoAcesso {
  perfil?: string;
  ativo?: boolean;
  excluir?: boolean;
}

/** A alteração tira do alvo o acesso de administrador ativo? */
export function perdeAdmin(alvo: Pick<UsuarioRef, "perfil" | "ativo">, alt: AlteracaoAcesso): boolean {
  if (!ehAdminAtivo(alvo)) return false;
  return !!alt.excluir || (alt.perfil !== undefined && alt.perfil !== "admin") || alt.ativo === false;
}

/** Bloqueio (⛔) de rebaixar/desativar/excluir a si mesmo ou o último admin
 * ativo. Devolve o campo e a mensagem, ou null se pode. */
export function checarAlteracaoAcesso(opts: {
  alvo: UsuarioRef;
  autorId: string;
  alteracao: AlteracaoAcesso;
  usuarios: UsuarioRef[];
}): { campo: "perfil" | "ativo" | "excluir"; erro: string } | null {
  const { alvo, alteracao: alt } = opts;
  const campo = alt.excluir ? "excluir" : alt.ativo === false && alvo.ativo ? "ativo" : "perfil";
  if (alvo.id === opts.autorId) {
    if (alt.excluir) return { campo, erro: "Você não pode excluir o próprio usuário." };
    if (alt.ativo === false) return { campo, erro: "Você não pode desativar o próprio usuário — peça a outro administrador." };
    if (alt.perfil !== undefined && alt.perfil !== alvo.perfil) {
      return { campo, erro: "Você não pode mudar o próprio acesso de administrador — peça a outro administrador." };
    }
  }
  if (perdeAdmin(alvo, alt)) {
    const outros = opts.usuarios.filter((u) => u.id !== alvo.id && ehAdminAtivo(u)).length;
    if (outros === 0) {
      return {
        campo,
        erro: `${nomeDoUsuario(alvo)} é o último administrador ativo — promova outro usuário a Administrador antes.`,
      };
    }
  }
  return null;
}

// ── Desativação × equipes dos agendamentos ───────────────────────────────────

export interface MembroRef {
  id: string;
  nome?: string;
}

export interface AgendamentoEquipe {
  id: string;
  tipo: string;
  data_visita: string | null;
  data_fim?: string | null;
  a_definir?: boolean | null;
  substituido_em?: string | null;
  equipe: MembroRef[] | null | undefined;
}

/** Agendamento ativo (não substituído) que ainda vai acontecer: data a
 * definir, sem data, visita de hoje em diante, ou execução cujo período
 * termina hoje ou depois. `hoje` = AAAA-MM-DD de Brasília. */
export function agendamentoFuturo(a: AgendamentoEquipe, hoje: string): boolean {
  if (a.substituido_em) return false;
  if (a.a_definir) return true;
  const p = periodoDe(a);
  if (!p) return true;
  return p.fim >= hoje;
}

/** Agendamentos futuros em que o usuário está na equipe. */
export function agendamentosFuturosDoUsuario<T extends AgendamentoEquipe>(lista: T[], usuarioId: string, hoje: string): T[] {
  return lista.filter((a) => agendamentoFuturo(a, hoje) && (a.equipe || []).some((m) => m && m.id === usuarioId));
}

/** Equipe sem o usuário; `vazia` = ninguém sobrou. */
export function removerDaEquipe<M extends MembroRef>(equipe: M[] | null | undefined, usuarioId: string): { equipe: M[]; removido: boolean; vazia: boolean } {
  const antes = (equipe || []).filter((m) => m && m.id);
  const depois = antes.filter((m) => m.id !== usuarioId);
  return { equipe: depois, removido: depois.length !== antes.length, vazia: depois.length === 0 };
}

/** "05/11", "05/11 a 07/11" ou "data a definir". */
export function quandoCurto(a: Pick<AgendamentoEquipe, "data_visita" | "data_fim" | "a_definir">): string {
  return textoPeriodo(periodoDe(a)) || "data a definir";
}

/** "em 05/11" / "com data a definir" — para as notificações. */
export function emQuando(a: Pick<AgendamentoEquipe, "data_visita" | "data_fim" | "a_definir">): string {
  const p = textoPeriodo(periodoDe(a));
  return p ? `em ${p}` : "com data a definir";
}
