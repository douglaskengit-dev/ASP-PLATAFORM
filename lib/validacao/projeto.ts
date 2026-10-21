/** Regras da Fase 1 — abertura (e edição) do projeto. Função pura: o
 * formulário chama com o que veio de /api/projetos/verificar; a API chama
 * com o que leu do banco. As duas pontas decidem igual.
 *
 *   ⛔ cliente cadastrado e ativo · código obrigatório e único (inclusive
 *      lixeira) · pedido obrigatório · data de abertura válida e não futura
 *      · com "usar contato", responsável = contato do cliente
 *   ⚠️ código fora do padrão NN/INICIAIS/AA · iniciais ≠ de quem abriu ·
 *      ano do código ≠ ano da abertura · mesmo pedido em outro projeto do
 *      cliente · endereço em branco · mesmo endereço com inspeção em aberto
 *      · responsável parecido com um contato (sem usar o contato) */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { dataIsoValida } from "./formatos";
import { anoDoCodigo, formatoCodigoValido, normalizarCodigoProjeto, normalizarIdentificador, parseCodigoProjeto } from "./codigoProjeto";
import { nomesParecidos, normalizarNome, normalizarTexto, semPontuacao } from "./texto";

export interface DadosProjeto {
  clienteId?: string | null;
  codigoProjeto?: string | null;
  pedidoCompra?: string | null;
  endereco?: string | null;
  responsavelProjeto?: string | null;
  dataAbertura?: string | null;
  /** "Usar dados do contato do cliente?" = Sim → id do contato usado. */
  usarContato?: boolean;
  contatoId?: string | null;
}

/** Projeto já gravado, como /api/projetos/verificar devolve. */
export interface ProjetoRef {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  /** Está na lixeira. */
  excluido: boolean;
  /** Tem inspeção (não excluída) antes da fase 10. */
  em_aberto: boolean;
}

export interface ContatoRef {
  id: string;
  nome_completo: string;
}

export interface ContextoProjeto {
  /** AAAA-MM-DD no fuso de Brasília. */
  hoje: string;
  /** Projeto em edição — fica fora das checagens de duplicidade. */
  excluirId?: string | null;
  /** Iniciais de quem abriu (ou está abrindo) o projeto. */
  iniciaisCriador?: string;
  /** false = cliente não existe ou está na lixeira. undefined = não checado. */
  clienteValido?: boolean;
  /** Candidatos a código repetido (qualquer cliente, inclusive lixeira). */
  projetosCodigo?: ProjetoRef[];
  /** Projetos ativos do mesmo cliente (pedido/endereço repetidos). */
  projetosCliente?: ProjetoRef[];
  /** Contatos do cliente. */
  contatos?: ContatoRef[];
}

export const ROTULOS_PROJETO: Record<string, string> = {
  clienteId: "Cliente",
  codigoProjeto: "Código do projeto",
  pedidoCompra: "Pedido de compra",
  endereco: "Endereço da obra",
  responsavelProjeto: "Responsável",
  dataAbertura: "Data de abertura",
};

/** Endereço para comparação: sem acento, caixa, pontuação e espaços extras. */
export function normalizarEndereco(s: string | null | undefined): string {
  return semPontuacao(normalizarTexto(s));
}

/** Nome curto de um projeto para as mensagens. */
export function descreverProjeto(p: ProjetoRef): string {
  const nome = p.codigo_projeto || p.pedido_compra || "projeto sem código";
  return `${nome}${p.cliente_nome ? ` (${p.cliente_nome})` : ""}${p.excluido ? " — na lixeira" : ""}`;
}

/** Projeto com o mesmo código normalizado (exceto o próprio), ou null. */
export function codigoRepetido(codigo: string | null | undefined, ctx: Pick<ContextoProjeto, "projetosCodigo" | "excluirId">): ProjetoRef | null {
  const n = normalizarCodigoProjeto(codigo);
  if (!n) return null;
  return (ctx.projetosCodigo || []).find((p) => p.id !== ctx.excluirId && normalizarCodigoProjeto(p.codigo_projeto) === n) || null;
}

