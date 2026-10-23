/** Regras do cadastro de cliente (gp_orgaos) e dos seus contatos
 * (gp_orgaos_contatos). Puras — usadas no FormularioOrgao, no detalhe do
 * cliente, no modal de projeto e nas APIs de /api/orgaos.
 *
 *   Cliente  ⛔ razão social, cidade, UF · CNPJ com dígitos verificadores
 *              válidos e único (só dígitos, inclusive lixeira)
 *            ⚠️ razão social quase igual à de outro cliente · cidade escrita
 *              diferente de uma já cadastrada na mesma UF · endereço em
 *              branco · razão social renomeada (documentos ficam com a antiga)
 *   Contato  ⛔ nome, cargo, e-mail válido · nome/e-mail repetido no cliente
 *              (inclusive desativado — a mensagem sugere reativar)
 *            ⚠️ telefone fora do formato brasileiro (DDD + 8/9 dígitos)
 *   Excluir  ⛔ cliente com projeto em andamento · definitivo com qualquer
 *              projeto · restaurar com CNPJ/razão social já em cliente ativo
 *            ⚠️ cliente com projetos concluídos/na lixeira (confirmar)
 *   Contato em uso: renomear leva o nome novo aos projetos (confirmar);
 *   excluir só sem uso — senão Desativar. Aviso do cliente ≤ 500 caracteres. */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { cnpjValido, emailValido, normalizarCnpj, normalizarEmail, telefoneValido } from "./formatos";
import {
  duplicadosEmLista, nomesParecidos, normalizarEspacos, normalizarNome, normalizarRazaoSocial, normalizarTexto, semPontuacao,
} from "./texto";

export interface ClienteRef {
  id: string;
  razao_social: string;
  cnpj?: string | null;
  excluido?: boolean;
}

export interface DadosCliente {
  razaoSocial?: string | null;
  cnpj?: string | null;
  cidade?: string | null;
  uf?: string | null;
  /** undefined = a tela não tem o campo (não avisa). */
  endereco?: string | null;
}

export interface ContextoCliente {
  /** Cliente em edição — fora da checagem de duplicidade. */
  excluirId?: string | null;
  /** Clientes já cadastrados (inclusive lixeira). */
  clientes?: ClienteRef[];
  /** Cidades já cadastradas na MESMA UF (grafia como está no banco). */
  cidades?: string[];
  /** Razão social gravada (edição) — renomear avisa dos documentos. */
  razaoSocialAtual?: string | null;
}

export const ROTULOS_CLIENTE: Record<string, string> = {
  razaoSocial: "Razão social",
  cnpj: "CNPJ",
  cidade: "Cidade",
  uf: "UF",
  endereco: "Endereço",
  avisos: "Aviso do cliente",
  "contatos.*": "Contato",
};

function descreverCliente(c: ClienteRef): string {
  return `${c.razao_social}${c.excluido ? " (na lixeira)" : ""}`;
}

/** Cliente com o mesmo CNPJ (comparando só dígitos), ou null. */
export function cnpjRepetido(cnpj: string | null | undefined, ctx: ContextoCliente): ClienteRef | null {
  const d = normalizarCnpj(cnpj);
  if (!d) return null;
  return (ctx.clientes || []).find((c) => c.id !== ctx.excluirId && normalizarCnpj(c.cnpj) === d) || null;
}

/** Clientes com razão social quase igual (ignora acento, pontuação, LTDA/S.A./ME…). */
export function clientesParecidos(razao: string | null | undefined, ctx: ContextoCliente): ClienteRef[] {
  return (ctx.clientes || []).filter(
    (c) => c.id !== ctx.excluirId && nomesParecidos(razao, c.razao_social, normalizarRazaoSocial)
  );
}

