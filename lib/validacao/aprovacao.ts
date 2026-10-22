/** Regras da Fase 5/9 — APROVAÇÃO do relatório da OS (inspeção na 5,
 * execução na 9) e a versão ASSINADA que vem depois. Puras: a página da OS
 * chama com o que já tem; a API (/api/inspecoes/[id]/fase e
 * /api/relatorios/[id]/assinado) repete as que bloqueiam.
 *
 *   ⛔ aprovar/reprovar sem relatório do tipo em aprovação · reprovação sem
 *      categoria · descrição com menos de 15 letras ou sem sentido ("ok",
 *      "ajustar", "....") · avaliação repetida (outro já avaliou: 409) ·
 *      versão assinada: só PDF de verdade, até 30 MB, arquivo que já está na
 *      OS, relatório não aprovado, perfil sem permissão, trocar a assinada
 *      sem ser Gerência/Admin
 *   ⚠️ mesmo motivo da reprovação anterior · quem aprova preparou/enviou o
 *      relatório · aprovar sem ter baixado ESTA versão · dados da OS mudaram
 *      depois do envio · inspeção sem medição aprovada · seguir da fase 6 sem
 *      o relatório de inspeção assinado · encerrar sem o de execução assinado */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { normalizarEspacos, normalizarTexto, semPontuacao } from "./texto";
import { ROTULO_TIPO, type TipoRelatorio } from "./relatorio";

// ── Reprovação: categoria + descrição ────────────────────────────────────────

