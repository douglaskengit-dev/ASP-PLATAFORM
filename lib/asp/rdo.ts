/**
 * RDO — Registro Diário de Operação.
 *
 * Um RDO por PROJETO por DIA (pode cobrir mais de uma inspeção/tanque: um dia
 * limpando dois tanques é um RDO só), numerado por projeto (nº 001, 002…).
 * Preenchido no bloco de Execução e entregue ao cliente como .docx — é um
 * documento separado, NÃO entra no Relatório de Execução.
 *
 * Aqui ficam as regras puras (texto das atividades, frase do cloro,
 * numeração, condições do tempo, validação) e a geração do .docx a partir do
 * modelo em branco /templates/rdo-asp.docx, com a mesma técnica do relatório
 * (lib/asp/relatorio.ts): abre o ZIP com JSZip e troca os marcadores no XML,
 * preservando logo, cabeçalho, rodapé e a formatação das tabelas.
 *
 * Marcadores do modelo (cada um num run só):
 *   cabeçalho  {codigo_projeto}
 *   corpo      {cliente} {responsavel} {projeto} {data} {equipamentos}
 *              {tempo_manha} {tempo_tarde} {tempo_noite}
 *              {ass_asp_nome} {ass_asp_cargo} {ass_cli_nome} {ass_cli_cargo}
 *   linhas     {equipe_nome}/{equipe_funcao} · {atv_num}/{atv_texto} ·
 *              {fisc_num}/{fisc_texto} · {ddsms_num}/{ddsms_texto}
 *              — a linha da tabela que tem o marcador é clonada por item.
 */

import {
  addAviso, addErro, novoResultado, type ResultadoValidacao,
} from "../validacao/resultado";
import { duplicadosEmLista, normalizarNome, normalizarTexto, semPontuacao } from "../validacao/texto";
import { UNIDADE_CLORO_PADRAO, unidadeCloroValida, type UnidadeCloro } from "./fotos-execucao";

// ── Tipos ────────────────────────────────────────────────────────────────────

export const CONTRATADA = "ASP Serviços Industriais Ltda.";
export const MODELO_RDO = "/templates/rdo-asp.docx";

/** Funções sugeridas na equipe (texto livre — a lista só ajuda a digitar). */
export const FUNCOES_RDO = [
  "Coordenador de operações",
  "Engenheiro de operações",
  "Técnico de operações",
  "Auxiliar de operações",
];

export type Tempo = "bom" | "nublado" | "chuvoso";
/** null = período não trabalhado (a operação às vezes cobre só 1 ou 2 turnos). */
export type TempoRdo = { manha: Tempo | null; tarde: Tempo | null; noite: Tempo | null };
export const PERIODOS: { id: keyof TempoRdo; rotulo: string }[] = [
  { id: "manha", rotulo: "Manhã" }, { id: "tarde", rotulo: "Tarde" }, { id: "noite", rotulo: "Noite" },
];
export const OPCOES_TEMPO: { id: Tempo; rotulo: string }[] = [
  { id: "bom", rotulo: "Bom" }, { id: "nublado", rotulo: "Nublado" }, { id: "chuvoso", rotulo: "Chuvoso" },
];

export interface MembroRdo { nome: string; funcao: string }
export interface AssinaturaRdo { nome: string; cargo: string }

export interface AtividadeRdo {
  /** "HH:MM" */
  inicio: string;
  /** "HH:MM" — com fim, sai "08:00h às 09:00h …". */
  fim?: string;
  texto: string;
  /** Amostra de água: o cloro livre gera a frase da CVS 6 sozinho (na
   *  unidade do procedimento — DadosRdo.cloroUnidade). */
  momento?: "antes" | "depois" | null;
  cloro?: number | null;
  /** pH medido na amostra (0–14) — sai na frase como "pH 7,2". */
  ph?: number | null;
  /** OS (tanque) da amostra — só precisa quando o RDO cobre mais de uma OS. */
  inspecaoId?: string | null;
}

/** Conteúdo do RDO (coluna `dados` de gp_rdos). Data e inspeções cobertas
 *  são colunas próprias — é por elas que a unicidade e a busca funcionam. */
export interface DadosRdo {
  codigoProjeto: string;
  cliente: string;
  /** Contato do cliente ("Responsável:"). */
  responsavel: string;
  /** Descrição do serviço ("Projeto:"), ex.: "Limpeza em Tanque de água potável (VRO)". */
  descricao: string;
  equipe: MembroRdo[];
  tempo: TempoRdo;
  equipamentos: string;
  atividades: AtividadeRdo[];
  fiscalizacao: string[];
  ddsms: string[];
  assinaturaAsp: AssinaturaRdo;
  assinaturaCliente: AssinaturaRdo;
  /** Unidade do cloro livre (Catálogo → procedimento da OS). Ausente nos
   *  RDOs antigos: vale o padrão (mg/L). */
  cloroUnidade?: UnidadeCloro;
}

export interface RegistroRdo {
  id: string;
  projeto_id: string;
  /** "aaaa-mm-dd" */
  data: string;
  numero: number;
  inspecoes: string[];
  dados: DadosRdo;
  arquivo_path: string | null;
  arquivo_em: string | null;
  criado_em: string;
  atualizado_em: string;
  autor?: { nome_completo: string | null } | null;
}

export function dadosRdoVazio(): DadosRdo {
  return {
    codigoProjeto: "", cliente: "", responsavel: "", descricao: "",
    equipe: [], tempo: { manha: null, tarde: null, noite: null },
    equipamentos: "", atividades: [], fiscalizacao: [], ddsms: [],
    assinaturaAsp: { nome: "", cargo: "" }, assinaturaCliente: { nome: "", cargo: "" },
  };
}

/** Dados salvos podem vir incompletos (versão anterior, fila offline):
 *  completa com os padrões para a tela nunca quebrar. */
