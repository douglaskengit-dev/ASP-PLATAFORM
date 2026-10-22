/** Regras da Fase 3 — checklist de equipamentos da OS (gp_checklist_
 * equipamentos). Puras: o modal de montar a lista chama antes de salvar e
 * /api/checklist repete.
 *
 *   ⛔ item repetido (mesmo item do Catálogo, ou mesmo nome sem acento/caixa/
 *      pontuação) — inclui item avulso igual a um item do Catálogo já marcado
 *   ⚠️ item avulso parecido com um do Catálogo ("seria …?")
 *   Item avulso IGUAL a um do Catálogo vira o item do Catálogo.
 *
 * Refazer a lista não perde conferência: o item que continua (mesmo item do
 * Catálogo ou mesmo nome) mantém conferido/por/em/obs. */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { normalizarEquipamento, sugestaoCatalogo } from "./agendamento";
import { normalizarEspacos } from "./texto";

export interface ItemChecklist {
  slug?: string | null;
  nome: string;
  conferido?: boolean;
  /** Nome de quem conferiu (exibição). */
  por?: string | null;
  /** Id (gp_profiles) de quem conferiu. */
  por_id?: string | null;
  em?: string | null;
  obs?: string;
}

export interface EquipamentoCatalogo {
  slug: string;
  nome: string;
}

/** Item do Catálogo correspondente (pelo slug ou pelo nome normalizado). */
function doCatalogo(it: Pick<ItemChecklist, "slug" | "nome">, catalogo: EquipamentoCatalogo[]): EquipamentoCatalogo | null {
  if (it.slug) {
    const s = catalogo.find((c) => c.slug === it.slug);
    if (s) return s;
  }
  const n = normalizarEquipamento(it.nome);
  return (n && catalogo.find((c) => normalizarEquipamento(c.nome) === n)) || null;
}

/** Chave do item: "s:<slug>" para item do Catálogo, "n:<nome normalizado>"
 * para avulso. Dois itens com a mesma chave são o mesmo item. */
export function chaveItemChecklist(it: Pick<ItemChecklist, "slug" | "nome">, catalogo: EquipamentoCatalogo[] = []): string {
  const c = doCatalogo(it, catalogo);
  if (c) return `s:${c.slug}`;
  if (it.slug) return `s:${it.slug}`;
  const n = normalizarEquipamento(it.nome);
  return n ? `n:${n}` : "";
}

/** Itens limpos: nome sem espaços sobrando, avulso igual a um do Catálogo
 * vira o do Catálogo (slug + nome oficial), vazios fora. */
export function normalizarItensChecklist<T extends Pick<ItemChecklist, "slug" | "nome">>(
  itens: T[], catalogo: EquipamentoCatalogo[] = []
): (T & { slug: string | null; nome: string })[] {
  return (itens || [])
    .map((it) => ({ ...it, nome: normalizarEspacos(it?.nome) }))
    .filter((it) => it.nome || it.slug)
    .map((it) => {
      const c = doCatalogo(it, catalogo);
      return c ? { ...it, slug: c.slug, nome: c.nome } : { ...it, slug: it.slug || null };
    });
}

export const ROTULOS_CHECKLIST: Record<string, string> = { itens: "Itens" };

/** `itens` como o usuário montou (antes de normalizar). */
export function validarItensChecklist(itens: Pick<ItemChecklist, "slug" | "nome">[], catalogo: EquipamentoCatalogo[] = []): ResultadoValidacao {
  const r = novoResultado();
  const nomes = catalogo.map((c) => c.nome);
  const vistos = new Map<string, string>();
  for (const it of itens || []) {
    const nome = normalizarEspacos(it?.nome);
    if (!nome && !it?.slug) continue;
    const c = doCatalogo(it, catalogo);
    const k = chaveItemChecklist(it, catalogo);
    if (vistos.has(k)) {
      const outro = vistos.get(k)!;
      addErro(r, "itens", outro === (c?.nome || nome)
        ? `“${c?.nome || nome}” está repetido na lista.`
        : `“${nome}” é o mesmo item que “${outro}” — deixe um só.`);
      continue;
    }
    vistos.set(k, c?.nome || nome);
    if (!it.slug && c && c.nome !== nome) addAviso(r, "itens", `“${nome}” é o item do Catálogo “${c.nome}” — será usado o do Catálogo.`);
    if (!c) {
      const s = sugestaoCatalogo(nome, nomes);
      if (s) addAviso(r, "itens", `“${nome}” não está no Catálogo — seria “${s}”? Se for, marque-o na lista do Catálogo.`);
    }
  }
  return r;
}

/** Lista nova mantendo a conferência dos itens que já estavam na antiga. */
export function mesclarChecklist(
  novos: Pick<ItemChecklist, "slug" | "nome">[], antigos: ItemChecklist[] = [], catalogo: EquipamentoCatalogo[] = []
): ItemChecklist[] {
  const porChave = new Map<string, ItemChecklist>();
  for (const a of antigos || []) {
    const k = chaveItemChecklist(a, catalogo);
    if (k && !porChave.has(k)) porChave.set(k, a);
  }
  return normalizarItensChecklist(novos, catalogo).map((n) => {
    const a = porChave.get(chaveItemChecklist(n, catalogo));
    const base: ItemChecklist = { slug: n.slug || undefined, nome: n.nome, conferido: false };
    if (!a) return base;
    return {
      ...base,
      conferido: !!a.conferido,
      por: a.conferido ? a.por ?? null : null,
      por_id: a.conferido ? a.por_id ?? null : null,
      em: a.conferido ? a.em ?? null : null,
      ...(a.obs ? { obs: a.obs } : {}),
    };
  });
}
