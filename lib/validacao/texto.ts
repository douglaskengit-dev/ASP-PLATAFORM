/** Normalização de texto para comparar o que o usuário digitou sem que
 * acento, caixa, espaço ou pontuação criem "duplicados diferentes". */

export function removerAcentos(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Trim + espaços repetidos viram um só. É o que se grava. */
export function normalizarEspacos(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Sem acento, caixa única e espaços colapsados. Pontuação fica — use
 * `semPontuacao` quando ela não importar (endereço, razão social). */
export function normalizarTexto(s: string | null | undefined, caixa: "baixa" | "alta" = "baixa"): string {
  const t = normalizarEspacos(removerAcentos(s || ""));
  return caixa === "alta" ? t.toUpperCase() : t.toLowerCase();
}

/** Troca pontuação por espaço e recolapsa ("Rua A, 100" = "Rua A 100").
 * Remove acentos antes, então sobra só [A-Za-z0-9]. */
export function semPontuacao(s: string): string {
  return normalizarEspacos(removerAcentos(s).replace(/[^A-Za-z0-9 ]/g, " "));
}

/** Partículas que não contam em nome de pessoa ("Maria da Silva"). */
export const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "d", "di", "du", "del", "van", "von"]);

/** Nome de pessoa para comparação: sem acento, minúsculo, sem pontuação e
 * sem partículas — "Rodrigo de Oliveira" e "rodrigo  oliveira" ficam iguais. */
export function normalizarNome(s: string | null | undefined): string {
  return semPontuacao(normalizarTexto(s))
    .split(" ")
    .filter((p) => p && !PARTICULAS.has(p))
    .join(" ");
}

/** Sufixos societários ignorados ao comparar razão social. */
const SUFIXOS_EMPRESA = new Set(["LTDA", "ME", "EPP", "EIRELI", "MEI", "SA", "SS"]);

/** Razão social para comparação: maiúscula, sem acento/pontuação e sem o
 * sufixo societário do fim ("ACME Ltda." = "ACME - ME" = "acme S/A"). Não
 * mexe no meio do nome — "PRO CULT LTDAKUBIX" (colado) fica como está. */
export function normalizarRazaoSocial(s: string | null | undefined): string {
  const partes = semPontuacao(normalizarTexto(s, "alta")).split(" ").filter(Boolean);
  for (;;) {
    const n = partes.length;
    if (n > 1 && SUFIXOS_EMPRESA.has(partes[n - 1])) partes.pop();
    else if (n > 2 && partes[n - 2] === "S" && (partes[n - 1] === "A" || partes[n - 1] === "S")) partes.splice(n - 2, 2);
    else break;
  }
  return partes.join(" ");
}

/** Distância de edição (Levenshtein) — quantas letras trocar/inserir/apagar. */
export function distanciaEdicao(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    ant = atual;
  }
  return ant[b.length];
}

/** Dois nomes "quase iguais": iguais depois de normalizar, um contido no
 * outro palavra a palavra ("Rodrigo Oliveira" ⊂ "Rodrigo Silva Oliveira") ou
 * poucas letras de diferença (erro de digitação). Serve para AVISAR — nunca
 * para bloquear. `normalizar` troca a regra (nome de pessoa × razão social). */
export function nomesParecidos(
  a: string | null | undefined,
  b: string | null | undefined,
  normalizar: (s: string) => string = normalizarNome
): boolean {
  const na = normalizar(a || "");
  const nb = normalizar(b || "");
  if (!na || !nb) return false;
  if (na === nb) return true;

  const [curto, longo] = na.length <= nb.length ? [na, nb] : [nb, na];
  const pc = curto.split(" ");
  const pl = new Set(longo.split(" "));
  if (curto.replace(/ /g, "").length >= 4 && pc.every((p) => pl.has(p))) return true;

  const sa = na.replace(/ /g, "");
  const sb = nb.replace(/ /g, "");
  const menor = Math.min(sa.length, sb.length);
  if (menor < 5) return false;
  const limite = menor <= 8 ? 1 : menor <= 16 ? 2 : 3;
  return distanciaEdicao(sa, sb) <= limite;
}

/** Itens repetidos numa lista, pela chave já normalizada. Devolve o índice
 * de cada repetido e o do primeiro igual a ele. Chave vazia não conta. */
export function duplicadosEmLista<T>(
  lista: T[],
  chave: (item: T) => string
): { indice: number; primeiro: number }[] {
  const vistos = new Map<string, number>();
  const out: { indice: number; primeiro: number }[] = [];
  lista.forEach((item, i) => {
    const k = chave(item);
    if (!k) return;
    if (vistos.has(k)) out.push({ indice: i, primeiro: vistos.get(k)! });
    else vistos.set(k, i);
  });
  return out;
}
