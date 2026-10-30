import { normalizar } from "./manual-busca";

/** Resposta padrão para o que não é da ASP (sempre a mesma, venha do filtro
 *  abaixo ou da IA). */
export const MSG_FORA_DO_ESCOPO =
  "Desculpe, não respondo assuntos fora da ASP. Só posso ajudar com o uso da Plataforma ASP e com os dados de clientes, projetos, OS, agenda, coletas e relatórios. Quer perguntar algo sobre isso?";

/** A IA responde só isto quando a pergunta está fora do escopo; o servidor
 *  troca pela MSG_FORA_DO_ESCOPO. */
export const MARCADOR_FORA = "[FORA_DO_ESCOPO]";

/** Termos do sistema e do banco (sem acento). Palavra curta casa inteira;
 *  as demais pelo começo ("inspec" ~ inspeção, inspecionar). */
const TERMOS_CURTOS = new Set(["os", "ph", "rdo", "rdos", "asp", "pdf", "tag", "uf"]);
const RADICAIS = [
  "ordem", "servic", "inspec", "execu", "projet", "client", "orgao", "tanque", "reserva", "cisterna", "limpez",
  "relator", "laudo", "colet", "amostr", "cloro", "sedimen", "agend", "agenda", "visita", "fase", "aprov",
  "assin", "entreg", "encerr", "plataf", "sistem", "login", "senha", "perfil", "usuari", "acess", "cnpj",
  "pedido", "municip", "prefeit", "contat", "catalog", "lixeir", "dashboa", "arquiv", "equipe", "robo",
  "tela", "botao", "menu", "versao", "ajust", "pendent", "cadastr", "status", "operac", "comerci", "gerenc",
];

/** Assuntos claramente alheios (só valem se a pergunta não citar nada do sistema). */
const ALHEIO = new RegExp([
  "piada", "anedota", "charada", "receita", "futebol", "campeonato", "politic", "eleica", "president", "horoscopo",
  "signo", "poema", "poesia", "musica", "cancao", "filme", "novela", "traduz", "traduca", "em ingles", "python",
  "javascript", "programar", "programaca", "bitcoin", "cripto", "bolsa de valores", "previsao do tempo",
  "capital d", "quem (foi|descobriu|inventou)", "historia d", "redaca", "dieta", "remedio", "doenca", "namor",
  "jogo do", "loteria", "aposta",
].map((t) => `\\b${t}`).join("|"));

/** Fora do escopo com certeza (economiza a cota da IA). Na dúvida devolve
 *  false e a IA decide pelas instruções. */
export function foraDoEscopoObvio(pergunta: string): boolean {
  const t = normalizar(pergunta);
  const palavras = t.split(/[^a-z0-9]+/).filter(Boolean);
  if (palavras.some((p) => TERMOS_CURTOS.has(p) || RADICAIS.some((r) => p.startsWith(r)))) return false;
  return ALHEIO.test(t);
}

/** Troca o marcador da IA pela mensagem padrão. */
export function finalizarResposta(texto: string): { resposta: string; fora_do_escopo?: true } {
  if (texto.includes(MARCADOR_FORA)) return { resposta: MSG_FORA_DO_ESCOPO, fora_do_escopo: true };
  return { resposta: texto };
}