export function validarCliente(d: DadosCliente, ctx: ContextoCliente = {}): ResultadoValidacao {
  const r = novoResultado();
  if (!d.razaoSocial?.trim()) addErro(r, "razaoSocial", "Informe a razão social.");
  else clientesParecidos(d.razaoSocial, ctx).forEach((c) =>
    addAviso(r, "razaoSocial", `Parecida com o cliente já cadastrado “${descreverCliente(c)}”.`)
  );

  if (!d.cnpj?.trim()) addErro(r, "cnpj", "Informe o CNPJ.");
  else if (!cnpjValido(d.cnpj)) addErro(r, "cnpj", "CNPJ inválido — confira os dígitos.");
  else {
    const rep = cnpjRepetido(d.cnpj, ctx);
    if (rep) addErro(r, "cnpj", `CNPJ já cadastrado para “${descreverCliente(rep)}”.`);
  }

  if (!d.cidade?.trim()) addErro(r, "cidade", "Informe a cidade.");
  else if (d.uf?.trim()) cidadesParecidas(d.cidade, ctx.cidades).forEach((c) =>
    addAviso(r, "cidade", `Já existe “${c}” em ${d.uf!.trim().toUpperCase()} — é a mesma cidade? Use a grafia já cadastrada.`)
  );
  if (!d.uf?.trim()) addErro(r, "uf", "Escolha a UF.");

  if (d.endereco !== undefined && !normalizarEspacos(d.endereco)) {
    addAviso(r, "endereco", "Endereço em branco — ele é sugerido como endereço da obra nos projetos deste cliente.");
  }
  if (ctx.razaoSocialAtual && d.razaoSocial?.trim() && normalizarEspacos(d.razaoSocial) !== normalizarEspacos(ctx.razaoSocialAtual)) {
    addAviso(r, "razaoSocial", `Documentos já gerados (relatórios, RDOs) mantêm o nome antigo “${normalizarEspacos(ctx.razaoSocialAtual)}”.`);
  }
  return r;
}

// ── Cidade ───────────────────────────────────────────────────────────────────

/** Partículas que ficam minúsculas no nome da cidade (exceto na 1ª palavra). */
const PARTICULAS_CIDADE = new Set(["de", "da", "do", "das", "dos", "e"]);

function maiusculaInicial(p: string): string {
  return p ? p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1) : p;
}

/** Cidade como se grava: trim, espaços colapsados, Iniciais Maiúsculas com
 * de/da/do/das/dos/e minúsculas (menos na 1ª palavra). Acento fica como foi
 * digitado. "  são   JOSÉ DOS campos " → "São José dos Campos";
 * "embu-guaçu" → "Embu-Guaçu"; "santa bárbara d'oeste" → "Santa Bárbara d'Oeste". */
export function normalizarCidade(s: string | null | undefined): string {
  return normalizarEspacos(s)
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .filter(Boolean)
    .map((palavra, i) => {
      if (i > 0 && PARTICULAS_CIDADE.has(palavra)) return palavra;
      return palavra.split("-").map((parte, j) => {
        if (j > 0 && PARTICULAS_CIDADE.has(parte)) return parte;
        const ap = /^d['’](.+)$/.exec(parte);
        if (ap) return `${i > 0 || j > 0 ? "d" : "D"}'${maiusculaInicial(ap[1])}`;
        return maiusculaInicial(parte);
      }).join("-");
    })
    .join(" ");
}

/** Chave da cidade para comparar: sem acento, caixa, espaço extra ou pontuação. */
export function chaveCidade(s: string | null | undefined): string {
  return semPontuacao(normalizarTexto(s));
}

/** Cidades já cadastradas (mesma UF) que parecem a digitada mas estão
 * escritas diferente — "Sao Jose dos Campos" × "São José dos Campos".
 * A grafia idêntica (depois de normalizar) não conta. */
export function cidadesParecidas(cidade: string | null | undefined, existentes: string[] = []): string[] {
  const nova = normalizarCidade(cidade);
  const k = chaveCidade(nova);
  if (!k) return [];
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const e of existentes) {
    const grafia = normalizarEspacos(e);
    if (!grafia || grafia === nova || vistas.has(grafia)) continue;
    if (chaveCidade(grafia) === k || nomesParecidos(nova, grafia, chaveCidade)) {
      vistas.add(grafia);
      out.push(grafia);
    }
  }
  return out;
}

// ── Aviso do cliente ─────────────────────────────────────────────────────────

export const AVISO_CLIENTE_MAX = 500;

/** Aviso que aparece em todas as OSs do cliente: até 500 caracteres. */
export function validarAvisoCliente(texto: string | null | undefined): ResultadoValidacao {
  const r = novoResultado();
  const n = (texto || "").trim().length;
  if (n > AVISO_CLIENTE_MAX) {
    addErro(r, "avisos", `O aviso tem ${n} caracteres — o limite é ${AVISO_CLIENTE_MAX}. Resuma o texto.`);
  }
  return r;
}