/** Contatos com nome parecido (mas não idêntico) ao responsável digitado. */
export function contatosParecidos<T extends ContatoRef>(responsavel: string | null | undefined, contatos: T[] = []): T[] {
  const n = normalizarNome(responsavel);
  if (!n || contatos.some((c) => normalizarNome(c.nome_completo) === n && c.nome_completo.trim() === (responsavel || "").trim())) return [];
  return contatos.filter((c) => nomesParecidos(responsavel, c.nome_completo));
}

export function validarProjeto(d: DadosProjeto, ctx: ContextoProjeto): ResultadoValidacao {
  const r = novoResultado();

  // Cliente
  if (!d.clienteId) addErro(r, "clienteId", "Escolha o cliente (ou cadastre um em “+ Cadastrar”).");
  else if (ctx.clienteValido === false) addErro(r, "clienteId", "Cliente não encontrado ou na lixeira — escolha um cliente cadastrado.");

  // Data de abertura
  const data = (d.dataAbertura || "").trim();
  if (!data) addErro(r, "dataAbertura", "Informe a data de abertura.");
  else if (!dataIsoValida(data)) addErro(r, "dataAbertura", "Data inválida.");
  else if (data > ctx.hoje) addErro(r, "dataAbertura", "A data de abertura não pode estar no futuro.");

  // Código
  const codigo = normalizarCodigoProjeto(d.codigoProjeto);
  if (!codigo) {
    addErro(r, "codigoProjeto", "Informe o código do projeto.");
  } else {
    const repetido = codigoRepetido(codigo, ctx);
    if (repetido) addErro(r, "codigoProjeto", `Código já usado no projeto ${descreverProjeto(repetido)}. O código não pode se repetir.`);
    const p = parseCodigoProjeto(codigo);
    if (!formatoCodigoValido(codigo)) {
      addAviso(r, "codigoProjeto", "Fora do padrão NN/INICIAIS/AA (ex.: 07/MG/26).");
    }
    if (p && ctx.iniciaisCriador && p.iniciais !== ctx.iniciaisCriador) {
      addAviso(r, "codigoProjeto", `As iniciais ${p.iniciais} diferem das de quem abriu o projeto (${ctx.iniciaisCriador}).`);
    }
    if (p && dataIsoValida(data) && p.ano !== anoDoCodigo(data)) {
      addAviso(r, "codigoProjeto", `O ano do código (${p.ano}) difere do ano da data de abertura (${data.slice(0, 4)}).`);
    }
  }

  const doCliente = (ctx.projetosCliente || []).filter((p) => p.id !== ctx.excluirId && !p.excluido);

  // Pedido de compra
  const pedido = normalizarIdentificador(d.pedidoCompra);
  if (!pedido) {
    addErro(r, "pedidoCompra", "Informe o pedido de compra.");
  } else {
    const iguais = doCliente.filter((p) => normalizarIdentificador(p.pedido_compra) === pedido);
    if (iguais.length) {
      addAviso(r, "pedidoCompra", `Este pedido já está em ${iguais.map(descreverProjeto).join(", ")}. Confira se é uma revisão.`);
    }
  }

  // Endereço
  const endereco = normalizarEndereco(d.endereco);
  if (!endereco) {
    addAviso(r, "endereco", "Endereço da obra em branco.");
  } else {
    const abertos = doCliente.filter((p) => p.em_aberto && normalizarEndereco(p.endereco) === endereco);
    if (abertos.length) {
      addAviso(r, "endereco", `Já há projeto em andamento neste endereço: ${abertos.map(descreverProjeto).join(", ")}.`);
    }
  }

  // Responsável
  const contatos = ctx.contatos || [];
  if (d.usarContato) {
    const c = contatos.find((x) => x.id === d.contatoId);
    if (!c || normalizarNome(c.nome_completo) !== normalizarNome(d.responsavelProjeto)) {
      addErro(r, "responsavelProjeto", "Escolha um contato do cliente e clique em “Usar como está” (ou responda “Não” para digitar).");
    }
  } else {
    contatosParecidos(d.responsavelProjeto, contatos).forEach((c) =>
      addAviso(r, "responsavelProjeto", `Parecido com o contato “${c.nome_completo}” do cliente.`)
    );
  }

  return r;
}