export function normalizarDadosRdo(d: Partial<DadosRdo> | null | undefined): DadosRdo {
  const v = dadosRdoVazio();
  const x = (d && typeof d === "object" ? d : {}) as Partial<DadosRdo>;
  const txt = (s: unknown) => (typeof s === "string" ? s : "");
  const tempo = (t: unknown): Tempo | null => (t === "bom" || t === "nublado" || t === "chuvoso" ? t : null);
  const num = (n: unknown): number | null => (n != null && n !== "" && isFinite(Number(n)) ? Number(n) : null);
  return {
    codigoProjeto: txt(x.codigoProjeto), cliente: txt(x.cliente),
    responsavel: txt(x.responsavel), descricao: txt(x.descricao),
    equipe: Array.isArray(x.equipe) ? x.equipe.map((m) => ({ nome: txt(m?.nome), funcao: txt(m?.funcao) })) : v.equipe,
    tempo: { manha: tempo(x.tempo?.manha), tarde: tempo(x.tempo?.tarde), noite: tempo(x.tempo?.noite) },
    equipamentos: txt(x.equipamentos),
    atividades: Array.isArray(x.atividades) ? x.atividades.map((a) => ({
      inicio: txt(a?.inicio), fim: txt(a?.fim) || undefined, texto: txt(a?.texto),
      momento: a?.momento === "antes" || a?.momento === "depois" ? a.momento : null,
      cloro: num(a?.cloro),
      ph: num(a?.ph),
      inspecaoId: typeof a?.inspecaoId === "string" && a.inspecaoId ? a.inspecaoId : null,
    })) : v.atividades,
    fiscalizacao: Array.isArray(x.fiscalizacao) ? x.fiscalizacao.map(txt) : v.fiscalizacao,
    ddsms: Array.isArray(x.ddsms) ? x.ddsms.map(txt) : v.ddsms,
    assinaturaAsp: { nome: txt(x.assinaturaAsp?.nome), cargo: txt(x.assinaturaAsp?.cargo) },
    assinaturaCliente: { nome: txt(x.assinaturaCliente?.nome), cargo: txt(x.assinaturaCliente?.cargo) },
    ...(unidadeCloroValida(x.cloroUnidade) ? { cloroUnidade: x.cloroUnidade } : {}),
  };
}

// ── Regras de texto ──────────────────────────────────────────────────────────

/** Mínimo de cloro livre para consumo humano (comunicado CVS 6): 0,2 mg/L =
 *  0,2 PPM (em água, as duas unidades são a mesma medida). */
export const CLORO_MINIMO = 0.2;

/** 0.24 → "0,24" (sempre duas casas, vírgula decimal). */
export function numeroPpm(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
}

/** Frase do cloro livre — GERADA, nunca digitada, para o texto não poder
 *  contradizer o valor (nos RDOs antigos havia "0,24 PPM … abaixo do mínimo").
 *  Compara o valor já arredondado, o mesmo que sai escrito. */
export function fraseCloro(valor: number, unidade: UnidadeCloro = UNIDADE_CLORO_PADRAO): string {
  const arred = Math.round(valor * 100) / 100;
  const situacao = arred >= CLORO_MINIMO ? "dentro do" : "abaixo do";
  return `(Obs: na amostra coletada, foi encontrado o valor de ${numeroPpm(valor)} ${unidade} de cloro livre ` +
    `no reservatório, que está ${situacao} mínimo estipulado pelo comunicado CVS 6 de 0,2 ${unidade} para consumo humano.)`;
}

/** pH com uma casa: 7.24 → "7,2". */
export function numeroPh(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
}

/** Remove uma frase de cloro digitada à mão (ou colada de um RDO antigo):
 *  quando há valor, a frase oficial é a gerada. */
export function semFraseCloro(texto: string): string {
  return texto.replace(/\s*\(?\s*Obs:\s*na amostra coletada[\s\S]*?consumo humano\.?\)?/gi, "").trim();
}

/** "HH:MM" válido (00:00–23:59). */
export function horaValida(h: string | undefined | null): boolean {
  return !!h && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

/** Texto de uma linha de "Detalhamento dos Serviços Realizados":
 *  "08:10h texto" ou "12:00h às 13:00h texto", + frase do cloro. */
export function textoAtividade(a: AtividadeRdo, unidade: UnidadeCloro = UNIDADE_CLORO_PADRAO): string {
  const quando = a.fim ? `${a.inicio}h às ${a.fim}h` : `${a.inicio}h`;
  const temCloro = a.cloro != null && isFinite(a.cloro);
  const temPh = a.momento && a.ph != null && isFinite(a.ph);
  const corpo = temCloro ? semFraseCloro(a.texto) : a.texto.trim();
  return [quando, corpo, temPh ? `(pH ${numeroPh(a.ph as number)})` : "", temCloro ? fraseCloro(a.cloro as number, unidade) : ""]
    .filter(Boolean).join(" ");
}

/** Numeração das linhas: 01, 02, … */
export function numeroLinha(i: number): string {
  return String(i + 1).padStart(2, "0");
}

/** Número do RDO no projeto: 1 → "001". */
export function numeroRdo(n: number): string {
  return String(n).padStart(3, "0");
}

/** Ordena por horário de início, mantendo a ordem relativa dos empates e
 *  deixando por último as linhas sem horário. */
export function ordenarAtividades(lista: AtividadeRdo[]): AtividadeRdo[] {
  return lista
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const hx = horaValida(x.a.inicio) ? x.a.inicio : "99:99";
      const hy = horaValida(y.a.inicio) ? y.a.inicio : "99:99";
      return hx === hy ? x.i - y.i : hx < hy ? -1 : 1;
    })
    .map((x) => x.a);
}

/** "Manhã: (x) Bom ( ) Nublado ( ) Chuvoso" — período não trabalhado sai
 *  com as três opções em branco. */
export function linhaTempo(rotulo: string, t: Tempo | null): string {
  return `${rotulo}: ` + OPCOES_TEMPO.map((o) => `(${o.id === t ? "x" : " "}) ${o.rotulo}`).join(" ");
}

/** Função do cadastro do usuário (Coordenador/Engenheiro/Técnico) → função
 *  usada no RDO. Sem função cadastrada, fica em branco para escolher. */