// ── Excluir / restaurar cliente ──────────────────────────────────────────────

/** Projeto do cliente, no formato das regras de exclusão. */
export interface ProjetoDoCliente {
  id: string;
  codigo: string | null;
  /** Na lixeira. */
  excluido: boolean;
  /** Concluído (concluido_em preenchido). */
  concluido: boolean;
}

function rotuloProjeto(p: { codigo: string | null }): string {
  return p.codigo?.trim() || "projeto sem código";
}

function listarProjetos(ps: { codigo: string | null }[], max = 8): string {
  const nomes = ps.slice(0, max).map(rotuloProjeto);
  return nomes.join(", ") + (ps.length > max ? ` e mais ${ps.length - max}` : "");
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export interface DecisaoExcluirCliente {
  /** ⛔ Não pode (mensagem do 409). */
  bloqueio: string | null;
  /** ⚠️ Pode, mas o usuário confirma vendo isto. */
  confirmar: string | null;
  /** Projetos citados na mensagem. */
  projetos: ProjetoDoCliente[];
}

/** Lixeira (definitivo = false): bloqueia com projeto em andamento (não
 * excluído e sem concluido_em); com projetos só concluídos/na lixeira, pede
 * confirmação. Definitivo: só sem NENHUM projeto (nem na lixeira). */
export function decisaoExcluirCliente(projetos: ProjetoDoCliente[], definitivo: boolean): DecisaoExcluirCliente {
  if (definitivo) {
    if (!projetos.length) return { bloqueio: null, confirmar: null, projetos: [] };
    return {
      bloqueio: `Este cliente ainda tem ${plural(projetos.length, "projeto", "projetos")} (contando a lixeira): ${listarProjetos(projetos)}. Exclua-os definitivamente antes de excluir o cliente.`,
      confirmar: null,
      projetos,
    };
  }
  const andamento = projetos.filter((p) => !p.excluido && !p.concluido);
  if (andamento.length) {
    return {
      bloqueio: `Este cliente tem ${plural(andamento.length, "projeto em andamento", "projetos em andamento")}: ${listarProjetos(andamento)}. Conclua ou exclua esses projetos antes.`,
      confirmar: null,
      projetos: andamento,
    };
  }
  if (projetos.length) {
    const concl = projetos.filter((p) => !p.excluido);
    const lix = projetos.filter((p) => p.excluido);
    const partes = [
      concl.length ? `${plural(concl.length, "projeto concluído", "projetos concluídos")} (${listarProjetos(concl)})` : "",
      lix.length ? `${plural(lix.length, "projeto na lixeira", "projetos na lixeira")} (${listarProjetos(lix)})` : "",
    ].filter(Boolean);
    return {
      bloqueio: null,
      confirmar: `Este cliente tem ${partes.join(" e ")}. Eles continuam existindo, mas o cliente sai das listas. Enviar para a lixeira mesmo assim?`,
      projetos,
    };
  }
  return { bloqueio: null, confirmar: null, projetos: [] };
}

/** Restaurar da lixeira: o CNPJ (dígitos) ou a razão social (normalizada)
 * já está num cliente ATIVO? Devolve o cliente e a mensagem do 409, ou null. */
export function conflitoRestauracao(
  cliente: { id: string; razao_social: string; cnpj?: string | null },
  clientes: ClienteRef[]
): { cliente: ClienteRef; mensagem: string } | null {
  const ativos = clientes.filter((c) => c.id !== cliente.id && !c.excluido);
  const d = normalizarCnpj(cliente.cnpj);
  const porCnpj = d ? ativos.find((c) => normalizarCnpj(c.cnpj) === d) : undefined;
  if (porCnpj) {
    return { cliente: porCnpj, mensagem: `Não dá para restaurar: o CNPJ já está no cliente ativo “${porCnpj.razao_social}”.` };
  }
  const k = normalizarRazaoSocial(cliente.razao_social);
  const porNome = k ? ativos.find((c) => normalizarRazaoSocial(c.razao_social) === k) : undefined;
  if (porNome) {
    return { cliente: porNome, mensagem: `Não dá para restaurar: já existe o cliente ativo “${porNome.razao_social}” com a mesma razão social.` };
  }
  return null;
}

// ── Contatos ─────────────────────────────────────────────────────────────────

export interface DadosContato {
  id?: string | null;
  nomeCompleto?: string | null;
  cargo?: string | null;
  telefone?: string | null;
  email?: string | null;
}

/** Contato já gravado no cliente (formato do banco). */
export interface ContatoExistente {
  id: string;
  nome_completo: string;
  email: string | null;
  /** false = desativado (continua contando para repetidos). */
  ativo?: boolean | null;
}

function sufixoDesativado(c: ContatoExistente): string {
  return c.ativo === false ? " (desativado — reative-o no cadastro do cliente em vez de cadastrar de novo)" : "";
}

/** Um contato. `prefixo` monta a chave do campo ("contatos.0."), e
 * `existentes` são os contatos já gravados no mesmo cliente — ativos e
 * desativados (desativado não libera o nome/e-mail para outro cadastro). */
export function validarContato(c: DadosContato, existentes: ContatoExistente[] = [], prefixo = ""): ResultadoValidacao {
  const r = novoResultado();
  const outros = existentes.filter((e) => e.id !== c.id);

  const nome = normalizarNome(c.nomeCompleto);
  if (!nome) addErro(r, prefixo + "nomeCompleto", "Informe o nome do contato.");
  else {
    const rep = outros.find((e) => normalizarNome(e.nome_completo) === nome);
    if (rep) addErro(r, prefixo + "nomeCompleto", `Já existe o contato “${rep.nome_completo}” neste cliente${sufixoDesativado(rep)}.`);
  }

  if (!c.cargo?.trim()) addErro(r, prefixo + "cargo", "Informe o cargo.");

  const email = normalizarEmail(c.email);
  if (!email) addErro(r, prefixo + "email", "Informe o e-mail.");
  else if (!emailValido(email)) addErro(r, prefixo + "email", "E-mail inválido (ex.: nome@empresa.com.br).");
  else {
    const rep = outros.find((e) => normalizarEmail(e.email) === email);
    if (rep) addErro(r, prefixo + "email", `E-mail já usado pelo contato “${rep.nome_completo}”${sufixoDesativado(rep)}.`);
  }

  if (c.telefone?.trim() && !telefoneValido(c.telefone)) {
    addAviso(r, prefixo + "telefone", "Telefone fora do padrão: DDD + 8 dígitos (fixo) ou 9 (celular).");
  }
  return r;
}

/** Bloco de contato em branco = não começado (fica de fora). */
export function contatoVazio(c: DadosContato): boolean {
  return !(c.nomeCompleto?.trim() || c.cargo?.trim() || c.email?.trim() || c.telefone?.trim());
}

/** Lista de contatos de um cadastro novo: cada um + repetidos entre si.
 * Blocos em branco são ignorados, mas o índice da chave é o da lista
 * recebida — assim a tela casa a mensagem com o bloco certo. */
export function validarContatos(lista: DadosContato[], existentes: ContatoExistente[] = []): ResultadoValidacao {
  const r = novoResultado();
  lista.forEach((c, i) => {
    if (contatoVazio(c)) return;
    const ri = validarContato(c, existentes, `contatos.${i}.`);
    Object.entries(ri.erros).forEach(([k, l]) => l.forEach((m) => addErro(r, k, m)));
    Object.entries(ri.avisos).forEach(([k, l]) => l.forEach((m) => addAviso(r, k, m)));
  });
  duplicadosEmLista(lista, (c) => normalizarNome(c.nomeCompleto)).forEach(({ indice, primeiro }) =>
    addErro(r, `contatos.${indice}.nomeCompleto`, `Mesmo nome do contato ${primeiro + 1}.`)
  );
  duplicadosEmLista(lista, (c) => normalizarEmail(c.email)).forEach(({ indice, primeiro }) =>
    addErro(r, `contatos.${indice}.email`, `Mesmo e-mail do contato ${primeiro + 1}.`)
  );
  return r;
}

/** Contato pronto para gravar (gp_orgaos_contatos). */
export function contatoParaGravar(c: DadosContato) {
  const tel = (c.telefone || "").trim();
  return {
    nome_completo: (c.nomeCompleto || "").replace(/\s+/g, " ").trim(),
    cargo: (c.cargo || "").replace(/\s+/g, " ").trim(),
    telefone: tel || null,
    email: normalizarEmail(c.email),
  };
}

// ── Contato: ativo, renomear em uso, excluir × desativar ─────────────────────

/** Só os contatos ativos — para NOVAS escolhas (projeto, entrega, RDO,
 * proposta). Quem mostra o que já foi gravado usa a lista inteira. */
export function contatosAtivos<T extends { ativo?: boolean | null }>(lista: T[] | null | undefined): T[] {
  return (lista || []).filter((c) => c.ativo !== false);
}

/** Projeto do cliente com o responsável (texto) — gp_projetos.responsavel_projeto. */
export interface ProjetoResponsavel {
  id: string;
  codigo: string | null;
  responsavel: string | null;
  excluido?: boolean;
}

/** Projetos cujo responsável é este contato (nome normalizado igual). */
export function projetosDoContato(nome: string | null | undefined, projetos: ProjetoResponsavel[]): ProjetoResponsavel[] {
  const k = normalizarNome(nome);
  if (!k) return [];
  return projetos.filter((p) => normalizarNome(p.responsavel) === k);
}

export interface PlanoRenomeacaoContato {
  /** O nome mudou (mesmo que só caixa/espaço). */
  renomeia: boolean;
  /** Projetos que recebem o nome novo como responsável. */
  projetos: ProjetoResponsavel[];
  /** Texto da confirmação, ou null se não há o que levar. */
  texto: string | null;
}

/** Renomear o contato: os projetos DESTE cliente que têm o nome antigo como
 * responsável passam a ter o nome novo. RDOs, relatórios e entregas
 * (contato_nome) são histórico e ficam como estão. */
export function planoRenomeacaoContato(
  antigo: string | null | undefined, novo: string | null | undefined, projetos: ProjetoResponsavel[]
): PlanoRenomeacaoContato {
  const a = normalizarEspacos(antigo);
  const n = normalizarEspacos(novo);
  if (!n || a === n) return { renomeia: false, projetos: [], texto: null };
  const ps = projetosDoContato(a, projetos).filter((p) => (p.responsavel || "") !== n);
  if (!ps.length) return { renomeia: true, projetos: [], texto: null };
  const lix = ps.filter((p) => p.excluido).length;
  return {
    renomeia: true,
    projetos: ps,
    texto: `${ps.length === 1 ? "1 projeto tem" : `${ps.length} projetos têm`} este contato como responsável${lix ? ` (${lix} na lixeira)` : ""}: ${listarProjetos(ps)}. ` +
      `O responsável desses projetos passa a ser “${n}”. RDOs, relatórios e entregas já registrados mantêm o nome antigo.`,
  };
}

export interface UsoContato {
  /** Entregas (gp_entregas.contato_id) que citam o contato. */
  entregas: number;
  /** Projetos do cliente com o contato como responsável. */
  projetos: number;
}

/** Excluir de vez só sem uso; em uso → mensagem do 409 sugerindo Desativar. */
export function decisaoExcluirContato(nome: string, uso: UsoContato): { pode: boolean; mensagem: string | null } {
  const partes = [
    uso.projetos ? `responsável em ${plural(uso.projetos, "projeto", "projetos")}` : "",
    uso.entregas ? `recebeu ${plural(uso.entregas, "entrega", "entregas")}` : "",
  ].filter(Boolean);
  if (!partes.length) return { pode: true, mensagem: null };
  return {
    pode: false,
    mensagem: `“${nome}” está em uso (${partes.join("; ")}) e não pode ser excluído. Use “Desativar”: some das novas escolhas e o que já existe continua mostrando o contato.`,
  };
}

/** "Outra pessoa alterou este cliente às 14:05 — recarregue." (hora de Brasília) */
export function msgVersaoCliente(updatedAt: string | null | undefined, oQue: "cliente" | "contato" = "cliente"): string {
  let hora = "";
  try {
    if (updatedAt) {
      hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
        .format(new Date(updatedAt));
    }
  } catch { /* sem hora */ }
  return `Outra pessoa alterou este ${oQue}${hora ? ` às ${hora}` : ""} — recarregue (suas alterações não foram gravadas).`;
}
