/** Regras do cadastro de cliente (gp_orgaos) e dos seus contatos
 * (gp_orgaos_contatos). Puras — usadas no FormularioOrgao, no detalhe do
 * cliente, no modal de projeto e nas APIs de /api/orgaos.
 *
 *   Cliente  ⛔ razão social, cidade, UF · CNPJ com dígitos verificadores
 *              válidos e único (só dígitos, inclusive lixeira)
 *            ⚠️ razão social quase igual à de outro cliente
 *   Contato  ⛔ nome, cargo, e-mail válido · nome/e-mail repetido no cliente
 *            ⚠️ telefone fora do formato brasileiro (DDD + 8/9 dígitos) */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { cnpjValido, emailValido, normalizarCnpj, normalizarEmail, telefoneValido } from "./formatos";
import { duplicadosEmLista, nomesParecidos, normalizarNome, normalizarRazaoSocial } from "./texto";

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
}

export interface ContextoCliente {
  /** Cliente em edição — fora da checagem de duplicidade. */
  excluirId?: string | null;
  /** Clientes já cadastrados (inclusive lixeira). */
  clientes?: ClienteRef[];
}

export const ROTULOS_CLIENTE: Record<string, string> = {
  razaoSocial: "Razão social",
  cnpj: "CNPJ",
  cidade: "Cidade",
  uf: "UF",
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
  if (!d.uf?.trim()) addErro(r, "uf", "Escolha a UF.");
  return r;
}

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
}

/** Um contato. `prefixo` monta a chave do campo ("contatos.0."), e
 * `existentes` são os contatos já gravados no mesmo cliente. */
export function validarContato(c: DadosContato, existentes: ContatoExistente[] = [], prefixo = ""): ResultadoValidacao {
  const r = novoResultado();
  const outros = existentes.filter((e) => e.id !== c.id);

  const nome = normalizarNome(c.nomeCompleto);
  if (!nome) addErro(r, prefixo + "nomeCompleto", "Informe o nome do contato.");
  else {
    const rep = outros.find((e) => normalizarNome(e.nome_completo) === nome);
    if (rep) addErro(r, prefixo + "nomeCompleto", `Já existe o contato “${rep.nome_completo}” neste cliente.`);
  }

  if (!c.cargo?.trim()) addErro(r, prefixo + "cargo", "Informe o cargo.");

  const email = normalizarEmail(c.email);
  if (!email) addErro(r, prefixo + "email", "Informe o e-mail.");
  else if (!emailValido(email)) addErro(r, prefixo + "email", "E-mail inválido (ex.: nome@empresa.com.br).");
  else {
    const rep = outros.find((e) => normalizarEmail(e.email) === email);
    if (rep) addErro(r, prefixo + "email", `E-mail já usado pelo contato “${rep.nome_completo}”.`);
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