export function funcaoDoPerfil(funcao?: string | null): string {
  const f = (funcao || "").trim().toLowerCase();
  if (f.startsWith("coord")) return "Coordenador de operações";
  if (f.startsWith("eng")) return "Engenheiro de operações";
  if (f.startsWith("t")) return "Técnico de operações";
  if (f.startsWith("aux")) return "Auxiliar de operações";
  return "";
}

/** Assinatura padrão da ASP: o primeiro Coordenador da equipe, senão o primeiro. */
export function assinanteAspPadrao(equipe: MembroRdo[]): AssinaturaRdo {
  const validos = equipe.filter((m) => m.nome.trim());
  const m = validos.find((x) => /coordenador/i.test(x.funcao)) || validos[0];
  return m ? { nome: m.nome.trim(), cargo: m.funcao.trim() } : { nome: "", cargo: "" };
}

/** Frases de inserção rápida. `{cliente}` vira o nome do cliente. */
export interface FraseRapida {
  rotulo: string;
  texto: string;
  inicio?: string;
  fim?: string;
  momento?: "antes" | "depois";
}
export const FRASES_RAPIDAS: FraseRapida[] = [
  { rotulo: "Chegada", texto: "Equipe ASP chega ao site da {cliente}." },
  { rotulo: "Liberação da PT", texto: "Liberação da permissão de trabalho (PT)." },
  { rotulo: "Início mobilização", texto: "Início da mobilização dos equipamentos ASP." },
  { rotulo: "Fim mobilização", texto: "Fim da mobilização dos equipamentos ASP." },
  { rotulo: "Almoço", texto: "Parada para o almoço.", inicio: "12:00", fim: "13:00" },
  { rotulo: "Coleta de água (antes)", momento: "antes",
    texto: "Equipe ASP realiza coleta de amostra de água oriunda do tanque antes da operação de limpeza para análise microbiológica, cloro livre, pH e temperatura." },
  { rotulo: "Coleta de água (após)", momento: "depois",
    texto: "Equipe ASP realiza coleta de amostra de água oriunda do tanque após a operação de limpeza para análise microbiológica, cloro livre, pH e temperatura." },
  { rotulo: "Início desmobilização", texto: "Início da desmobilização dos equipamentos ASP." },
  { rotulo: "Fim desmobilização", texto: "Fim da desmobilização dos equipamentos ASP." },
  { rotulo: "Saída", texto: "Equipe ASP deixa o site da {cliente}." },
];

export function textoDaFrase(f: FraseRapida, cliente: string): string {
  const nome = cliente.trim() || "cliente";
  // "… site da Fulano Ltda.." → um ponto só quando a razão social já termina em ponto.
  return f.texto.replace(/\{cliente\}(\.?)/g, (_, ponto: string) => (nome.endsWith(".") ? nome : nome + ponto));
}

// ── Datas, nomes e caminhos ──────────────────────────────────────────────────

/** "2026-09-25" → "25/09/2026" */
export function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
}

/** "aaaa-mm-dd" de hoje no fuso do aparelho (não em UTC: às 22h ainda é hoje). */
export function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dataIsoValida(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Nome do arquivo no padrão dos RDOs da ASP: "Guardian - VRO - 25.09.26.docx".
 *  Cliente = primeira palavra da razão social; descrição curta = o que está
 *  entre parênteses no fim da descrição do serviço ("(VRO)"), senão "RDO". */
export function nomeArquivoRdo(d: Pick<DadosRdo, "cliente" | "descricao">, data: string): string {
  const limpar = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const cliente = limpar((d.cliente || "").split(/\s+/)[0] || "") || "Cliente";
  const curta = limpar((/\(([^()]{1,30})\)\s*\.?\s*$/.exec(d.descricao || "") || [])[1] || "") || "RDO";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || "");
  const quando = m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : "sem data";
  return `${cliente} - ${curta} - ${quando}.docx`;
}

/** Caminho no bucket gp-arquivos. */
export function caminhoRdo(projetoId: string, numero: number, data: string): string {
  return `rdos/${projetoId}/RDO-${numeroRdo(numero)}-${data}.docx`;
}

/** O .docx foi gerado depois da última alteração dos dados? */
export function arquivoEmDia(r: Pick<RegistroRdo, "arquivo_path" | "arquivo_em" | "atualizado_em">): boolean {
  if (!r.arquivo_path || !r.arquivo_em) return false;
  return new Date(r.arquivo_em).getTime() >= new Date(r.atualizado_em).getTime();
}

/** Resumo da seção recolhida: "3 RDOs · último 25/09". */
export function resumoRdos(rdos: Pick<RegistroRdo, "data">[]): string {
  if (rdos.length === 0) return "Nenhum RDO";
  const ultimo = rdos.map((r) => r.data).sort().pop() || "";
  return `${rdos.length} RDO${rdos.length === 1 ? "" : "s"} · último ${dataBr(ultimo).slice(0, 5)}`;
}

// ── Validação ────────────────────────────────────────────────────────────────
//
// Fase 7 — o RDO não pode ficar ambíguo nem duplicado. Puro: o formulário
// (Rdos.tsx) e a API (/api/rdos POST/PATCH) chamam a mesma função.
//
//   ⛔ que impedem até SALVAR (`bloqueios`; a API recusa igual): a mesma
//      pessoa duas vezes na equipe · atividade repetida (mesmo horário e
//      texto) · ordem impossível (sai do site antes de chegar; fim da
//      (des)mobilização antes do início; amostra "depois" antes da "antes" no
//      mesmo tanque) · assinante do cliente é da equipe ASP · data no futuro
//      (Brasília) · pH fora de 0–14 · cloro negativo
//   ⛔ que impedem só GERAR o .docx (`erros`): o que ainda falta preencher
//   ⚠️ avisos: frase de "uma vez por dia" repetida · duas amostras antes (ou
//      depois) no mesmo tanque / amostra sem OS quando há várias · equipamento
//      repetido · linha repetida na fiscalização/DDSMS · horários sobrepostos ·
//      atividade antes da chegada / depois da saída · período sem tempo
//      informado · horário no texto diferente do campo · pH/cloro citados sem
//      valor · mesma pessoa com outra função em outro RDO · data fora do
//      período da execução · OS já encerrada (fase 10) · cloro diferente da
//      coleta de fotos

