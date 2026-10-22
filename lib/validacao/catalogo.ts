/** Catálogo (procedimentos e equipamentos): regras de dados compartilhadas
 *  entre a tela /catalogo e /api/catalogo.
 *
 *  ⛔ bloqueia (a API repete a checagem):
 *   - código do procedimento obrigatório e ÚNICO pela chave (sem caixa,
 *     acento, espaço ou pontuação: "PO 011" = "PO011" = "po-011");
 *   - nome obrigatório e único (sem caixa/acento/espaços extras) — nos dois;
 *   - tópicos com título, sem título repetido (lista + seções extras);
 *   - especificação com valor precisa de rótulo; rótulo não se repete;
 *   - foto repetida (SHA-256) no mesmo equipamento; caminhos do storage
 *     dentro das pastas do Catálogo; modelo só em catalogo/modelos/*.docx.
 *  ⚠️ avisa: nome parecido com outro item; limite de aviso do cloro acima de
 *   50; procedimento que lista equipamento que não existe mais.
 *
 *  Puro (sem React/Supabase). As chaves batem com gp_chave_codigo /
 *  gp_chave_nome da migração 20261031100000 (índices únicos). */
import { addAviso, addErro, novoResultado, type ResultadoValidacao } from "./resultado";
import { nomesParecidos, normalizarEspacos, normalizarTexto, removerAcentos } from "./texto";
import { unidadeCloroValida } from "../asp/fotos-execucao";

const MB = 1024 * 1024;
/** Modelo .docx do procedimento. */
export const MODELO_MAX_BYTES = 20 * MB;
/** Foto do equipamento (mesmo limite das fotos do relatório). */
export const FOTO_CATALOGO_MAX_BYTES = 10 * MB;
/** Limite de aviso do cloro acima disto provavelmente é erro de digitação. */
export const CLORO_LIMITE_ALTO = 50;
export const PASTA_MODELOS = "catalogo/modelos/";
export const PASTA_FOTOS_CATALOGO = "catalogo/fotos/";
export const MAX_CODIGO = 60;
export const MAX_NOME_CATALOGO = 160;

export type TipoCatalogo = "equipamento" | "procedimento";

// ── Chaves de comparação ─────────────────────────────────────────────────────

/** Código do procedimento para comparar: minúsculo, sem acento e só letras e
 *  números ("PO 011", "PO011" e "po-011" são o mesmo código). */