export const CATEGORIAS_REPROVACAO = [
  { valor: "dados_incorretos", rotulo: "Dados incorretos" },
  { valor: "fotos", rotulo: "Fotos" },
  { valor: "texto", rotulo: "Texto/redação" },
  { valor: "medicao", rotulo: "Medição" },
  { valor: "formatacao", rotulo: "Formatação" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export type CategoriaReprovacao = (typeof CATEGORIAS_REPROVACAO)[number]["valor"];

export function categoriaValida(v: unknown): v is CategoriaReprovacao {
  return CATEGORIAS_REPROVACAO.some((c) => c.valor === v);
}

export function rotuloCategoria(v: string | null | undefined): string {
  return CATEGORIAS_REPROVACAO.find((c) => c.valor === v)?.rotulo || "";
}

/** "Fotos — falta a foto do fundo do tanque". Sem categoria (dados antigos),
 *  só a descrição. */
export function formatarMotivo(categoria: string | null | undefined, descricao: string | null | undefined): string {
  const cat = rotuloCategoria(categoria);
  const desc = normalizarEspacos(descricao);
  return cat && desc ? `${cat} — ${desc}` : cat || desc;
}

export const MOTIVO_MIN = 15;

/** Palavras que, sozinhas, não dizem o que ajustar. */
export const MOTIVOS_SEM_SENTIDO = new Set(["ok", "ajustar", "corrigir", "refazer", "ver", "revisar", "erro", ".", "-", "x", "teste"]);

/** Erro da descrição do motivo, ou null. */
export function erroDescricaoMotivo(descricao: string | null | undefined): string | null {
  const t = normalizarEspacos(descricao);
  if (!t) return "Descreva o que precisa ser ajustado.";
  const n = normalizarTexto(t);
  const palavras = semPontuacao(n).toLowerCase().split(" ").filter(Boolean);
  const letras = n.replace(/[^a-z0-9]/g, "");
  const semSentido = MOTIVOS_SEM_SENTIDO.has(n)
    || !letras                                              // só pontuação/símbolos
    || new Set(letras).size <= 2                            // "aaaaaa", "kkkkk", "abababab"
    || (palavras.length > 0 && palavras.every((p) => MOTIVOS_SEM_SENTIDO.has(p)));  // "ajustar ajustar ok"
  if (semSentido) return "Motivo sem sentido — diga o que está errado e o que mudar (ex.: “a foto 3 é de outro tanque”).";
  if (t.length < MOTIVO_MIN) return `Descreva melhor o ajuste (mínimo ${MOTIVO_MIN} caracteres; tem ${t.length}).`;
  return null;
}

/** Mesma descrição (normalizada) da reprovação anterior do mesmo tipo. */
export function motivoRepetido(descricao: string | null | undefined, anterior: string | null | undefined): boolean {
  const a = semPontuacao(normalizarTexto(descricao)).toLowerCase();
  const b = semPontuacao(normalizarTexto(anterior)).toLowerCase();
  return !!a && a === b;
}

/** Categoria + descrição da reprovação. `anterior` = motivo (descrição) da
 *  última reprovação do mesmo relatório (OS + tipo), para o aviso. */
export function validarReprovacao(e: {
  categoria: string | null | undefined;
  descricao: string | null | undefined;
  anterior?: { descricao: string | null; versao?: number } | null;
}): ResultadoValidacao {
  const r = novoResultado();
  if (!e.categoria) addErro(r, "categoria", "Escolha a categoria do ajuste.");
  else if (!categoriaValida(e.categoria)) addErro(r, "categoria", "Categoria inválida.");
  const erro = erroDescricaoMotivo(e.descricao);
  if (erro) addErro(r, "motivo", erro);
  else if (e.anterior && motivoRepetido(e.descricao, e.anterior.descricao)) {
    addAviso(r, "motivo", `Mesmo motivo da reprovação anterior${e.anterior.versao ? ` (v${e.anterior.versao})` : ""} — o ajuste pedido não foi feito? Se for outro problema, descreva-o.`);
  }
  return r;
}

export const ROTULOS_REPROVACAO: Record<string, string> = { categoria: "Categoria", motivo: "Motivo" };

// ── Qual relatório está sendo avaliado ───────────────────────────────────────

/** Fase em que o relatório do tipo é aprovado. */
export function faseAprovacao(tipo: string): number {
  return tipo === "execucao" ? 9 : 5;
}

export interface LinhaAvaliacao { id: string; versao: number; status: string }

/** Escolhe o relatório que aprovar/reprovar vai mudar. ⛔ sem nenhum em
 *  aprovação; ⛔ o mostrado na tela não está mais em aprovação (409); ⛔ mais
 *  de um e a tela não disse qual (409). */
export function escolherRelatorioAvaliado(
  emAprovacao: LinhaAvaliacao[], relatorioId: string | null | undefined, tipo: string
): { alvo: LinhaAvaliacao } | { erro: string; status: 400 | 409; jaAvaliado?: boolean } {
  const rotulo = ROTULO_TIPO[tipo as TipoRelatorio] || tipo;
  if (relatorioId) {
    const alvo = emAprovacao.find((r) => r.id === relatorioId);
    if (alvo) return { alvo };
    return { erro: "Este relatório não está mais em aprovação (foi avaliado ou substituído). Recarregue a página.", status: 409, jaAvaliado: true };
  }
  if (emAprovacao.length === 0) {
    return { erro: `Nenhum relatório de ${rotulo} em aprovação nesta OS — não há o que avaliar. Operações precisa enviar o relatório.`, status: 400 };
  }
  if (emAprovacao.length > 1) {
    return {
      erro: `Há ${emAprovacao.length} versões em aprovação (${emAprovacao.map((r) => `v${r.versao}`).join(", ")}). Recarregue a página e avalie a versão mostrada.`,
      status: 409,
    };
  }
  return { alvo: emAprovacao[0] };
}

/** "dd/mm/aaaa hh:mm" no fuso de Brasília. */
export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** Mensagem do 409 quando outro clique/usuário já avaliou ou moveu a OS. */
export function mensagemJaAvaliado(e: { acao?: string | null; nome?: string | null; em?: string | null; faseAtual?: number | null }): string {
  const quem = e.nome ? ` por ${e.nome}` : "";
  const quando = e.em ? ` em ${dataHoraBr(e.em)}` : "";
  const verbo = e.acao === "aprovar" ? "Já aprovado" : e.acao === "reprovar" ? "Já reprovado" : e.acao === "avancar" ? "Esta OS já foi movida" : "Já avaliado";
  const fase = e.faseAtual ? ` (agora na fase ${e.faseAtual})` : "";
  return `${verbo}${quem}${quando}${fase}. Recarregue a página.`;
}

// ── Avisos ao aprovar ────────────────────────────────────────────────────────

/** Relatório como a página da OS o conhece. */
export interface RelatorioAprovacao {
  id: string;
  tipo: string;
  versao: number;
  enviado_por?: string | null;
  enviado_em?: string | null;
  dados?: { pessoas?: Record<string, string | undefined>; d?: Record<string, any>; coletaId?: string } | null;
}

/** Coleta (medição) como a página da OS a conhece. */
export interface ColetaMudanca {
  id: string;
  tipo?: string;
  rotulo?: string;
  criado_em?: string | null;
  atualizado_em?: string | null;
  aprovada_em?: string | null;
  aprovacao_retirada_em?: string | null;
}

export interface ContextoMudancas {
  enviadoEm: string | null | undefined;
  tipo: string;
  /** Snapshot do formulário (relatório gerado), se houver. */
  dados?: RelatorioAprovacao["dados"];
  /** Valores do cadastro hoje (mesmos campos que o relatório tira dele). */
  cadastroAtual?: Partial<Record<"cliente" | "endereco" | "tag" | "procedimento" | "codigoProjeto", string>>;
  /** gp_inspecoes.cadastro_atualizado_em (TAG, procedimento, tanque). */
  cadastroOSEm?: string | null;
  projetoEm?: string | null;
  clienteEm?: string | null;
  coletas?: ColetaMudanca[];
  /** gp_fotos_execucao.atualizado_em (só conta no relatório de execução). */
  fotosExecucaoEm?: string | null;
}

const ROT_CADASTRO: Record<string, string> = {
  cliente: "Cliente", endereco: "Endereço", tag: "TAG", procedimento: "Procedimento", codigoProjeto: "Código do projeto",
};

const depois = (iso: string | null | undefined, ref: string) => !!iso && new Date(iso).getTime() > new Date(ref).getTime();

/** O que mudou na OS depois que ESTA versão foi enviada (melhor esforço):
 *  campos do cadastro diferentes do snapshot, cadastro da OS/tanque, projeto,
 *  cliente, medições (nova, editada, aprovada, aprovação retirada, a usada
 *  excluída) e fotos da execução. Lista em texto, para o aviso. */
export function mudancasDesdeEnvio(c: ContextoMudancas): string[] {
  const out: string[] = [];
  const env = c.enviadoEm;
  if (!env || isNaN(new Date(env).getTime())) return out;
  const d = c.dados?.d || {};
  if (c.cadastroAtual && c.dados?.d) {
    for (const [k, atual] of Object.entries(c.cadastroAtual)) {
      if (!(k in d)) continue;
      if (normalizarTexto(String(d[k] ?? "")) !== normalizarTexto(atual || "")) {
        out.push(`${ROT_CADASTRO[k] || k}: no relatório “${d[k] || "vazio"}”, hoje “${atual || "vazio"}”.`);
      }
    }
  }
  if (depois(c.cadastroOSEm, env)) out.push(`Cadastro da OS (TAG, procedimento ou tanque) alterado em ${dataHoraBr(c.cadastroOSEm)}.`);
  if (depois(c.projetoEm, env)) out.push(`Dados do projeto alterados em ${dataHoraBr(c.projetoEm)}.`);
  if (depois(c.clienteEm, env)) out.push(`Cadastro do cliente alterado em ${dataHoraBr(c.clienteEm)}.`);
  const coletas = c.coletas || [];
  const usadaId = c.dados?.coletaId;
  if (usadaId && !coletas.some((x) => x.id === usadaId)) out.push("A medição usada no relatório foi excluída.");
  for (const x of coletas) {
    const nome = x.rotulo || (x.tipo === "anexo" ? "Anexo" : "Medição");
    if (depois(x.criado_em, env)) { out.push(`${nome} registrada em ${dataHoraBr(x.criado_em)}.`); continue; }
    if (depois(x.aprovacao_retirada_em, env)) { out.push(`${nome}: aprovação retirada (editada) em ${dataHoraBr(x.aprovacao_retirada_em)}.`); continue; }
    if (depois(x.aprovada_em, env)) { out.push(`${nome} aprovada em ${dataHoraBr(x.aprovada_em)}.`); continue; }
    if (depois(x.atualizado_em, env)) out.push(`${nome} alterada em ${dataHoraBr(x.atualizado_em)}.`);
  }
  if (c.tipo === "execucao" && depois(c.fotosExecucaoEm, env)) {
    out.push(`Fotos da execução alteradas em ${dataHoraBr(c.fotosExecucaoEm)}.`);
  }
  return out;
}

/** Quem aprova preparou (snapshot) ou enviou o relatório? Devolve o papel. */
export function papelDoAprovador(usuarioId: string | null | undefined, rel: RelatorioAprovacao): string | null {
  if (!usuarioId) return null;
  const p = rel.dados?.pessoas || {};
  if (p.preparadoPor === usuarioId) return "preparou";
  if (p.elaboradoPor === usuarioId) return "elaborou";
  if (rel.enviado_por === usuarioId) return "enviou";
  return null;
}

/** Avisos ao aprovar ESTA versão (nenhum bloqueia). */
export function avisosAprovacao(e: {
  usuarioId: string | null | undefined;
  relatorio: RelatorioAprovacao;
  baixou: boolean;
  temMedicaoAprovada: boolean;
  mudancas: string[];
}): ResultadoValidacao {
  const r = novoResultado();
  const v = `v${e.relatorio.versao}`;
  const papel = papelDoAprovador(e.usuarioId, e.relatorio);
  if (papel) addAviso(r, "mesmaPessoa", `Você ${papel} este relatório (${v}) — o ideal é outra pessoa aprovar.`);
  if (!e.baixou) addAviso(r, "naoBaixou", `Você ainda não abriu/baixou o arquivo da ${v}.`);
  if (e.mudancas.length) addAviso(r, "mudancas", `Dados da OS mudaram depois do envio da ${v}: ${e.mudancas.join(" ")}`);
  if (e.relatorio.tipo === "inspecao" && !e.temMedicaoAprovada) {
    addAviso(r, "semMedicao", "Nenhuma medição aprovada nesta OS — o relatório de inspeção usou medição sem validação (ou nenhuma).");
  }
  return r;
}

// ── Versão assinada ──────────────────────────────────────────────────────────

/** Quem envia a versão assinada (o documento final, devolvido pelo cliente
 *  ou assinado pela Gerência). */
export const PERFIS_ASSINADO = ["admin", "comercial", "gerencia"];
/** Quem pode TROCAR uma versão assinada já enviada. */
export const PERFIS_TROCAR_ASSINADO = ["admin", "gerencia"];

/** Pasta + nome do arquivo assinado: relatorios/<OS>/<tipo>-assinado-<uuid>.pdf */
export function caminhoAssinadoValido(caminho: string | null | undefined, inspecaoId: string, tipo: string): boolean {
  if (!caminho || caminho.includes("..")) return false;
  const re = new RegExp(`^relatorios/${inspecaoId.replace(/[^0-9a-f-]/gi, "")}/${tipo === "execucao" ? "execucao" : "inspecao"}-assinado-[0-9a-f-]{36}\\.pdf$`, "i");
  return re.test(caminho);
}

/** Pode enviar a versão assinada deste relatório agora? null = pode. */
export function erroEnvioAssinado(e: {
  perfil: string | null | undefined; status: string; tipo: string; fase: number; substituir?: boolean;
}): string | null {
  if (!PERFIS_ASSINADO.includes(e.perfil || "")) return "A versão assinada é enviada pelo Comercial, Gerência ou Admin.";
  if (e.fase < faseAprovacao(e.tipo)) return `A OS ainda não passou pela aprovação do relatório de ${ROTULO_TIPO[e.tipo as TipoRelatorio] || e.tipo} (fase ${faseAprovacao(e.tipo)}).`;
  if (e.status === "assinado") {
    if (!e.substituir) return "Este relatório já tem versão assinada.";
    if (!PERFIS_TROCAR_ASSINADO.includes(e.perfil || "")) return "Só Gerência ou Admin podem trocar a versão assinada.";
    return null;
  }
  if (e.status !== "aprovado") return "Só um relatório aprovado recebe a versão assinada.";
  return null;
}

/** Avisos ao mover a OS (nunca bloqueiam): fase 6 → 7 sem o relatório de
 *  inspeção assinado (se houve um aprovado); chegar à fase 10 sem o de
 *  execução assinado. `rels` = relatórios ativos da OS. */
export function avisosAssinatura(fase: number, acao: string, rels: { tipo: string; status: string; versao: number }[]): string[] {
  const out: string[] = [];
  const doTipo = (t: string) => rels.filter((r) => r.tipo === t);
  if (fase === 6 && acao === "avancar") {
    const insp = doTipo("inspecao");
    const aprovado = insp.find((r) => r.status === "aprovado");
    if (aprovado && !insp.some((r) => r.status === "assinado")) {
      out.push(`O relatório de inspeção aprovado (v${aprovado.versao}) ainda não tem a versão assinada.`);
    }
  }
  if ((fase === 9 && acao === "aprovar") || (fase >= 9 && acao === "avancar")) {
    if (!doTipo("execucao").some((r) => r.status === "assinado")) {
      out.push("A OS vai para o Encerramento sem a versão assinada do relatório de execução — envie-a depois em Relatórios (“Enviar versão assinada”).");
    }
  }
  return out;
}
