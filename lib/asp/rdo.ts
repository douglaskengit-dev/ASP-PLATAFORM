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
  /** Amostra de água: o cloro livre (PPM) gera a frase da CVS 6 sozinho. */
  momento?: "antes" | "depois" | null;
  cloro?: number | null;
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
  return {
    codigoProjeto: txt(x.codigoProjeto), cliente: txt(x.cliente),
    responsavel: txt(x.responsavel), descricao: txt(x.descricao),
    equipe: Array.isArray(x.equipe) ? x.equipe.map((m) => ({ nome: txt(m?.nome), funcao: txt(m?.funcao) })) : v.equipe,
    tempo: { manha: tempo(x.tempo?.manha), tarde: tempo(x.tempo?.tarde), noite: tempo(x.tempo?.noite) },
    equipamentos: txt(x.equipamentos),
    atividades: Array.isArray(x.atividades) ? x.atividades.map((a) => ({
      inicio: txt(a?.inicio), fim: txt(a?.fim) || undefined, texto: txt(a?.texto),
      momento: a?.momento === "antes" || a?.momento === "depois" ? a.momento : null,
      cloro: a?.cloro != null && isFinite(Number(a.cloro)) ? Number(a.cloro) : null,
    })) : v.atividades,
    fiscalizacao: Array.isArray(x.fiscalizacao) ? x.fiscalizacao.map(txt) : v.fiscalizacao,
    ddsms: Array.isArray(x.ddsms) ? x.ddsms.map(txt) : v.ddsms,
    assinaturaAsp: { nome: txt(x.assinaturaAsp?.nome), cargo: txt(x.assinaturaAsp?.cargo) },
    assinaturaCliente: { nome: txt(x.assinaturaCliente?.nome), cargo: txt(x.assinaturaCliente?.cargo) },
  };
}

// ── Regras de texto ──────────────────────────────────────────────────────────

/** Mínimo de cloro livre para consumo humano (comunicado CVS 6), em PPM. */
export const CLORO_MINIMO = 0.2;

/** 0.24 → "0,24" (sempre duas casas, vírgula decimal). */
export function numeroPpm(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
}

/** Frase do cloro livre — GERADA, nunca digitada, para o texto não poder
 *  contradizer o valor (nos RDOs antigos havia "0,24 PPM … abaixo do mínimo").
 *  Compara o valor já arredondado, o mesmo que sai escrito. */
export function fraseCloro(valor: number): string {
  const arred = Math.round(valor * 100) / 100;
  const situacao = arred >= CLORO_MINIMO ? "dentro do" : "abaixo do";
  return `(Obs: na amostra coletada, foi encontrado o valor de ${numeroPpm(valor)} PPM de cloro livre ` +
    `no reservatório, que está ${situacao} mínimo estipulado pelo comunicado CVS 6 de 0,2 PPM para consumo humano.)`;
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
export function textoAtividade(a: AtividadeRdo): string {
  const quando = a.fim ? `${a.inicio}h às ${a.fim}h` : `${a.inicio}h`;
  const temCloro = a.cloro != null && isFinite(a.cloro);
  const corpo = temCloro ? semFraseCloro(a.texto) : a.texto.trim();
  return [quando, corpo, temCloro ? fraseCloro(a.cloro as number) : ""].filter(Boolean).join(" ");
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

/** `erros` impedem gerar o arquivo; `avisos` só alertam (nunca bloqueiam). */
export function validarRdo(d: DadosRdo, data: string, inspecoes: string[]): { erros: string[]; avisos: string[] } {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (!dataIsoValida(data)) erros.push("Informe a data do RDO.");
  if (inspecoes.length === 0) erros.push("Marque ao menos uma inspeção coberta por este RDO.");

  const equipe = d.equipe.filter((m) => m.nome.trim() || m.funcao.trim());
  if (equipe.length === 0) erros.push("Informe a equipe do dia.");
  equipe.forEach((m, i) => {
    if (!m.nome.trim()) erros.push(`Equipe, linha ${i + 1}: falta o nome.`);
    else if (!m.funcao.trim()) avisos.push(`Equipe: falta a função de ${m.nome.trim()}.`);
  });

  if (d.atividades.length === 0) erros.push("Inclua ao menos uma atividade.");
  d.atividades.forEach((a, i) => {
    const n = numeroLinha(i);
    if (!horaValida(a.inicio)) erros.push(`Atividade ${n}: horário de início inválido (use HH:MM).`);
    if (a.fim && !horaValida(a.fim)) erros.push(`Atividade ${n}: horário de fim inválido (use HH:MM).`);
    else if (a.fim && horaValida(a.inicio) && a.fim <= a.inicio) erros.push(`Atividade ${n}: o fim deve ser depois do início.`);
    if (!semFraseCloro(a.texto)) erros.push(`Atividade ${n}: descreva a atividade.`);
    if (a.cloro != null && (!isFinite(a.cloro) || a.cloro < 0)) erros.push(`Atividade ${n}: valor de cloro inválido.`);
    if (a.momento && a.cloro == null) avisos.push(`Atividade ${n}: coleta de água sem o valor de cloro livre.`);
  });
  const horas = d.atividades.map((a) => a.inicio).filter(horaValida);
  if (horas.some((h, i) => i > 0 && h < horas[i - 1])) avisos.push("As atividades não estão em ordem de horário.");

  if (!d.responsavel.trim()) avisos.push("Responsável do cliente em branco.");
  if (!d.descricao.trim()) avisos.push("Descrição do serviço (Projeto) em branco.");
  if (!d.assinaturaAsp.nome.trim()) avisos.push("Assinatura da ASP sem nome.");
  else if (!equipe.some((m) => m.nome.trim() === d.assinaturaAsp.nome.trim())) {
    avisos.push("A assinatura da ASP não é de alguém da equipe do dia.");
  }
  if (!d.assinaturaCliente.nome.trim()) avisos.push("Assinatura do cliente sem nome.");
  if (!d.tempo.manha && !d.tempo.tarde && !d.tempo.noite) avisos.push("Condições do tempo não informadas.");
  return { erros, avisos };
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
    .map((a, i) => ({ atv_num: numeroLinha(i), atv_texto: a ? textoAtividade(a) : "" })));

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