export function chaveCodigo(s: string | null | undefined): string {
  return removerAcentos(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Nome (procedimento ou equipamento) para comparar: minúsculo, sem acento,
 *  espaços colapsados. Pontuação conta ("ROV 1" ≠ "ROV-1"). */
export function chaveNome(s: string | null | undefined): string {
  return normalizarTexto(s);
}

/** Título de tópico para comparar: sem o número da frente ("3. Métodos") nem
 *  a pontuação do fim ("Métodos:"), como o gerador casa as seções. */
export function chaveTitulo(s: string | null | undefined): string {
  return chaveNome((s || "").replace(/^\s*\d+(\.\d+)*\.?\s*/, "").replace(/[:.]\s*$/, ""));
}

/** Identificador do equipamento a partir do nome (só na criação; depois é
 *  imutável — é a chave que procedimentos, checklists e relatórios guardam). */
export function slugificar(nome: string | null | undefined): string {
  const s = removerAcentos(nome || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "equipamento";
}

/** Slug livre: "rov", "rov-2", "rov-3"… (compara sem caixa). */
export function slugUnico(nome: string | null | undefined, existentes: (string | null | undefined)[]): string {
  const usados = new Set(existentes.filter(Boolean).map((s) => String(s).toLowerCase()));
  const base = slugificar(nome);
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) {
    const s = `${base}-${n}`;
    if (!usados.has(s)) return s;
  }
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface Especificacao { rotulo: string; valor: string }
export interface FotoCatalogo { caminho: string; legenda?: string; hash?: string }
export interface TopicoLista { numero: number; titulo: string; titulo_origem?: string; ativo: boolean }
export interface TopicoExtra { titulo: string; apos?: number }

export interface EquipamentoRef { id: string; slug: string; nome: string; ativo?: boolean | null }
export interface ProcedimentoRef { id: string; codigo: string; nome: string; ativo?: boolean | null }

/** Item ativo? Coluna ausente (migração não rodada) = ativo. */
export function ativoNoCatalogo(x: { ativo?: unknown } | null | undefined): boolean {
  return x?.ativo !== false;
}

export interface DadosEquipamento {
  nome: string;
  especificacoes: Especificacao[];
  fotos: FotoCatalogo[];
}

export interface DadosProcedimento {
  codigo: string;
  nome: string;
  metodos: string | null;
  equipamentos: string[];
  topicos: number[] | null;
  topicos_lista: TopicoLista[];
  topicos_extras: TopicoExtra[];
  template_path: string | null;
  limpeza_robotizada: boolean;
  agua_potavel: boolean;
  cloro_unidade: string;
  cloro_limite_aviso: number;
}

// ── Lista branca de campos (POST/PATCH) ──────────────────────────────────────

export const CAMPOS_EQUIPAMENTO = ["nome", "especificacoes", "fotos"] as const;
export const CAMPOS_PROCEDIMENTO = [
  "codigo", "nome", "metodos", "equipamentos", "topicos", "topicos_lista", "topicos_extras",
  "template_path", "limpeza_robotizada", "agua_potavel", "cloro_unidade", "cloro_limite_aviso",
] as const;

/** Só os campos que a tela pode gravar. id, slug, ordem, ativo, datas e
 *  qualquer outra coluna ficam de fora (slug: gerado na criação; ordem:
 *  pelas setas; ativo: Desativar/Reativar). */
export function camposPermitidos(tipo: TipoCatalogo, dados: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return out;
  const lista: readonly string[] = tipo === "equipamento" ? CAMPOS_EQUIPAMENTO : CAMPOS_PROCEDIMENTO;
  for (const k of lista) {
    if (Object.prototype.hasOwnProperty.call(dados, k)) out[k] = (dados as Record<string, unknown>)[k];
  }
  return out;
}

// ── Normalização (o que se grava) ────────────────────────────────────────────

const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Linhas de especificação aparadas; linha totalmente vazia sai. */
export function normalizarEspecificacoes(v: unknown): Especificacao[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({ rotulo: normalizarEspacos(texto(x?.rotulo)), valor: texto(x?.valor).trim() }))
    .filter((x) => x.rotulo || x.valor);
}

export function normalizarFotos(v: unknown): FotoCatalogo[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => {
    const f: FotoCatalogo = { caminho: texto(x?.caminho).trim(), legenda: normalizarEspacos(texto(x?.legenda)) };
    if (typeof x?.hash === "string" && /^[0-9a-f]{64}$/.test(x.hash)) f.hash = x.hash;
    return f;
  });
}

export function normalizarTopicosLista(v: unknown): TopicoLista[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => {
    const t: TopicoLista = {
      numero: typeof x?.numero === "number" ? x.numero : Number(x?.numero),
      titulo: normalizarEspacos(texto(x?.titulo)),
      ativo: x?.ativo !== false,
    };
    if (typeof x?.titulo_origem === "string" && x.titulo_origem.trim()) t.titulo_origem = x.titulo_origem;
    return t;
  });
}

export function normalizarTopicosExtras(v: unknown): TopicoExtra[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => {
    const t: TopicoExtra = { titulo: normalizarEspacos(texto(x?.titulo)) };
    if (x?.apos !== undefined && x?.apos !== null && x?.apos !== "") t.apos = Number(x.apos);
    return t;
  });
}

export function normalizarDadosEquipamento(d: Record<string, unknown>): DadosEquipamento {
  return {
    nome: normalizarEspacos(texto(d.nome)),
    especificacoes: normalizarEspecificacoes(d.especificacoes),
    fotos: normalizarFotos(d.fotos),
  };
}

