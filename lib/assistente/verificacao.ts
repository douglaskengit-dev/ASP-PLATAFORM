/**
 * Conferência da resposta da IA contra o que o banco devolveu NESTA pergunta.
 * A IA não pode citar projeto, OS ou cliente que não veio das consultas: se
 * citar, recebe uma correção; se insistir, a resposta é montada aqui mesmo,
 * só com os dados das consultas (nunca inventa).
 */
import { normalizar } from "./manual-busca";

/** Uma consulta feita para responder a pergunta (resultado em JSON). */
export interface Consulta { nome: string; conteudo: string; erro?: boolean }

const LINK = /\]\((\/(?:projetos|inspecoes|orgaos)\/[^)\s]+)\)/g;
const DIZ_QUE_NAO_ACHOU = /n[aã]o (encontrei|achei|h[aá]|existe|consta|aparece)/i;

/** Dúvida de uso ("como cadastro um cliente?") vai pelo manual; o resto que
 *  fala de projetos, clientes, OS, agenda… tem de passar pelo banco. */
export function precisaDoBanco(pergunta: string): boolean {
  const t = normalizar(pergunta);
  if (/^(como|onde|o que (e|significa)|para que|pra que|posso|consigo|quem pode|qual a diferenca|por que)\b/.test(t)) return false;
  return /\b(projet|client|orga|os\b|inspec|tanque|agend|agenda|rdo|relator|colet|fase|cnpj|contat|prefeit|pedido|entreg|encerr)/.test(t);
}

function semResultado(c: Consulta): boolean {
  if (c.erro) return true;
  try {
    const j = JSON.parse(c.conteudo);
    return Array.isArray(j) ? j.length === 0 : !!j?.erro;
  } catch { return true; }
}

/** Nenhuma consulta trouxe dado: a resposta sai daqui, sem perguntar de novo à IA. */
export const nadaEncontrado = (consultas: Consulta[]) => consultas.length > 0 && consultas.every(semResultado);

/** null = resposta confere; senão, o motivo (vira a correção para a IA). */
export function problemaNaResposta(texto: string, consultas: Consulta[], pergunta: string): string | null {
  if (!consultas.length && precisaDoBanco(pergunta)) {
    return "Você respondeu sobre dados do sistema sem consultar o banco. Chame a ferramenta adequada antes de responder.";
  }
  const fontes = consultas.map((c) => c.conteudo).join("\n");
  const inventados = Array.from(texto.matchAll(LINK), (m) => m[1]).filter((l) => !fontes.includes(l));
  if (inventados.length) {
    return `Você citou ${inventados.join(", ")}, que não veio das consultas. Use só projetos, OS e clientes que as ferramentas devolveram.`;
  }
  if (nadaEncontrado(consultas) && !DIZ_QUE_NAO_ACHOU.test(texto)) {
    return "As consultas não trouxeram nenhum resultado. Diga que não encontrou no banco, sem citar nomes.";
  }
  return null;
}

const dataBr = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");

/** Uma linha por item, só com campos que vieram do banco. */
function linha(i: any): string {
  const nome = i.codigo || i.identificacao || i.razao_social || i.os || "(sem nome)";
  const titulo = i.link ? `[${nome}](${i.link})` : `**${nome}**`;
  const extras = [
    i.tipo && i.data ? `${i.tipo === "execucao" ? "Execução" : "Inspeção"} em ${dataBr(i.data)}` : "",
    i.projeto && typeof i.projeto === "string" ? `projeto ${i.projeto}` : "",
    typeof i.cliente === "string" ? i.cliente : "",
    i.cidade && !i.cliente ? `${i.cidade}${i.uf ? `/${i.uf}` : ""}` : "",
    i.fase ? `fase ${i.fase} — ${i.fase_titulo}` : "",
    i.encerrada_em || i.concluido_em ? "encerrado" : "",
  ].filter(Boolean);
  return `- ${titulo}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

/** Resposta montada só com os dados das consultas (quando a IA não confere). */
export function respostaDosDados(consultas: Consulta[]): string {
  const validas = consultas.filter((c) => !semResultado(c));
  if (!validas.length) {
    return consultas.some((c) => c.erro)
      ? "Não consegui consultar o banco agora. Tente de novo em instantes."
      : "Não encontrei isso no banco (ou você não tem acesso). Confira o nome do cliente, do projeto ou da OS.";
  }
  const j = JSON.parse(validas[validas.length - 1].conteudo);
  const itens: any[] = Array.isArray(j) ? j : [j];
  const mostrar = itens.slice(0, 10).map(linha);
  const resto = itens.length > 10 ? `\n… e mais ${itens.length - 10}. Refine a pergunta para ver os demais.` : "";
  return `Encontrei no banco ${itens.length === 1 ? "este resultado" : `${itens.length} resultados`}:\n${mostrar.join("\n")}${resto}`;
}
