import { MANUAL_USUARIO } from "./manual";

/** Trechos do manual mais ligados à pergunta — para modelos com contexto e
 *  cota pequenos (Cloudflare), em vez de mandar o manual inteiro sempre.
 *  Busca simples por palavras (sem acento, sem palavras vazias), por seção. */

interface Secao { titulo: string; texto: string; palavras: Set<string> }

const VAZIAS = new Set(("a o e é de da do das dos em no na nos nas um uma uns umas para por com sem que se como qual quais " +
  "quando onde ao aos à às ou mais menos ser foi são está estão tem ter meu minha sua seu isso esse essa este esta " +
  "não sim já pelo pela posso faço fazer como").split(" "));

const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const palavrasDe = (s: string) =>
  normalizar(s).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !VAZIAS.has(p)).map((p) => p.slice(0, 6));  // radical curto: "agendar" ~ "agendamento"

let secoes: Secao[] | null = null;
function carregar(): Secao[] {
  if (secoes) return secoes;
  // seções de nível 2 e 3 do manual ("## 9. Relatórios", "### Gerar...")
  const partes = MANUAL_USUARIO.split(/\n(?=#{2,3} )/);
  secoes = partes.map((p) => {
    const titulo = (p.match(/^#{1,3}\s+(.*)/)?.[1] || "").trim();
    return { titulo, texto: p.trim(), palavras: new Set(palavrasDe(p)) };
  }).filter((s) => s.titulo && !/^índice$/i.test(s.titulo));
  return secoes;
}

/** Até `limite` caracteres das seções que mais casam com a pergunta, mais o
 *  índice de títulos (para o modelo saber o que existe). */
export function trechosDoManual(pergunta: string, limite = 9000): string {
  const todas = carregar();
  const termos = palavrasDe(pergunta);
  const pontuadas = todas
    .map((s) => ({ s, pontos: termos.reduce((n, t) => n + (s.palavras.has(t) ? 1 : 0) + (normalizar(s.titulo).includes(t) ? 2 : 0), 0) }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
  const escolhidas: string[] = [];
  let total = 0;
  for (const { s } of pontuadas) {
    if (total + s.texto.length > limite) continue;
    escolhidas.push(s.texto);
    total += s.texto.length;
  }
  const indice = todas.map((s) => `- ${s.titulo}`).join("\n");
  return `Seções do manual:\n${indice}\n\n${escolhidas.length ? escolhidas.join("\n\n") : "(nenhum trecho do manual casa com a pergunta)"}`;
}