export function normalizarDadosProcedimento(d: Record<string, unknown>): DadosProcedimento {
  const eqs = Array.isArray(d.equipamentos) ? d.equipamentos : [];
  const lim = typeof d.cloro_limite_aviso === "number" ? d.cloro_limite_aviso : Number(d.cloro_limite_aviso);
  const metodos = typeof d.metodos === "string" && d.metodos.trim() ? d.metodos : null;
  const template = typeof d.template_path === "string" && d.template_path.trim() ? d.template_path.trim() : null;
  return {
    codigo: normalizarEspacos(texto(d.codigo)),
    nome: normalizarEspacos(texto(d.nome)),
    metodos,
    // Sem repetidos; o que não é texto fica para a validação recusar.
    equipamentos: eqs.filter((s, i) => typeof s !== "string" || eqs.indexOf(s) === i) as string[],
    topicos: Array.isArray(d.topicos) ? (d.topicos as number[]) : null,
    topicos_lista: normalizarTopicosLista(d.topicos_lista),
    topicos_extras: normalizarTopicosExtras(d.topicos_extras),
    template_path: template,
    limpeza_robotizada: d.limpeza_robotizada === true,
    agua_potavel: d.agua_potavel === true,
    cloro_unidade: texto(d.cloro_unidade || "mg/L"),
    cloro_limite_aviso: lim,
  };
}

// ── Caminhos no storage ──────────────────────────────────────────────────────

export function caminhoModeloValido(c: string | null | undefined): boolean {
  return !!c && c.startsWith(PASTA_MODELOS) && !c.includes("..") && /\.docx$/i.test(c) && c.length < 300;
}

/** Fotos novas vão para catalogo/fotos/; as antigas ficaram em
 *  catalogo/<slug>/ — continuam aceitas (qualquer coisa sob catalogo/ que
 *  não seja a pasta dos modelos). */
export function caminhoFotoCatalogoValido(c: string | null | undefined): boolean {
  return !!c && c.startsWith("catalogo/") && !c.startsWith(PASTA_MODELOS) && !c.includes("..")
    && /\.(png|jpe?g|webp)$/i.test(c) && c.length < 300;
}

// ── Validação ────────────────────────────────────────────────────────────────

export const ROTULOS_CATALOGO: Record<string, string> = {
  codigo: "Código", nome: "Nome", metodos: "Métodos", equipamentos: "Equipamentos previstos",
  topicos: "Tópicos", "topicos_lista.*": "Tópico", "topicos_extras.*": "Seção extra",
  topicos_lista: "Tópicos", topicos_extras: "Seções extras",
  template_path: "Modelo (.docx)", cloro_unidade: "Unidade do cloro", cloro_limite_aviso: "Limite de aviso do cloro",
  especificacoes: "Especificações", "especificacoes.*": "Especificação", fotos: "Fotos", "fotos.*": "Foto",
};

const desativadoTxt = (x: { ativo?: unknown }) =>
  ativoNoCatalogo(x) ? "" : " (desativado — reative-o em “Desativados” em vez de criar outro)";

/** Procedimento que já usa este código (pela chave), fora o próprio. */
export function codigoProcRepetido(codigo: string, procedimentos: ProcedimentoRef[] = [], id?: string | null): ProcedimentoRef | null {
  const k = chaveCodigo(codigo);
  if (!k) return null;
  return procedimentos.find((p) => p.id !== id && chaveCodigo(p.codigo) === k) || null;
}

export function nomeRepetido<T extends { id: string; nome: string }>(nome: string, itens: T[] = [], id?: string | null): T | null {
  const k = chaveNome(nome);
  if (!k) return null;
  return itens.find((p) => p.id !== id && chaveNome(p.nome) === k) || null;
}