/** O que o formulário/API sabem de cada OS coberta. */
export interface OsRdo {
  nome: string;
  fase?: number | null;
  /** Período do agendamento de execução ativo (Fase 6). */
  periodo?: { inicio: string; fim: string } | null;
  /** Cloro medido na coleta de fotos da execução. */
  cloroColeta?: { antes: number | null; depois: number | null } | null;
}

export interface ContextoRdo {
  /** "Hoje" em Brasília (hojeBrasil). Sem ele, a data futura não é checada. */
  hoje?: string;
  oss?: Record<string, OsRdo>;
  /** Outros RDOs do projeto (função divergente da mesma pessoa). */
  outros?: { numero: number; data: string; equipe: MembroRdo[] }[];
}

export interface ValidacaoRdo {
  /** ⛔ impedem gerar o arquivo (inclui os bloqueios). */
  erros: string[];
  /** ⛔ impedem até salvar — a API recusa do mesmo jeito. */
  bloqueios: string[];
  avisos: string[];
  /** As mesmas mensagens por campo, para mostrar junto de cada um:
   *  "data", "inspecoes", "equipe", "equipe.N.nome", "equipe.N.funcao",
   *  "tempo", "equipamentos", "atividades", "atividades.N",
   *  "atividades.N.texto", "atividades.N.cloro", "atividades.N.ph",
   *  "atividades.N.os", "fiscalizacao.N", "ddsms.N", "responsavel",
   *  "descricao", "assinaturaAsp", "assinaturaCliente". */
  r: ResultadoValidacao;
}

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Texto para comparar: sem acento/caixa/pontuação. */
const chaveTexto = (s: string) => semPontuacao(normalizarTexto(s)).toLowerCase();

/** Período do dia de um horário: manhã 05:00–11:59, tarde 12:00–17:59,
 *  noite 18:00–04:59. */
export function periodoDoHorario(h: string): keyof TempoRdo {
  const m = minutos(h);
  return m >= 300 && m < 720 ? "manha" : m >= 720 && m < 1080 ? "tarde" : "noite";
}

/** Períodos que uma atividade toca (a de intervalo pode passar por vários). */
export function periodosDaAtividade(a: Pick<AtividadeRdo, "inicio" | "fim">): (keyof TempoRdo)[] {
  if (!horaValida(a.inicio)) return [];
  const ini = minutos(a.inicio);
  let fim = a.fim && horaValida(a.fim) ? minutos(a.fim) : ini;
  if (fim < ini) fim += 1440;                       // passa da meia-noite
  const out = new Set<keyof TempoRdo>([periodoDoHorario(a.inicio)]);
  for (let t = ini; t < fim; t += 15) out.add(periodoDoHorario(hhmm(t)));
  if (fim > ini) out.add(periodoDoHorario(hhmm(fim - 1)));
  return Array.from(out);
}

/** Frases que só acontecem uma vez por dia (as das frases rápidas). */
export const FRASES_UNICAS: { id: string; rotulo: string; re: RegExp }[] = [
  { id: "chegada", rotulo: "chegada ao site", re: /\bchegam? (?:ao|no) site\b/ },
  { id: "saida", rotulo: "saída do site", re: /\bdeixam? o site\b/ },
  { id: "pt", rotulo: "liberação da PT", re: /\bliberacao da (?:pt|permissao de trabalho)\b/ },
  { id: "mob_ini", rotulo: "início da mobilização", re: /\binicio da mobilizacao\b/ },
  { id: "mob_fim", rotulo: "fim da mobilização", re: /\bfim da mobilizacao\b/ },
  { id: "desmob_ini", rotulo: "início da desmobilização", re: /\binicio da desmobilizacao\b/ },
  { id: "desmob_fim", rotulo: "fim da desmobilização", re: /\bfim da desmobilizacao\b/ },
];

/** Famílias de "frase única" que o texto contém. */
export function frasesUnicasDoTexto(texto: string): string[] {
  const t = chaveTexto(semFraseCloro(texto));
  return FRASES_UNICAS.filter((f) => f.re.test(t)).map((f) => f.id);
}

// ── Horário escrito dentro do texto ──────────────────────────────────────────

export interface HoraNoTexto {
  /** "HH:MM" */
  hora: string;
  /** Trecho a remover (com o "às"/"das" da frente), em posições do texto. */
  ini: number;
  fim: number;
}

const PALAVRAS_DURACAO = /^(durante|por|cerca|aproximadamente|aprox|levou|levaram|demorou|duracao|mais|total|apos)$/;

/** "08:30h", "8:30", "8h30", "8h30min", "às 9h", "das 8h", "9:05". Um "2h"
 *  ou "1h30" depois de "durante"/"por"/"cerca de" é duração, não horário;
 *  "Hh" sem "às/das/até" só conta no começo do texto. */
export function horariosNoTexto(texto: string): HoraNoTexto[] {
  const re = /(^|[\s(,;])((?:(?:[àáa]s|das|at[ée]|a partir das)\s+)?)(([01]?\d|2[0-3])(?::([0-5]\d)(?:\s?h(?:rs?|s)?)?|\s?h\s?([0-5]\d)(?:\s?min)?|\s?h(?:rs?|s)?))(?=$|[\s.,;:)!?-])/gi;
  const out: HoraNoTexto[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const [, sep, prefixo, corpo, h, mmColon, mmH] = m;
    const ini = m.index + sep.length;
    if (!corpo.includes(":")) {
      const antes = normalizarTexto(texto.slice(Math.max(0, ini - 25), ini)).split(/[^a-z]+/).filter(Boolean).slice(-2);
      if (!prefixo && antes.some((p) => PALAVRAS_DURACAO.test(p))) continue;
      if (!mmH && !prefixo && texto.slice(0, ini).trim() !== "") continue;
    }
    const mm = mmColon || mmH || "00";
    out.push({ hora: `${h.padStart(2, "0")}:${mm}`, ini, fim: ini + prefixo.length + corpo.length });
  }
  return out;
}

