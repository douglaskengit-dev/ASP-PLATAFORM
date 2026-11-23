/** Resultado de uma validação, campo a campo.
 *
 *   erros  (⛔) impedem salvar — a API recusa do mesmo jeito.
 *   avisos (⚠️) só alertam; o usuário pode seguir.
 *
 * A chave é o nome do campo no formulário ("codigoProjeto"); em listas usa
 * "contatos.0.email". Puro (sem React/Supabase): roda no navegador e na API. */

export type Mensagens = Record<string, string[]>;

export interface ResultadoValidacao {
  erros: Mensagens;
  avisos: Mensagens;
}

export function novoResultado(): ResultadoValidacao {
  return { erros: {}, avisos: {} };
}

function incluir(m: Mensagens, campo: string, msg: string) {
  const lista = (m[campo] ||= []);
  if (!lista.includes(msg)) lista.push(msg);
}

export function addErro(r: ResultadoValidacao, campo: string, msg: string) {
  incluir(r.erros, campo, msg);
}

export function addAviso(r: ResultadoValidacao, campo: string, msg: string) {
  incluir(r.avisos, campo, msg);
}

export function temErros(r: ResultadoValidacao): boolean {
  return Object.values(r.erros).some((l) => l.length > 0);
}

/** Junta vários resultados (ex.: cliente + cada contato). */
export function mesclar(...rs: ResultadoValidacao[]): ResultadoValidacao {
  const out = novoResultado();
  for (const r of rs) {
    for (const [c, l] of Object.entries(r.erros)) l.forEach((m) => addErro(out, c, m));
    for (const [c, l] of Object.entries(r.avisos)) l.forEach((m) => addAviso(out, c, m));
  }
  return out;
}

/** Rótulo de um campo. Itens de lista ("contatos.1.email") usam o rótulo
 * "contatos.*" + número ("Contato 2"). */
function rotuloDe(campo: string, rotulos: Record<string, string>): string | undefined {
  if (rotulos[campo]) return rotulos[campo];
  const m = /^(\w+)\.(\d+)\./.exec(campo);
  return m && rotulos[`${m[1]}.*`] ? `${rotulos[`${m[1]}.*`]} ${Number(m[2]) + 1}` : undefined;
}

/** Lista plana para o resumo perto do botão: "Rótulo: mensagem". Campos sem
 * rótulo saem só com a mensagem. */
export function resumoValidacao(
  r: ResultadoValidacao,
  rotulos: Record<string, string> = {}
): { erros: string[]; avisos: string[] } {
  const plano = (m: Mensagens) =>
    Object.entries(m).flatMap(([c, l]) => l.map((msg) => {
      const rot = rotuloDe(c, rotulos);
      return rot ? `${rot}: ${msg}` : msg;
    }));
  return { erros: plano(r.erros), avisos: plano(r.avisos) };
}

/** Primeira mensagem de erro — vira o `erro` da resposta da API. */
export function primeiroErro(r: ResultadoValidacao, rotulos: Record<string, string> = {}): string | null {
  return resumoValidacao(r, rotulos).erros[0] || null;
}

/** Erros e avisos que a API devolveu ({ erros, avisos } por campo, ou só
 *  { erro }, que vai para campoPadrao) como ResultadoValidacao da tela. */
export function resultadoDaApi(dados: any, campoPadrao: string): ResultadoValidacao {
  const r = novoResultado();
  if (dados?.erros) Object.entries(dados.erros as Record<string, string[]>).forEach(([c, l]) => l.forEach((m) => addErro(r, c, m)));
  if (dados?.avisos) Object.entries(dados.avisos as Record<string, string[]>).forEach(([c, l]) => l.forEach((m) => addAviso(r, c, m)));
  if (dados?.erro && !temErros(r)) addErro(r, campoPadrao, dados.erro);
  return r;
}

/** Corpo JSON da resposta; {} se não for JSON. */
export async function lerJson(resp: Response): Promise<any> {
  try { return await resp.json(); } catch { return {}; }
}