/** Mensagem do código repetido (também a do 409). */
export function msgCodigoRepetido(p: ProcedimentoRef): string {
  return `Já existe o procedimento ${p.codigo} — ${p.nome}${desativadoTxt(p)}.`;
}
export function msgNomeProcRepetido(p: ProcedimentoRef): string {
  return `Já existe o procedimento ${p.codigo} — ${p.nome} com este nome${desativadoTxt(p)}.`;
}
export function msgNomeEquipRepetido(e: EquipamentoRef): string {
  return `Já existe o equipamento “${e.nome}”${desativadoTxt(e)}.`;
}

export interface ContextoEquipamento {
  /** Equipamento em edição (fora da checagem de repetido). */
  id?: string | null;
  /** Todos os equipamentos, ativos e desativados. undefined = não checado. */
  equipamentos?: EquipamentoRef[];
}

export function validarEquipamento(d: Partial<DadosEquipamento> & { especificacoes?: unknown; fotos?: unknown }, ctx: ContextoEquipamento = {}): ResultadoValidacao {
  const r = novoResultado();
  const nome = normalizarEspacos(d.nome);
  if (!nome) addErro(r, "nome", "Informe o nome do equipamento (ex.: Submarino para a Batimetria).");
  else if (nome.length > MAX_NOME_CATALOGO) addErro(r, "nome", `Nome muito longo (máx. ${MAX_NOME_CATALOGO} caracteres).`);
  else if (ctx.equipamentos) {
    const igual = nomeRepetido(nome, ctx.equipamentos, ctx.id);
    if (igual) addErro(r, "nome", msgNomeEquipRepetido(igual));
    else {
      ctx.equipamentos
        .filter((e) => e.id !== ctx.id && nomesParecidos(nome, e.nome, chaveNome))
        .forEach((e) => addAviso(r, "nome", `Nome parecido com “${e.nome}”${ativoNoCatalogo(e) ? "" : " (desativado)"} — confira se não é o mesmo equipamento.`));
    }
  }

  // Especificações: linha totalmente vazia é ignorada (some ao salvar).
  const specs = Array.isArray(d.especificacoes) ? d.especificacoes : [];
  if (d.especificacoes !== undefined && !Array.isArray(d.especificacoes)) addErro(r, "especificacoes", "Formato inválido.");
  const vistos = new Map<string, number>();
  specs.forEach((x: any, i: number) => {
    const rotulo = normalizarEspacos(texto(x?.rotulo));
    const valor = texto(x?.valor).trim();
    if (!rotulo && !valor) return;
    if (!rotulo) { addErro(r, `especificacoes.${i}.rotulo`, "Informe o rótulo deste valor (ex.: Profundidade máxima)."); return; }
    const k = chaveNome(rotulo);
    if (vistos.has(k)) addErro(r, `especificacoes.${i}.rotulo`, `Rótulo repetido — “${rotulo}” já está na linha ${vistos.get(k)! + 1}.`);
    else vistos.set(k, i);
  });

  const fotos = Array.isArray(d.fotos) ? d.fotos : [];
  if (d.fotos !== undefined && !Array.isArray(d.fotos)) addErro(r, "fotos", "Formato inválido.");
  const hashes = new Map<string, number>();
  const caminhos = new Set<string>();
  fotos.forEach((f: any, i: number) => {
    const c = texto(f?.caminho);
    if (!caminhoFotoCatalogoValido(c)) { addErro(r, `fotos.${i}`, "Caminho da foto inválido — envie a foto de novo."); return; }
    if (caminhos.has(c)) addErro(r, `fotos.${i}`, "Esta foto está duas vezes na lista.");
    caminhos.add(c);
    const h = typeof f?.hash === "string" ? f.hash : "";
    if (h) {
      if (hashes.has(h)) addErro(r, `fotos.${i}`, `Foto repetida — é a mesma imagem da foto ${hashes.get(h)! + 1}.`);
      else hashes.set(h, i);
    }
  });
  return r;
}

export interface ContextoProcedimento {
  id?: string | null;
  /** Todos os procedimentos, ativos e desativados. undefined = não checado. */
  procedimentos?: ProcedimentoRef[];
  /** Todos os equipamentos (para avisar slug que não existe mais). */
  equipamentos?: EquipamentoRef[];
}