/** Tira do texto os horários digitados (o horário da atividade sai sozinho,
 *  dos campos de início/fim). */
export function removerHorarioDoTexto(texto: string): string {
  let t = texto;
  for (const a of [...horariosNoTexto(texto)].reverse()) t = t.slice(0, a.ini) + t.slice(a.fim);
  t = t.replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  t = t.replace(/^(?:[àáa]s?|das|at[ée]|e)\s+(?=[A-ZÀ-Úa-zà-ú])/i, (x) => (/^e\s/i.test(x) ? x : ""));
  t = t.replace(/^[\s,;:\-–—]+/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// ── Equipamentos e listas ────────────────────────────────────────────────────

/** "Mangotes, Ferramentas; Robô." → ["Mangotes", "Ferramentas", "Robô"]. */
export function itensEquipamentos(texto: string): string[] {
  return (texto || "").split(/[,;\n]+/).map((s) => s.trim().replace(/\.+$/, "").trim()).filter(Boolean);
}

/** Itens repetidos de "Equipamentos utilizados" (sem acento/caixa). */
export function equipamentosRepetidos(texto: string): string[] {
  const itens = itensEquipamentos(texto);
  return duplicadosEmLista(itens, chaveTexto).map((d) => itens[d.indice]);
}

/** Mantém a primeira ocorrência de cada item ("Remover repetidos"). */
export function removerEquipamentosRepetidos(texto: string): string {
  const vistos = new Set<string>();
  const unicos = itensEquipamentos(texto).filter((i) => {
    const k = chaveTexto(i);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return unicos.join(", ") + (/\.\s*$/.test(texto || "") && unicos.length ? "." : "");
}

/** OS (tanque) da amostra: a escolhida, ou a única coberta. "" = ambígua. */
export function osDaAmostra(a: Pick<AtividadeRdo, "inspecaoId">, inspecoes: string[]): string {
  if (a.inspecaoId && inspecoes.includes(a.inspecaoId)) return a.inspecaoId;
  return inspecoes.length === 1 ? inspecoes[0] : "";
}

/** `erros` impedem gerar o arquivo; `bloqueios` impedem até salvar;
 *  `avisos` só alertam (nunca bloqueiam). */
export function validarRdo(d: DadosRdo, data: string, inspecoes: string[], ctx: ContextoRdo = {}): ValidacaoRdo {
  const r = novoResultado();
  const bloq = new Set<string>();
  const erro = (campo: string, msg: string) => addErro(r, campo, msg);
  const bloqueio = (campo: string, msg: string) => { addErro(r, campo, msg); bloq.add(msg); };
  const aviso = (campo: string, msg: string) => addAviso(r, campo, msg);
  const oss = ctx.oss || {};
  const nomeOs = (id: string) => oss[id]?.nome || "OS";

  // Data e cobertura
  if (!dataIsoValida(data)) erro("data", "Informe a data do RDO.");
  else {
    if (ctx.hoje && data > ctx.hoje) bloqueio("data", "A data do RDO não pode estar no futuro.");
    for (const id of inspecoes) {
      const p = oss[id]?.periodo;
      if (p && (data < p.inicio || data > p.fim)) {
        const per = p.inicio === p.fim ? dataBr(p.inicio) : `${dataBr(p.inicio)} a ${dataBr(p.fim)}`;
        aviso("data", `${dataBr(data)} está fora do período da execução de “${nomeOs(id)}” (${per}).`);
      }
    }
  }
  if (inspecoes.length === 0) erro("inspecoes", "Marque ao menos uma OS coberta por este RDO.");
  for (const id of inspecoes) {
    if ((oss[id]?.fase ?? 0) >= 10) aviso("inspecoes", `“${nomeOs(id)}” já está na fase 10 (encerramento) — confira se o RDO é dela.`);
  }

  // Equipe
  const equipe = d.equipe.map((m, i) => ({ m, i })).filter(({ m }) => m.nome.trim() || m.funcao.trim());
  if (equipe.length === 0) erro("equipe", "Informe a equipe do dia.");
  equipe.forEach(({ m, i }) => {
    if (!m.nome.trim()) erro(`equipe.${i}.nome`, `Equipe, linha ${i + 1}: falta o nome.`);
    else if (!m.funcao.trim()) aviso(`equipe.${i}.funcao`, `Equipe: falta a função de ${m.nome.trim()}.`);
  });
  duplicadosEmLista(d.equipe, (m) => normalizarNome(m.nome)).forEach(({ indice, primeiro }) => {
    bloqueio(`equipe.${indice}.nome`, `Equipe, linha ${indice + 1}: “${d.equipe[indice].nome.trim()}” já está na linha ${primeiro + 1} — a mesma pessoa duas vezes.`);
  });
  // Mesma pessoa com outra função em outro RDO do projeto.
  if (ctx.outros?.length) {
    equipe.forEach(({ m, i }) => {
      const nome = normalizarNome(m.nome);
      const funcao = chaveTexto(m.funcao);
      if (!nome || !funcao) return;
      const outras = new Map<string, { funcao: string; rdos: string[] }>();
      for (const o of ctx.outros!) {
        for (const x of o.equipe || []) {
          const k = chaveTexto(x.funcao || "");
          if (normalizarNome(x.nome) !== nome || !k || k === funcao) continue;
          const item = outras.get(k) || { funcao: x.funcao.trim(), rdos: [] };
          if (!item.rdos.includes(`nº ${numeroRdo(o.numero)}`)) item.rdos.push(`nº ${numeroRdo(o.numero)}`);
          outras.set(k, item);
        }
      }
      for (const o of outras.values()) {
        aviso(`equipe.${i}.funcao`, `${m.nome.trim()} aparece como “${o.funcao}” em outro RDO do projeto (${o.rdos.join(", ")}).`);
      }
    });
  }

  // Atividades — formato e valores
  if (d.atividades.length === 0) erro("atividades", "Inclua ao menos uma atividade.");
  d.atividades.forEach((a, i) => {
    const n = numeroLinha(i);
    if (!horaValida(a.inicio)) erro(`atividades.${i}`, `Atividade ${n}: horário de início inválido (use HH:MM).`);
    if (a.fim && !horaValida(a.fim)) erro(`atividades.${i}`, `Atividade ${n}: horário de fim inválido (use HH:MM).`);
    else if (a.fim && horaValida(a.inicio) && a.fim <= a.inicio) erro(`atividades.${i}`, `Atividade ${n}: o fim deve ser depois do início.`);
    if (!semFraseCloro(a.texto)) erro(`atividades.${i}.texto`, `Atividade ${n}: descreva a atividade.`);
    if (a.cloro != null && (!isFinite(a.cloro) || a.cloro < 0)) bloqueio(`atividades.${i}.cloro`, `Atividade ${n}: o cloro não pode ser negativo.`);
    if (a.momento && a.ph != null && (!isFinite(a.ph) || a.ph < 0 || a.ph > 14)) bloqueio(`atividades.${i}.ph`, `Atividade ${n}: pH fora da escala (0 a 14).`);
    if (a.momento && a.cloro == null) aviso(`atividades.${i}.cloro`, `Atividade ${n}: coleta de água sem o valor de cloro livre.`);

    // pH/cloro citados no texto sem valor (amostras de água)
    const t = chaveTexto(semFraseCloro(a.texto));
    if (a.momento || /\bcoleta de amostra\b/.test(t)) {
      if (/\bph\b/.test(t) && (!a.momento || a.ph == null)) {
        aviso(`atividades.${i}.ph`, `Atividade ${n}: o texto cita pH, mas o valor não foi informado.`);
      }
      if (/\bcloro\b/.test(t) && !a.momento) {
        aviso(`atividades.${i}.cloro`, `Atividade ${n}: o texto cita cloro, mas a atividade não está marcada como coleta de água (sem valor).`);
      }
    }

    // Horário digitado no texto diferente dos campos
    const proprios = [a.inicio, a.fim].filter((h): h is string => !!h && horaValida(h));
    const citados = Array.from(new Set(horariosNoTexto(semFraseCloro(a.texto)).map((x) => x.hora))).filter((h) => !proprios.includes(h));
    if (citados.length && proprios.length) {
      aviso(`atividades.${i}.texto`, `Atividade ${n}: o texto cita ${citados.join(", ")}, diferente do horário da atividade (${proprios.join(" às ")}).`);
    }
  });

  // Atividade repetida (mesmo horário e mesmo texto)
  duplicadosEmLista(d.atividades, (a) => {
    const t = chaveTexto(semFraseCloro(a.texto));
    return t ? `${a.inicio}|${a.fim || ""}|${t}` : "";
  }).forEach(({ indice, primeiro }) => {
    bloqueio(`atividades.${indice}`, `Atividade ${numeroLinha(indice)}: repete a atividade ${numeroLinha(primeiro)} (mesmo horário e texto).`);
  });

  // Ordem do dia. Operação que passa da meia-noite: horário antes das 05:00
  // conta como madrugada do dia seguinte quando o dia começou depois disso.
  const familias = d.atividades.map((a) => frasesUnicasDoTexto(a.texto));
  const valida = (i: number) => horaValida(d.atividades[i].inicio);
  const idxChegada = familias.findIndex((f, i) => f.includes("chegada") && valida(i));
  const baseH = idxChegada >= 0 ? d.atividades[idxChegada].inicio : d.atividades.find((a) => horaValida(a.inicio))?.inicio;
  const base = baseH ? minutos(baseH) : 0;
  const chave = (h: string) => { const m = minutos(h); return m < 300 && base >= 300 ? m + 1440 : m; };

  for (const f of FRASES_UNICAS) {
    const idx = familias.flatMap((l, i) => (l.includes(f.id) ? [i] : []));
    idx.slice(1).forEach((i) => aviso(`atividades.${i}`, `Atividade ${numeroLinha(i)}: “${f.rotulo}” já aparece na atividade ${numeroLinha(idx[0])} — acontece uma vez por dia.`));
  }
  const pares: [string, string, string][] = [
    ["chegada", "saida", "a equipe deixa o site antes de chegar"],
    ["mob_ini", "mob_fim", "o fim da mobilização está antes do início"],
    ["desmob_ini", "desmob_fim", "o fim da desmobilização está antes do início"],
  ];
  for (const [ini, fim, msg] of pares) {
    const is = familias.flatMap((l, i) => (l.includes(ini) && valida(i) ? [i] : []));
    const fs = familias.flatMap((l, i) => (l.includes(fim) && valida(i) ? [i] : []));
    for (const j of fs) {
      const i = is.find((k) => chave(d.atividades[j].inicio) < chave(d.atividades[k].inicio));
      if (i !== undefined) bloqueio(`atividades.${j}`, `Atividade ${numeroLinha(j)}: ${msg} (atividade ${numeroLinha(i)}, ${d.atividades[i].inicio}).`);
    }
  }

  // Amostras de água por tanque
  const porTanque = new Map<string, { antes: number[]; depois: number[] }>();
  d.atividades.forEach((a, i) => {
    if (!a.momento) return;
    if (a.inspecaoId && !inspecoes.includes(a.inspecaoId)) {
      aviso(`atividades.${i}.os`, `Atividade ${numeroLinha(i)}: a OS da amostra não está entre as cobertas por este RDO.`);
    }
    const os = osDaAmostra(a, inspecoes);
    if (!os) {
      if (inspecoes.length > 1) aviso(`atividades.${i}.os`, `Atividade ${numeroLinha(i)}: o RDO cobre ${inspecoes.length} OSs — indique de qual tanque é a amostra.`);
      return;
    }
    const g = porTanque.get(os) || { antes: [], depois: [] };
    g[a.momento].push(i);
    porTanque.set(os, g);

    // Cloro do RDO × cloro da coleta de fotos
    const coleta = oss[os]?.cloroColeta?.[a.momento];
    if (a.cloro != null && coleta != null && Math.round(a.cloro * 100) !== Math.round(coleta * 100)) {
      aviso(`atividades.${i}.cloro`, `Atividade ${numeroLinha(i)}: cloro ${numeroPpm(a.cloro)} aqui, mas ${numeroPpm(coleta)} na coleta de fotos de “${nomeOs(os)}”.`);
    }
  });
  for (const [os, g] of porTanque) {
    const sufixo = inspecoes.length > 1 ? ` de “${nomeOs(os)}”` : "";
    for (const m of ["antes", "depois"] as const) {
      g[m].slice(1).forEach((i) => aviso(`atividades.${i}`, `Atividade ${numeroLinha(i)}: já há amostra de água ${m === "antes" ? "ANTES" : "DEPOIS"} da limpeza${sufixo} (atividade ${numeroLinha(g[m][0])}).`));
    }
    for (const j of g.depois.filter(valida)) {
      const i = g.antes.filter(valida).find((k) => chave(d.atividades[j].inicio) < chave(d.atividades[k].inicio));
      if (i !== undefined) bloqueio(`atividades.${j}`, `Atividade ${numeroLinha(j)}: a amostra DEPOIS da limpeza${sufixo} está antes da amostra ANTES (atividade ${numeroLinha(i)}, ${d.atividades[i].inicio}).`);
    }
  }

  // Intervalos sobrepostos (um horário pontual dentro de um intervalo é normal)
  const faixas = d.atividades.map((a, i) => ({ a, i }))
    .filter(({ a }) => horaValida(a.inicio) && !!a.fim && horaValida(a.fim) && a.fim > a.inicio);
  faixas.forEach((x, k) => faixas.slice(k + 1).forEach((y) => {
    if (chave(x.a.inicio) < chave(y.a.fim!) && chave(y.a.inicio) < chave(x.a.fim!)) {
      aviso(`atividades.${y.i}`, `Atividade ${numeroLinha(y.i)}: o horário (${y.a.inicio} às ${y.a.fim}) se sobrepõe ao da atividade ${numeroLinha(x.i)} (${x.a.inicio} às ${x.a.fim}).`);
    }
  }));

  // Antes da chegada / depois da saída
  const saidas = familias.flatMap((l, i) => (l.includes("saida") && valida(i) ? [i] : []));
  const idxSaida = saidas.length ? saidas[saidas.length - 1] : -1;
  d.atividades.forEach((a, i) => {
    if (!horaValida(a.inicio) || familias[i].includes("chegada") || familias[i].includes("saida")) return;
    if (idxChegada >= 0 && chave(a.inicio) < chave(d.atividades[idxChegada].inicio)) {
      aviso(`atividades.${i}`, `Atividade ${numeroLinha(i)}: às ${a.inicio}, antes da chegada da equipe (${d.atividades[idxChegada].inicio}).`);
    }
    if (idxSaida >= 0) {
      const ultimo = a.fim && horaValida(a.fim) ? a.fim : a.inicio;
      if (chave(ultimo) > chave(d.atividades[idxSaida].inicio)) {
        aviso(`atividades.${i}`, `Atividade ${numeroLinha(i)}: vai até ${ultimo}, depois da saída da equipe (${d.atividades[idxSaida].inicio}).`);
      }
    }
  });

  // Ordem da lista e condições do tempo dos períodos trabalhados
  const horas = d.atividades.map((a) => a.inicio).filter(horaValida).map(chave);
  if (horas.some((h, i) => i > 0 && h < horas[i - 1])) aviso("atividades", "As atividades não estão em ordem de horário.");
  if (!d.tempo.manha && !d.tempo.tarde && !d.tempo.noite) aviso("tempo", "Condições do tempo não informadas.");
  else {
    const semTempo = new Map<keyof TempoRdo, string[]>();
    d.atividades.forEach((a, i) => periodosDaAtividade(a).forEach((p) => {
      if (!d.tempo[p]) semTempo.set(p, [...(semTempo.get(p) || []), numeroLinha(i)]);
    }));
    for (const p of PERIODOS) {
      const l = semTempo.get(p.id);
      if (l) aviso("tempo", `${p.rotulo}: há atividade nesse período (${l.join(", ")}), mas o tempo não foi informado.`);
    }
  }

  // Equipamentos, fiscalização e DDSMS
  const repetidos = equipamentosRepetidos(d.equipamentos);
  if (repetidos.length) aviso("equipamentos", `Equipamento repetido: ${Array.from(new Set(repetidos)).join(", ")}.`);
  for (const [lista, titulo] of [["fiscalizacao", "Observação da fiscalização"], ["ddsms", "DDSMS"]] as const) {
    duplicadosEmLista(d[lista], chaveTexto).forEach(({ indice, primeiro }) => {
      aviso(`${lista}.${indice}`, `${titulo} ${numeroLinha(indice)}: repete a linha ${numeroLinha(primeiro)}.`);
    });
  }

  // Cabeçalho e assinaturas
  if (!d.responsavel.trim()) aviso("responsavel", "Responsável do cliente em branco.");
  if (!d.descricao.trim()) aviso("descricao", "Descrição do serviço (Projeto) em branco.");
  if (!d.assinaturaAsp.nome.trim()) aviso("assinaturaAsp", "Assinatura da ASP sem nome.");
  else if (!equipe.some(({ m }) => normalizarNome(m.nome) === normalizarNome(d.assinaturaAsp.nome))) {
    aviso("assinaturaAsp", "A assinatura da ASP não é de alguém da equipe do dia.");
  }
  if (!d.assinaturaCliente.nome.trim()) aviso("assinaturaCliente", "Assinatura do cliente sem nome.");
  else if (equipe.some(({ m }) => normalizarNome(m.nome) === normalizarNome(d.assinaturaCliente.nome))) {
    bloqueio("assinaturaCliente", `Quem assina pelo cliente (${d.assinaturaCliente.nome.trim()}) está na equipe da ASP — o cliente assina por si.`);
  }

  const plano = (m: Record<string, string[]>) => Array.from(new Set(Object.values(m).flat()));
  return { erros: plano(r.erros), avisos: plano(r.avisos), bloqueios: Array.from(bloq), r };
}

// ── Geração do .docx ─────────────────────────────────────────────────────────

/** Escapa texto para <w:t>, descartando caracteres que o XML não aceita. */
function esc(t: string): string {
  return String(t ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Valor pronto para dentro de um <w:t>: escapado, \n vira quebra de linha.
 *  "{" vai como referência numérica: um "{data}" digitado pelo usuário não
 *  pode ser confundido com marcador nas trocas seguintes. */
function valorXml(t: string): string {
  return esc(t).replace(/\{/g, "&#123;").replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
}

/**
 * Rede de segurança para o modelo editado no Word: se um marcador foi
 * quebrado em vários runs ("{cli" + "ente}"), junta todo o texto do parágrafo
 * no primeiro <w:t> (a formatação do parágrafo vem do primeiro run). No
 * modelo da ASP cada marcador já está num run só e nada muda.
 */
function unirMarcadoresQuebrados(xml: string): string {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (p) => {
    const ts = p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [];
    if (ts.length < 2) return p;
    const texto = ts.map((t) => t.replace(/<[^>]+>/g, "")).join("");
    const marcadores = texto.match(/\{[a-z_]+\}/g) || [];
    if (marcadores.every((m) => p.includes(m))) return p;
    let primeiro = true;
    return p.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, () => {
      if (!primeiro) return "<w:t></w:t>";
      primeiro = false;
      return `<w:t xml:space="preserve">${texto}</w:t>`;
    });
  });
}

/** Troca todos os marcadores de um trecho. */
function preencher(xml: string, valores: Record<string, string>): string {
  return xml.replace(/\{([a-z_]+)\}/g, (m, nome: string) =>
    nome in valores ? valorXml(valores[nome]) : m);
}

/** Clona a linha da tabela que contém `marcador` — uma por item. */
function clonarLinha(xml: string, marcador: string, itens: Record<string, string>[]): string {
  const pos = xml.indexOf(marcador);
  if (pos === -1) return xml;
  const iniA = xml.lastIndexOf("<w:tr ", pos), iniB = xml.lastIndexOf("<w:tr>", pos);
  const ini = Math.max(iniA, iniB);
  const fim = xml.indexOf("</w:tr>", pos) + "</w:tr>".length;
  if (ini === -1 || fim < pos) return xml;
  const modelo = xml.slice(ini, fim);
  return xml.slice(0, ini) + itens.map((v) => preencher(modelo, v)).join("") + xml.slice(fim);
}

/** Corpo do documento já preenchido (exportado para os testes). */
export function preencherDocumentoRdo(xmlDoc: string, d: DadosRdo, data: string): string {
  let xml = unirMarcadoresQuebrados(xmlDoc);

  const equipe = d.equipe.filter((m) => m.nome.trim() || m.funcao.trim());
  xml = clonarLinha(xml, "{equipe_nome}", (equipe.length ? equipe : [{ nome: "", funcao: "" }])
    .map((m) => ({ equipe_nome: m.nome.trim(), equipe_funcao: m.funcao.trim() })));

  xml = clonarLinha(xml, "{atv_texto}", (d.atividades.length ? d.atividades : [null])
    .map((a, i) => ({ atv_num: numeroLinha(i), atv_texto: a ? textoAtividade(a, d.cloroUnidade) : "" })));

  // Sem anotações, a tabela sai com uma linha "01" vazia, como nos RDOs da ASP.
  const lista = (l: string[]) => { const v = l.map((s) => s.trim()).filter(Boolean); return v.length ? v : [""]; };
  xml = clonarLinha(xml, "{fisc_texto}", lista(d.fiscalizacao).map((t, i) => ({ fisc_num: numeroLinha(i), fisc_texto: t })));
  xml = clonarLinha(xml, "{ddsms_texto}", lista(d.ddsms).map((t, i) => ({ ddsms_num: numeroLinha(i), ddsms_texto: t })));

  return preencher(xml, {
    codigo_projeto: d.codigoProjeto.trim(),
    cliente: d.cliente.trim(),
    responsavel: d.responsavel.trim(),
    projeto: d.descricao.trim(),
    data: dataBr(data),
    equipamentos: d.equipamentos.trim(),
    tempo_manha: linhaTempo("Manhã", d.tempo.manha),
    tempo_tarde: linhaTempo("Tarde", d.tempo.tarde),
    tempo_noite: linhaTempo("Noite", d.tempo.noite),
    ass_asp_nome: d.assinaturaAsp.nome.trim(),
    ass_asp_cargo: d.assinaturaAsp.cargo.trim(),
    ass_cli_nome: d.assinaturaCliente.nome.trim(),
    ass_cli_cargo: d.assinaturaCliente.cargo.trim(),
  });
}

/**
 * Gera o .docx do RDO. Roda no navegador (o modelo é estático em
 * /templates); `modelo` permite passar o arquivo direto (testes em Node).
 */
export async function gerarRdoDocx(
  d: DadosRdo,
  data: string,
  opcoes: { modelo?: ArrayBuffer | Uint8Array; saida?: "blob" | "uint8array" } = {},
): Promise<Blob | Uint8Array> {
  const JSZip = (await import("jszip")).default;
  let modelo = opcoes.modelo;
  if (!modelo) {
    const resp = await fetch(MODELO_RDO);
    if (!resp.ok) throw new Error("Não foi possível carregar o modelo do RDO.");
    modelo = await resp.arrayBuffer();
  }
  const zip = await JSZip.loadAsync(modelo);

  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Modelo inválido: falta word/document.xml.");
  zip.file("word/document.xml", preencherDocumentoRdo(await docFile.async("string"), d, data));

  // Cabeçalho e rodapé: código do projeto (o Word pode ter vários headerN).
  for (const nome of Object.keys(zip.files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(nome)) continue;
    const xml = await zip.file(nome)!.async("string");
    if (!xml.includes("{")) continue;
    zip.file(nome, preencher(unirMarcadoresQuebrados(xml), { codigo_projeto: d.codigoProjeto.trim() }));
  }

  const tipo = opcoes.saida === "uint8array" ? "uint8array" : "blob";
  return zip.generateAsync({
    type: tipo,
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }) as Promise<Blob | Uint8Array>;
}