/** Slugs da lista do procedimento que não existem no Catálogo. */
export function equipamentosInexistentes(slugs: unknown, equipamentos: EquipamentoRef[] = []): string[] {
  if (!Array.isArray(slugs)) return [];
  const existe = new Set(equipamentos.map((e) => e.slug));
  return slugs.filter((s): s is string => typeof s === "string" && !existe.has(s));
}

const inteiro = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

export function validarProcedimento(d: Partial<Record<keyof DadosProcedimento, unknown>>, ctx: ContextoProcedimento = {}): ResultadoValidacao {
  const r = novoResultado();
  const codigo = normalizarEspacos(texto(d.codigo));
  const nome = normalizarEspacos(texto(d.nome));

  if (!codigo) addErro(r, "codigo", "Informe o código do procedimento (ex.: PO 011). Ele identifica o procedimento na OS e no relatório.");
  else if (!chaveCodigo(codigo)) addErro(r, "codigo", "O código precisa ter letras ou números (ex.: PO 011).");
  else if (codigo.length > MAX_CODIGO) addErro(r, "codigo", `Código muito longo (máx. ${MAX_CODIGO} caracteres).`);
  else if (ctx.procedimentos) {
    const igual = codigoProcRepetido(codigo, ctx.procedimentos, ctx.id);
    if (igual) addErro(r, "codigo", msgCodigoRepetido(igual));
  }

  if (!nome) addErro(r, "nome", "Informe o nome do procedimento.");
  else if (nome.length > MAX_NOME_CATALOGO) addErro(r, "nome", `Nome muito longo (máx. ${MAX_NOME_CATALOGO} caracteres).`);
  else if (ctx.procedimentos) {
    const igual = nomeRepetido(nome, ctx.procedimentos, ctx.id);
    if (igual) addErro(r, "nome", msgNomeProcRepetido(igual));
    else {
      ctx.procedimentos
        .filter((p) => p.id !== ctx.id && nomesParecidos(nome, p.nome, chaveNome))
        .forEach((p) => addAviso(r, "nome", `Nome parecido com ${p.codigo} — ${p.nome}${ativoNoCatalogo(p) ? "" : " (desativado)"}. Confira se não é o mesmo procedimento.`));
    }
  }

  if (d.metodos != null && typeof d.metodos !== "string") addErro(r, "metodos", "Formato inválido.");

  if (d.equipamentos !== undefined) {
    if (!Array.isArray(d.equipamentos) || d.equipamentos.some((s) => typeof s !== "string" || !s)) {
      addErro(r, "equipamentos", "Lista de equipamentos inválida.");
    } else if (ctx.equipamentos) {
      equipamentosInexistentes(d.equipamentos, ctx.equipamentos).forEach((s) =>
        addAviso(r, "equipamentos", `O equipamento “${s}” não existe mais no Catálogo — remova-o da lista.`));
    }
  }

  if (d.topicos != null && (!Array.isArray(d.topicos) || d.topicos.some((n) => !inteiro(n, 0, 99)))) {
    addErro(r, "topicos", "Configuração antiga de tópicos inválida.");
  }

  // Tópicos: título obrigatório e sem repetir (lista + seções extras).
  const titulos = new Map<string, string>();
  const verTitulo = (campo: string, t: string, onde: string) => {
    if (!t) { addErro(r, campo, "Informe o título do tópico."); return; }
    if (t.length > 200) { addErro(r, campo, "Título muito longo (máx. 200 caracteres)."); return; }
    const k = chaveTitulo(t);
    if (!k) { addErro(r, campo, "Informe o título do tópico."); return; }
    if (titulos.has(k)) addErro(r, campo, `Título repetido — “${t}” já está ${titulos.get(k)}.`);
    else titulos.set(k, onde);
  };
  if (d.topicos_lista !== undefined) {
    if (!Array.isArray(d.topicos_lista)) addErro(r, "topicos_lista", "Lista de tópicos inválida.");
    else {
      const numeros = new Set<number>();
      const nums = numeracaoNoDocumento(normalizarTopicosLista(d.topicos_lista), []);
      d.topicos_lista.forEach((x: any, i: number) => {
        if (!x || typeof x !== "object") { addErro(r, `topicos_lista.${i}.titulo`, "Tópico inválido."); return; }
        if (!inteiro(x.numero, 1, 999)) addErro(r, `topicos_lista.${i}.titulo`, "Número interno do tópico inválido — importe do modelo de novo.");
        else if (numeros.has(x.numero)) addErro(r, `topicos_lista.${i}.titulo`, "Dois tópicos com o mesmo número interno — importe do modelo de novo.");
        else numeros.add(x.numero);
        if (x.ativo !== undefined && typeof x.ativo !== "boolean") addErro(r, `topicos_lista.${i}.titulo`, "Tópico inválido.");
        const n = nums.lista[i];
        verTitulo(`topicos_lista.${i}.titulo`, normalizarEspacos(texto(x.titulo)), n ? `no tópico ${n}` : `na linha ${i + 1}`);
      });
    }
  }
  if (d.topicos_extras !== undefined) {
    if (!Array.isArray(d.topicos_extras)) addErro(r, "topicos_extras", "Seções extras inválidas.");
    else d.topicos_extras.forEach((x: any, i: number) => {
      if (!x || typeof x !== "object") { addErro(r, `topicos_extras.${i}.titulo`, "Seção inválida."); return; }
      if (x.apos !== undefined && x.apos !== null && !inteiro(Number(x.apos), 0, 999)) addErro(r, `topicos_extras.${i}.titulo`, "Posição da seção inválida.");
      verTitulo(`topicos_extras.${i}.titulo`, normalizarEspacos(texto(x.titulo)), `na seção extra ${i + 1}`);
    });
  }

  if (d.template_path != null && d.template_path !== "" && !caminhoModeloValido(texto(d.template_path))) {
    addErro(r, "template_path", "Caminho do modelo inválido — envie o .docx de novo.");
  }

  if (d.cloro_unidade !== undefined && !unidadeCloroValida(d.cloro_unidade)) {
    addErro(r, "cloro_unidade", "Unidade do cloro inválida — use mg/L ou PPM.");
  }
  if (d.cloro_limite_aviso !== undefined) {
    const n = d.cloro_limite_aviso;
    if (typeof n !== "number" || !isFinite(n) || n <= 0) {
      addErro(r, "cloro_limite_aviso", "Informe um número maior que zero (ex.: 5).");
    } else if (n > CLORO_LIMITE_ALTO) {
      addAviso(r, "cloro_limite_aviso", `Limite alto (${String(n).replace(".", ",")}) — o cloro livre costuma ficar abaixo de 5. Confira se não faltou a vírgula.`);
    }
  }
  return r;
}

// ── Numeração dos tópicos no documento ───────────────────────────────────────

/** Número que cada tópico terá no DOCUMENTO — mesma conta do gerador
 *  (lib/asp/relatorio.ts): a capa não conta; tópicos desmarcados somem e os
 *  seguintes sobem; a ordem é a da lista. Seções extras antigas
 *  (topicos_extras) entram depois do tópico cujo número interno é `apos`
 *  (0 = antes de todos; sem `apos` = no fim). null = não sai no documento. */
export function numeracaoNoDocumento(
  lista: Pick<TopicoLista, "numero" | "ativo" | "titulo">[],
  extras: TopicoExtra[] = []
): { lista: (number | null)[]; extras: (number | null)[] } {
  let seq = 0;
  const nl: (number | null)[] = lista.map(() => null);
  const ne: (number | null)[] = extras.map(() => null);
  const ultimo = lista.length ? Math.max(...lista.map((t) => Number(t.numero) || 0)) : 0;
  const aposDe = (e: TopicoExtra) => Math.max(0, Math.min(ultimo, e.apos ?? ultimo));
  const emitir = (k: number) => extras.forEach((e, i) => {
    if (ne[i] === null && e.titulo?.trim() && aposDe(e) === k) ne[i] = ++seq;
  });
  emitir(0);
  lista.forEach((t, i) => {
    if (t.ativo !== false) nl[i] = ++seq;
    emitir(Number(t.numero) || 0);
  });
  extras.forEach((e, i) => { if (ne[i] === null && e.titulo?.trim()) ne[i] = ++seq; });
  return { lista: nl, extras: ne };
}

// ── Ordem ────────────────────────────────────────────────────────────────────

/** Troca o item i com o vizinho (delta -1 = sobe, +1 = desce). */
export function moverNaLista<T>(lista: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return lista;
  const n = [...lista];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

/** Ordem final pedida pela tela: os ids conhecidos na ordem pedida (sem
 *  repetir), depois os que a tela não mandou, na ordem atual. Ordem 1..N. */
export function renumerarOrdem(pedido: unknown, existentes: { id: string; ordem?: number | null }[]): { id: string; ordem: number }[] {
  const conhecidos = new Set(existentes.map((e) => e.id));
  const vistos = new Set<string>();
  const ids: string[] = [];
  (Array.isArray(pedido) ? pedido : []).forEach((id) => {
    if (typeof id === "string" && conhecidos.has(id) && !vistos.has(id)) { vistos.add(id); ids.push(id); }
  });
  [...existentes]
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .forEach((e) => { if (!vistos.has(e.id)) { vistos.add(e.id); ids.push(e.id); } });
  return ids.map((id, i) => ({ id, ordem: i + 1 }));
}

// ── Uso (renomear × excluir × desativar) ─────────────────────────────────────

export interface UsoProcedimento { oss: number; ossLixeira: number; checklists: number; rascunhos: number; relatorios: number }
export interface UsoEquipamento { procedimentos: number; checklists: number; agendamentosFuturos: number; agendamentos: number; relatorios: number }
export type UsoCatalogo = Partial<UsoProcedimento & UsoEquipamento>;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Referências que impedem a exclusão definitiva (qualquer uma). */
export function totalUso(u: UsoCatalogo | null | undefined): number {
  if (!u) return 0;
  return (u.oss || 0) + (u.ossLixeira || 0) + (u.checklists || 0) + (u.rascunhos || 0) + (u.relatorios || 0)
    + (u.procedimentos || 0) + (u.agendamentos || 0);
}

/** Item usado em algum lugar só pode ser desativado; sem uso, excluído. */
export function decisaoExclusao(u: UsoCatalogo | null | undefined): "excluir" | "desativar" {
  return totalUso(u) > 0 ? "desativar" : "excluir";
}

/** "3 OSs, 1 checklist, 2 relatórios" — onde o item é usado. */
export function textoUso(tipo: TipoCatalogo, u: UsoCatalogo | null | undefined): string {
  if (!u) return "";
  const p: string[] = [];
  if (tipo === "procedimento") {
    if (u.oss) p.push(plural(u.oss, "OS", "OSs"));
    if (u.ossLixeira) p.push(plural(u.ossLixeira, "OS na lixeira", "OSs na lixeira"));
    if (u.checklists) p.push(plural(u.checklists, "checklist", "checklists"));
    if (u.rascunhos) p.push(plural(u.rascunhos, "rascunho de relatório", "rascunhos de relatório"));
    if (u.relatorios) p.push(plural(u.relatorios, "relatório enviado", "relatórios enviados"));
  } else {
    if (u.procedimentos) p.push(plural(u.procedimentos, "procedimento", "procedimentos"));
    if (u.checklists) p.push(plural(u.checklists, "checklist", "checklists"));
    if (u.agendamentos) p.push(plural(u.agendamentos, "agendamento", "agendamentos"));
    if (u.relatorios) p.push(plural(u.relatorios, "relatório", "relatórios"));
  }
  return p.join(", ");
}

/** O que o renomear vai atualizar (texto do "confirmar"). Vazio = nada a
 *  atualizar, não precisa confirmar. */
export function textoRenomeacao(tipo: TipoCatalogo, u: UsoCatalogo | null | undefined): string {
  if (!u) return "";
  if (tipo === "procedimento") {
    const n = (u.oss || 0) + (u.ossLixeira || 0) + (u.checklists || 0) + (u.rascunhos || 0);
    if (!n) return "";
    return `${plural((u.oss || 0) + (u.ossLixeira || 0), "OS", "OSs")}, ${plural(u.checklists || 0, "checklist", "checklists")} e ` +
      `${plural(u.rascunhos || 0, "rascunho de relatório", "rascunhos de relatório")} usam este código e passarão a usar o novo.` +
      (u.relatorios ? ` ${plural(u.relatorios, "relatório já enviado/aprovado/assinado mantém", "relatórios já enviados/aprovados/assinados mantêm")} o código antigo (documento histórico).` : "");
  }
  const n = (u.checklists || 0) + (u.agendamentosFuturos || 0);
  if (!n) return "";
  return `O nome novo vai para ${plural(u.checklists || 0, "checklist", "checklists")} e ${plural(u.agendamentosFuturos || 0, "agendamento", "agendamentos")} de hoje em diante (ou a definir). ` +
    "Agendamentos passados e relatórios já gerados ficam com o nome antigo; procedimentos e relatórios apontam pelo identificador, que não muda.";
}

/** Linhas que o renomear do procedimento altera — espelho de
 *  gp_renomear_procedimento (para conferência e testes). */
export function planoRenomeacaoProcedimento(
  antigo: string, novo: string,
  linhas: {
    inspecoes?: { id: string; procedimento: string | null }[];
    checklists?: { id: string; procedimento: string | null }[];
    relatorios?: { id: string; status: string; excluido?: boolean; procedimento?: string | null }[];
  }
): { inspecoes: string[]; checklists: string[]; relatorios: string[] } {
  if (antigo === novo) return { inspecoes: [], checklists: [], relatorios: [] };
  return {
    inspecoes: (linhas.inspecoes || []).filter((x) => x.procedimento === antigo).map((x) => x.id),
    checklists: (linhas.checklists || []).filter((x) => x.procedimento === antigo).map((x) => x.id),
    relatorios: (linhas.relatorios || []).filter((x) => !x.excluido && x.status === "rascunho" && x.procedimento === antigo).map((x) => x.id),
  };
}

/** Espelho de gp_renomear_equipamento: checklists (item com o slug, OS não
 *  encerrada) e agendamentos ativos de hoje em diante ou a definir. */
export function planoRenomeacaoEquipamento(
  slug: string, antigo: string, novo: string, hoje: string,
  linhas: {
    checklists?: { id: string; encerrada?: boolean; itens: { slug?: string | null; nome: string }[] }[];
    agendamentos?: { id: string; substituido?: boolean; a_definir?: boolean; data_visita?: string | null; equipamentos: string[] }[];
  }
): { checklists: string[]; agendamentos: string[] } {
  if (antigo === novo) return { checklists: [], agendamentos: [] };
  const k = chaveNome(antigo);
  return {
    checklists: (linhas.checklists || []).filter((c) => !c.encerrada && c.itens.some((i) => i.slug === slug)).map((c) => c.id),
    agendamentos: (linhas.agendamentos || []).filter((a) =>
      !a.substituido && (a.a_definir || (!!a.data_visita && a.data_visita >= hoje))
      && a.equipamentos.some((e) => chaveNome(e) === k)
    ).map((a) => a.id),
  };
}

// ── Concorrência ─────────────────────────────────────────────────────────────

/** "Outra pessoa salvou este item às 14:05 — recarregue." (hora de Brasília) */
export function msgVersaoConflito(atualizadoEm: string | null | undefined): string {
  let hora = "";
  try {
    if (atualizadoEm) {
      hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
        .format(new Date(atualizadoEm));
    }
  } catch { /* sem hora */ }
  return `Outra pessoa salvou este item${hora ? ` às ${hora}` : ""} — recarregue para ver a versão atual (suas alterações não foram gravadas).`;
}
