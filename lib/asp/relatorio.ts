/**
 * Geração do Relatório Técnico (.docx) a partir do template da ASP.
 *
 * Estratégia: o .docx é um ZIP de XML. Abrimos o template original com JSZip
 * e editamos `word/document.xml` — assim timbre, logo, cabeçalho, rodapé e a
 * formatação das tabelas continuam idênticos ao modelo aprovado. Nada é
 * recriado do zero.
 *
 * O que fazemos no XML:
 *   1. margens da seção → ABNT (NBR 14724): 3 cm sup/esq, 2 cm inf/dir;
 *   2. substituição dos marcadores ([TITULO], [CLIENTE], …);
 *   3. remoção dos tópicos desmarcados (e renumeração dos que ficaram);
 *   4. preenchimento dos rótulos das tabelas ("Cliente...:" → "Cliente...: X");
 *   5. inserção das imagens (mapa de calor, 3D, fotos) com legenda abaixo.
 *
 * Roda no navegador (o template é um arquivo estático em /templates), o que
 * evita depender do sistema de arquivos da função serverless.
 */

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Um tópico do relatório. `visivel: false` remove a seção inteira. */
export interface TopicoRelatorio {
  /** Número original no template (1..10). */
  numero: number;
  titulo: string;
  visivel: boolean;
}

export interface ImagemRelatorio {
  /** Conteúdo do arquivo. */
  dados: ArrayBuffer;
  /** "png" | "jpeg" */
  extensao: "png" | "jpeg";
  /** Legenda — vai ABAIXO da figura ("Figura N – …"). */
  legenda: string;
  /** Fonte da figura — vai abaixo da legenda ("Fonte: …"). */
  fonte?: string;
  /** Largura em cm (padrão 15, cabe na mancha ABNT de 16 cm). */
  larguraCm?: number;
  /** Em qual tópico entra (número original). */
  topico: number;
  /** Subtópico de destino ("6.1", "6.2", "6.3"). A figura entra logo abaixo
   *  daquele subtítulo, em vez de no fim da seção. */
  ancora?: string;
  /** true = a foto ocupa uma VAGA do modelo ([imagem], [IMAGEM DO LAUDO]).
   *  As vagas de um tópico são preenchidas na ordem em que as fotos chegam;
   *  a legenda não é gerada, pois o modelo já a traz escrita abaixo da vaga. */
  vaga?: boolean;
}

export interface DadosRelatorio {
  titulo: string;
  cliente: string;
  endereco: string;
  // Quadro de controle de revisão (capa)
  revisao?: string;          // automático: incrementa a cada reprovação
  statusRevisao?: string;    // A … E
  dataRevisao?: string;      // dd/mm/aaaa
  preparadoPor?: string;
  checadoPor?: string;
  /** Coluna "REVISADO POR" do quadro da capa — existe no modelo do POP 001.
   *  Não confundir com `revisadoPor`, que é o bloco de assinaturas do fim. */
  revisadoPorCapa?: string;
  aprovadoPor?: string;
  relatorioCodigo?: string;  // automático: "<código do projeto> Rev<revisão>"
  codigoProjeto?: string;    // só para compor o campo acima (não vai ao doc)
  procedimento?: string;     // manual por enquanto
  unidade?: string;
  contato?: string;
  dataExecucao?: string;
  dataRelatorio?: string;
  // Identificação do tanque
  tag?: string;
  area?: string;
  material?: string;
  capacidadeNominal?: string;   // dado de placa (tópico 2, manual)
  alturaTanque?: string;
  diametro?: string;
  observacoesTanque?: string;
  /** Campos do POP 001 (limpeza). Preenchidos por rótulo: se o modelo não
   *  tiver o rótulo, o campo simplesmente não aparece no documento. */
  historico?: string;
  nivelAgua?: string;
  comprimento?: string;
  largura?: string;
  /** Marcadores [data] e [horario] do texto padrão de Observações do POP 001.
   *  Os quatro horários são, em ordem: chegada, início, fim e saída. */
  dataOperacao?: string;
  horarios?: string[];
  /** Conteúdo do tópico "Anexos" — injetado pelo TÍTULO, não pelo número,
   *  porque a posição desse tópico muda de um modelo para o outro. */
  anexos?: string;
  /** Valores medidos em campo que aparecem nas legendas das figuras do
   *  tópico "Coletas" do POP 001. */
  cloroAntes?: string;
  cloroDepois?: string;
  phAntes?: string;
  phDepois?: string;
  /** Altura média de sedimento — marcador [altura de sedimento] do POP 001. */
  alturaSedimento?: string;
  /** Valores do laudo: uma linha por parâmetro, colunas Valor, Incerteza,
   *  LQ, LD e Limite. Preenchem as células "[dado coletado]" das duas
   *  tabelas do tópico de Análise. */
  laudoAntes?: string[][];
  laudoDepois?: string[][];
  // Tópico 6 — quadro "Dados do Tanque"
  equipamentoTanque?: string;   // tipo/uso do tanque (manual)
  capacidadeTanque?: string;    // volume calculado (automático)
  // Tópico 7 — faixa de ±5% sobre o volume medido
  volumeMin?: string;
  volumeMax?: string;
  // Conteúdos livres
  metodos?: string;
  equipamentos?: string;
  /** Fichas do catálogo — viram tabelas de duas colunas (rótulo | valor) no
   *  tópico 4, no layout do relatório de referência. */
  equipamentosFicha?: {
    nome: string;
    especificacoes: { rotulo: string; valor: string }[];
    /** Foto do catálogo — entra ao lado da ficha, à direita. */
    foto?: { dados: ArrayBuffer; extensao: "png" | "jpeg" };
  }[];
  equipe?: string;
  volumeSedimento?: string;
  fotosInternas?: string;   // texto do tópico 8
  /** Subtópicos do tópico 8 (8.1, 8.2, …), criados pelo usuário. A numeração
   *  é automática e acompanha o número final do tópico 8. As fotos de cada um
   *  chegam em `imagens` com ancora "sub8-<índice>". */
  subtopicos8?: { titulo: string }[];
  conclusao?: string;       // tópico 9
  recomendacoes?: string;   // tópico 10
  // Bloco de assinaturas (fim do documento)
  elaboradoPor?: string;   // usuário de Operações
  revisadoPor?: string;    // usuário da Gerência
  /** Tópicos próprios do procedimento: título + texto + fotos. Podem ficar em
   *  qualquer posição — `apos` é o número do tópico padrão depois do qual ele
   *  entra (0 = logo após a capa). São numerados junto com os demais. As fotos
   *  chegam em `imagens` com ancora "extra-<índice>". */
  topicosExtras?: { titulo: string; texto?: string; apos?: number }[];
  /** Modelo .docx a usar. Vazio = modelo padrão da ASP. */
  templateUrl?: string;
  // Estrutura
  topicos: TopicoRelatorio[];
  imagens?: ImagemRelatorio[];
}

/** Extrai do estado salvo do medidor os campos automáticos do relatório.
 *  Usado tanto no pré-preenchimento quanto ao trocar a medição escolhida,
 *  garantindo que os dois caminhos produzam exatamente os mesmos valores. */
export function camposDaMedicao(medicao: any): Partial<DadosRelatorio> {
  if (!medicao || typeof medicao !== "object") return {};
  const un = medicao.unit === "cm" ? "cm" : "m";
  const num = (v: any, casas = 2) =>
    v == null || isNaN(Number(v)) ? "" : Number(v).toFixed(casas).replace(".", ",");
  const res = medicao.resultado;
  // Em tanque nao circular a dimensao principal e o COMPRIMENTO e existe
  // largura - caso dos reservatorios de limpeza (POP 001).
  const circular = (medicao.formato || "circulo") === "circulo";
  return {
    alturaTanque: medicao.height ? `${num(medicao.height)} ${un}` : "",
    diametro: circular && medicao.dimValue ? `${num(medicao.dimValue)} ${un}` : "",
    comprimento: !circular && medicao.dimValue ? `${num(medicao.dimValue)} ${un}` : "",
    largura: medicao.largura ? `${num(medicao.largura)} ${un}` : "",
    capacidadeTanque: res?.volTankM3 ? `${num(res.volTankM3)} m³` : "",
    volumeSedimento: res?.volSedM3 != null ? `${num(res.volSedM3, 3)} m³` : "",
    volumeMin: res?.volSedM3 != null ? num(res.volSedM3 * 0.95, 2) : "",
    volumeMax: res?.volSedM3 != null ? num(res.volSedM3 * 1.05, 2) : "",
  };
}

/** Marcador temporário do número da figura: substituído no fim, na ordem em
 *  que as figuras aparecem no documento (exigência da ABNT). */
const MARCA_FIG = "\u0001FIG\u0001";

// ── Utilidades de XML ────────────────────────────────────────────────────────

/** Escapa texto para uso dentro de <w:t>. */
function esc(t: string): string {
  return String(t ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texto visível de um trecho de XML (remove tags). */
function textoDe(xml: string): string {
  return xml.replace(/<[^>]+>/g, "").trim();
}

/** Quebra o corpo do documento nos blocos de nível superior (<w:p> e <w:tbl>). */
function separarBlocos(body: string): { ini: number; fim: number; xml: string; texto: string }[] {
  const blocos: { ini: number; fim: number; xml: string; texto: string }[] = [];
  let i = 0;
  while (i < body.length) {
    const pA = body.indexOf("<w:p ", i);
    const pB = body.indexOf("<w:p>", i);
    const tb = body.indexOf("<w:tbl>", i);
    const cands = [pA, pB, tb].filter((x) => x !== -1);
    if (cands.length === 0) break;
    const ini = Math.min(...cands);
    const ehTabela = ini === tb;
    const fim = ehTabela ? body.indexOf("</w:tbl>", ini) + 8 : body.indexOf("</w:p>", ini) + 6;
    if (fim < ini) break;
    const xml = body.slice(ini, fim);
    blocos.push({ ini, fim, xml, texto: textoDe(xml) });
    i = fim;
  }
  return blocos;
}

/** Renumera um título dentro de um bloco.
 *
 *  O Word quebra o texto em vários <w:r>/<w:t> (marcas de revisão), então
 *  "6. Dados reservatório:" costuma vir como <w:t>6</w:t> + <w:t>. </w:t> +
 *  <w:t>Dados…</w:t>. Por isso não dá para casar "6. " no XML corrido: a
 *  troca é feita no PRIMEIRO <w:t> cujo texto começa pelo número do tópico.
 *  Cobre tanto "6" isolado quanto "6." e "6.1 …". */
function renumerarBloco(xml: string, de: number, para: number): string {
  if (de === para) return xml;
  const re = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const conteudo = m[2];
    const alvo = new RegExp(`^(\\s*)${de}(?=\\D|$)`);
    if (alvo.test(conteudo)) {
      const novoConteudo = conteudo.replace(alvo, `$1${para}`);
      return xml.slice(0, m.index) +
        `<w:t${m[1] || ""}>${novoConteudo}</w:t>` +
        xml.slice(m.index + m[0].length);
    }
    // só olhamos até o primeiro texto não vazio — o número vem antes do título
    if (conteudo.trim() !== "") break;
  }
  return xml;
}

/**
 * Substitui um texto que pode estar QUEBRADO entre vários <w:t>.
 *
 * O Word fragmenta o texto em runs por causa das marcas de revisão, então
 * "[Volume de sedimento]" aparece no XML como <w:t>[Volume de sedimento</w:t>
 * + <w:t>]</w:t>. Uma troca literal falharia. Aqui concatenamos o texto de
 * todos os <w:t>, localizamos o alvo nessa string e reescrevemos apenas os
 * runs envolvidos — o primeiro recebe o valor e os seguintes perdem a parte
 * consumida. A formatação de cada run é preservada.
 */
function trocarTexto(xml: string, alvo: string, valor: string): string {
  if (!alvo) return xml;
  const re = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
  const runs: { ini: number; fim: number; attr: string; texto: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    runs.push({ ini: m.index, fim: m.index + m[0].length, attr: m[1] || "", texto: m[2] });
  }
  if (runs.length === 0) return xml;

  const concat = runs.map((r) => r.texto).join("");
  const pos = concat.indexOf(alvo);
  if (pos === -1) return xml;
  const fimAlvo = pos + alvo.length;

  // descobre quais runs o alvo atravessa
  let acumulado = 0;
  const partes: { idx: number; de: number; ate: number }[] = [];
  runs.forEach((r, i) => {
    const ini = acumulado, fim = acumulado + r.texto.length;
    acumulado = fim;
    if (fim <= pos || ini >= fimAlvo) return;
    partes.push({ idx: i, de: Math.max(0, pos - ini), ate: Math.min(r.texto.length, fimAlvo - ini) });
  });
  if (partes.length === 0) return xml;

  // reescreve de trás para frente para não invalidar os índices
  let saida = xml;
  for (let k = partes.length - 1; k >= 0; k--) {
    const p = partes[k];
    const r = runs[p.idx];
    const antes = r.texto.slice(0, p.de);
    const depois = r.texto.slice(p.ate);
    // \n no valor vira quebra de linha real (<w:br/>) dentro do mesmo run
    const valorXml = esc(valor).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
    const novoTexto = k === 0 ? antes + valorXml + depois : antes + depois;
    saida = saida.slice(0, r.ini) +
      `<w:t${r.attr || ' xml:space="preserve"'}>${novoTexto}</w:t>` +
      saida.slice(r.fim);
  }
  return saida;
}

/** Substitui um marcador ([TITULO], [CLIENTE], …), mesmo quebrado em runs. */
function trocarMarcador(xml: string, marcador: string, valor: string): string {
  let saida = xml, antes = "";
  // repete enquanto houver ocorrências (o marcador pode aparecer mais de uma vez)
  while (saida !== antes) { antes = saida; saida = trocarTexto(saida, marcador, valor); }
  return saida;
}

// ── Margens ABNT ─────────────────────────────────────────────────────────────

/** NBR 14724: 3 cm superior/esquerda, 2 cm inferior/direita. Em twips (1 cm = 567). */
const ABNT = { sup: 1701, inf: 1134, esq: 1701, dir: 1134 };

function aplicarMargensAbnt(xml: string): string {
  return xml.replace(/<w:pgMar\b[^/]*\/>/g, (tag) => {
    let t = tag;
    t = t.replace(/w:top="[^"]*"/, `w:top="${ABNT.sup}"`);
    t = t.replace(/w:bottom="[^"]*"/, `w:bottom="${ABNT.inf}"`);
    t = t.replace(/w:left="[^"]*"/, `w:left="${ABNT.esq}"`);
    t = t.replace(/w:right="[^"]*"/, `w:right="${ABNT.dir}"`);
    return t;
  });
}

// ── Parágrafos e figuras no padrão ABNT ──────────────────────────────────────

/** Parágrafo de texto corrido: Arial 12, justificado, entrelinha 1,5,
 *  recuo de 1,25 cm na primeira linha. */
function paragrafoAbnt(texto: string): string {
  const linhas = String(texto || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return linhas.map((l) =>
    '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="0"/>' +
    '<w:ind w:firstLine="709"/><w:jc w:val="both"/>' +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>' +
    `<w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`
  ).join("");
}


/** Formatação herdada ao percorrer o HTML do editor. */
interface Fmt { b?: boolean; i?: boolean; u?: boolean; fonte?: string; tam?: number; cor?: string }

/** Propriedades de run (<w:rPr>) a partir da formatação acumulada. */
function rPr(f: Fmt): string {
  const fonte = f.fonte || "Arial";
  const meiaPt = Math.round((f.tam || 12) * 2);      // Word usa meio-pontos
  return "<w:rPr>" +
    `<w:rFonts w:ascii="${esc(fonte)}" w:hAnsi="${esc(fonte)}"/>` +
    (f.b ? "<w:b/>" : "") + (f.i ? "<w:i/>" : "") + (f.u ? '<w:u w:val="single"/>' : "") +
    (f.cor ? `<w:color w:val="${f.cor.replace("#", "").slice(0, 6)}"/>` : "") +
    `<w:sz w:val="${meiaPt}"/><w:szCs w:val="${meiaPt}"/>` +
    "</w:rPr>";
}

/** Converte "rgb(r, g, b)" ou "#rgb" em hexadecimal de 6 dígitos. */
function corHex(v?: string | null): string | undefined {
  if (!v) return undefined;
  const m = v.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("");
  const h = v.trim().replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(h)) return h;
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split("").map((c) => c + c).join("");
  return undefined;
}

/**
 * Converte o HTML do editor em parágrafos do Word.
 *
 * Suporta negrito, itálico, sublinhado, família e tamanho da fonte, cor,
 * alinhamento e listas. Blocos (p, div, li) viram <w:p>; a formatação inline
 * é acumulada e aplicada em cada <w:r>. Texto sem marcação nenhuma cai no
 * formato ABNT padrão, preservando o comportamento anterior.
 */
function htmlParaParagrafos(html: string): string {
  if (!html || !html.trim()) return "";
  if (!/<[a-z][\s\S]*>/i.test(html)) return paragrafoAbnt(html);   // texto puro
  if (typeof DOMParser === "undefined") return paragrafoAbnt(html.replace(/<[^>]+>/g, ""));

  const doc = new DOMParser().parseFromString(`<div id="raiz">${html}</div>`, "text/html");
  const raiz = doc.getElementById("raiz");
  if (!raiz) return "";

  const BLOCOS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "BLOCKQUOTE"]);
  let saida = "";

  const paragrafo = (runs: string, alinha?: string, lista?: "ul" | "ol") => {
    if (!runs.trim()) return;
    const jc = alinha === "center" ? "center" : alinha === "right" ? "right"
      : alinha === "left" ? "left" : "both";
    saida += "<w:p><w:pPr>" +
      '<w:spacing w:line="360" w:lineRule="auto" w:after="0"/>' +
      (lista ? '<w:ind w:left="709" w:hanging="283"/>' : '<w:ind w:firstLine="709"/>') +
      `<w:jc w:val="${jc}"/></w:pPr>` + runs + "</w:p>";
  };

  const estilo = (el: HTMLElement, f: Fmt): Fmt => {
    const st = el.style;
    const tag = el.tagName;
    const nova: Fmt = { ...f };
    if (tag === "B" || tag === "STRONG" || st.fontWeight === "bold" || Number(st.fontWeight) >= 600) nova.b = true;
    if (tag === "I" || tag === "EM" || st.fontStyle === "italic") nova.i = true;
    if (tag === "U" || (st.textDecoration || "").includes("underline")) nova.u = true;
    const fam = st.fontFamily || el.getAttribute("face") || "";
    if (fam) nova.fonte = fam.split(",")[0].replace(/["']/g, "").trim();
    const tam = st.fontSize;
    if (tam && tam.endsWith("pt")) nova.tam = parseFloat(tam);
    else if (tam && tam.endsWith("px")) nova.tam = Math.round(parseFloat(tam) * 0.75);
    const c = corHex(st.color || el.getAttribute("color"));
    if (c) nova.cor = c;
    return nova;
  };

  /** Junta os runs de um bloco, descendo pelos filhos inline. */
  const runsDe = (no: Node, f: Fmt): string => {
    let out = "";
    no.childNodes.forEach((filho) => {
      if (filho.nodeType === 3) {
        const t = (filho.textContent || "").replace(/\s+/g, " ");
        if (t.trim()) out += `<w:r>${rPr(f)}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
      } else if (filho.nodeType === 1) {
        const el = filho as HTMLElement;
        if (el.tagName === "BR") { out += `<w:r>${rPr(f)}<w:br/></w:r>`; return; }
        if (BLOCOS.has(el.tagName)) return;            // tratado como bloco próprio
        out += runsDe(el, estilo(el, f));
      }
    });
    return out;
  };

  /** Percorre a árvore emitindo um parágrafo por bloco. */
  const percorrer = (no: Node, f: Fmt, lista?: "ul" | "ol", indice = { n: 0 }) => {
    const filhos = Array.from(no.childNodes);
    const temBloco = filhos.some((c) => c.nodeType === 1 && BLOCOS.has((c as HTMLElement).tagName));
    if (!temBloco) {
      const el = no as HTMLElement;
      paragrafo(runsDe(no, f), el.style?.textAlign, lista);
      return;
    }
    filhos.forEach((c) => {
      if (c.nodeType === 3) {
        const t = (c.textContent || "").trim();
        if (t) paragrafo(`<w:r>${rPr(f)}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`, undefined, lista);
        return;
      }
      if (c.nodeType !== 1) return;
      const el = c as HTMLElement;
      const nf = estilo(el, f);
      if (el.tagName === "UL" || el.tagName === "OL") {
        percorrer(el, nf, el.tagName === "UL" ? "ul" : "ol", { n: 0 });
        return;
      }
      if (el.tagName === "LI") {
        indice.n++;
        const marca = lista === "ol" ? `${indice.n}. ` : "• ";
        paragrafo(`<w:r>${rPr(nf)}<w:t xml:space="preserve">${marca}</w:t></w:r>` + runsDe(el, nf),
          el.style.textAlign, lista);
        return;
      }
      if (BLOCOS.has(el.tagName)) { percorrer(el, nf, lista, indice); return; }
      paragrafo(runsDe(el, nf), el.style.textAlign, lista);
    });
  };

  percorrer(raiz, {}, undefined);
  return saida;
}

/** Reduz o HTML do editor a texto puro com quebras de linha.
 *
 *  Campos que entram em CÉLULA de tabela (Observações, Envolvidos) não podem
 *  receber parágrafos OOXML — e muito menos HTML cru, que era o que acontecia:
 *  o texto do editor ia com <div>, <span> e &nbsp; direto para o documento. */
export function htmlParaTexto(html?: string): string | undefined {
  if (!html) return html;
  if (!/<[a-z][\s\S]*>/i.test(html) && !/&\w+;/.test(html)) return html;   // já é texto
  let t = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Legenda da figura: "Figura N" em NEGRITO e a descrição em texto normal.
 *  Arial 10, centralizada — o número é trocado depois, na ordem do documento. */
function legendaFigura(descricao: string): string {
  const fonte = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/>';
  return '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:before="120" w:after="0"/>' +
    `<w:jc w:val="center"/><w:rPr>${fonte}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${fonte}<w:b/></w:rPr><w:t xml:space="preserve">Figura ${MARCA_FIG}</w:t></w:r>` +
    `<w:r><w:rPr>${fonte}</w:rPr>` +
    `<w:t xml:space="preserve"> – ${esc(descricao)}</w:t></w:r></w:p>`;
}

/** Legenda de figura: Arial 10, centralizada, entrelinha simples. */
function legendaAbnt(texto: string, antes = false): string {
  return '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" ' +
    `w:before="${antes ? 120 : 0}" w:after="${antes ? 0 : 120}"/><w:jc w:val="center"/>` +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>' +
    `<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

/** Dimensões reais da imagem, para preservar a proporção.
 *  PNG: cabeçalho IHDR. JPEG: primeiro marcador SOF. */
function dimensoesImagem(dados: ArrayBuffer, ext: "png" | "jpeg"): { w: number; h: number } | null {
  const b = new Uint8Array(dados);
  try {
    if (ext === "png") {
      if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
      const ler = (o: number) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
      return { w: ler(16), h: ler(20) };
    }
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const marca = b[i + 1];
      // SOF0..SOF15, exceto DHT(c4), JPG(c8) e DAC(cc)
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  } catch { /* imagem ilegível: cai no padrão */ }
  return null;
}

/** Altura que mantém a proporção da imagem dentro de uma largura em cm. */
function alturaProporcional(img: { dados: ArrayBuffer; extensao: "png" | "jpeg" }, larguraCm: number): number {
  const d = dimensoesImagem(img.dados, img.extensao);
  const razao = d && d.w > 0 ? d.h / d.w : 0.72;      // 0,72 = padrão antigo
  return Math.round(larguraCm * razao * 100) / 100;
}

/** Figura centralizada. cx/cy em EMU (1 cm = 360000). */
function figuraXml(rId: string, idImg: number, larguraCm: number, alturaCm: number): string {
  const cx = Math.round(larguraCm * 360000);
  const cy = Math.round(alturaCm * 360000);
  return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${900 + idImg}" name="Figura ${idImg}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${900 + idImg}" name="Figura ${idImg}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

// ── Preenchimento das tabelas ────────────────────────────────────────────────

/** Limites do <w:p> que contém a posição dada. Cuidado: "<w:p" também casa
 *  com "<w:pPr", por isso conferimos o caractere seguinte. */
function limitesParagrafo(xml: string, pos: number): { ini: number; fim: number } | null {
  let i = pos;
  while (i >= 0) {
    const a = xml.lastIndexOf("<w:p", i);
    if (a === -1) return null;
    const c = xml[a + 4];
    if (c === ">" || c === " ") {
      const fim = xml.indexOf("</w:p>", a);
      return fim !== -1 && fim >= pos ? { ini: a, fim: fim + 6 } : null;
    }
    i = a - 1;
  }
  return null;
}

/**
 * Acrescenta o valor logo após um rótulo de célula ("Cliente...: " → "…: ACME").
 *
 * O valor entra como um RUN PRÓPRIO, com o negrito explicitamente desligado:
 * no modelo o rótulo é negrito, e emendar o valor no mesmo run faria o dado
 * sair em negrito também. Herda o resto da formatação (fonte, tamanho, cor)
 * para o dado não destoar do rótulo.
 */
function preencherRotulo(xml: string, rotuloBruto: string, valor?: string): string {
  if (!valor) return xml;
  // Os modelos variam nos espaços depois dos dois-pontos ("Unidade.: " vs
  // "Unidade.:  "), então casamos o rótulo sem o espaço final.
  const rotulo = rotuloBruto.replace(/\s+$/, "");

  // Runs completos (<w:r>…</w:r>) com o texto que cada um contribui.
  const reRun = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*<\/w:r>/g;
  const runs: { ini: number; fim: number; xml: string; texto: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = reRun.exec(xml)) !== null) {
    const texto = Array.from(m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g))
      .map((t) => t[1]).join("");
    runs.push({ ini: m.index, fim: m.index + m[0].length, xml: m[0], texto });
  }
  if (runs.length === 0) return trocarTexto(xml, rotulo, rotulo + valor);

  const concat = runs.map((r) => r.texto).join("");
  const pos = concat.indexOf(rotulo);
  if (pos === -1) return xml;
  const fimRotulo = pos + rotulo.length;

  // Run onde o rótulo TERMINA — o valor entra logo depois dele.
  let acc = 0, alvo = -1;
  for (let i = 0; i < runs.length; i++) {
    const fim = acc + runs[i].texto.length;
    if (fimRotulo <= fim && fimRotulo > acc) { alvo = i; break; }
    acc = fim;
  }
  if (alvo === -1) return trocarTexto(xml, rotulo, rotulo + valor);

  // Formatação do rótulo, sem o negrito.
  const mPr = runs[alvo].xml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  const interno = (mPr ? mPr[1] : "")
    .replace(/<w:b\/>|<w:b\s[^>]*\/>/g, "")
    .replace(/<w:bCs\/>|<w:bCs\s[^>]*\/>/g, "");
  const rPrValor = `<w:rPr><w:b w:val="0"/><w:bCs w:val="0"/>${interno}</w:rPr>`;

  // Valor com várias linhas vira PARÁGRAFOS de verdade, não <w:br/>.
  // Num parágrafo justificado, a linha que termina em quebra manual é
  // esticada até a margem (buracos entre as palavras); parágrafos separados
  // não sofrem disso e ainda respeitam o espaçamento do modelo.
  const linhas = String(valor).split(/\n+/).filter((l) => l.trim() !== "");
  if (linhas.length === 0) return xml;

  const runDe = (t: string) =>
    `<w:r>${rPrValor}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;

  // Alguns modelos já trazem um valor escrito depois do rótulo (ex.:
  // "Relatório: 47/MG/26"). Apagamos o que vem depois DENTRO DO MESMO
  // PARÁGRAFO — cada rótulo é um parágrafo próprio — para não emendar o valor
  // novo no antigo. Sem isso saía "Relatório: 47/MG/26 Rev047/MG/26".
  // Alguns modelos já trazem um valor escrito depois do rótulo (ex.:
  // "Relatório: 47/MG/26"). É preciso apagá-lo, senão o valor novo sai
  // emendado no antigo ("Relatório: 47/MG/26 Rev047/MG/26").
  //
  // A ORDEM importa: primeiro limpamos os runs seguintes, de trás para
  // frente (assim os deslocamentos dos anteriores continuam válidos) e só
  // depois reescrevemos o run do rótulo. Fazer o inverso invalida todos os
  // índices e corrompe o XML.
  let base = xml;
  const par = limitesParagrafo(xml, runs[alvo].ini);
  if (par) {
    for (let k = runs.length - 1; k > alvo; k--) {
      const r = runs[k];
      if (r.ini < par.ini || r.fim > par.fim) continue;      // fora do parágrafo
      if (!r.texto) continue;
      base = base.slice(0, r.ini) +
        r.xml.replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, '<w:t xml:space="preserve"></w:t>') +
        base.slice(r.fim);
    }
  }

  // O run do próprio rótulo pode carregar texto DEPOIS dele ("Procedimento: "
  // e "PO" no mesmo run): cortamos o excedente.
  const inicioAlvo = runs.slice(0, alvo).reduce((a, r) => a + r.texto.length, 0);
  let posInsercao = runs[alvo].fim;
  if (runs[alvo].texto.length > fimRotulo - inicioAlvo) {
    const soRotulo = runs[alvo].texto.slice(0, fimRotulo - inicioAlvo);
    const novoRun = runs[alvo].xml
      .replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, "")
      .replace("</w:r>", `<w:t xml:space="preserve">${esc(soRotulo)}</w:t></w:r>`);
    base = base.slice(0, runs[alvo].ini) + novoRun + base.slice(runs[alvo].fim);
    posInsercao = runs[alvo].ini + novoRun.length;
  }

  let saida = base.slice(0, posInsercao) + runDe(" " + linhas[0]) + base.slice(posInsercao);
  if (linhas.length === 1) return saida;

  // Parágrafo que contém o rótulo: os demais trechos entram como irmãos dele,
  // herdando o mesmo <w:pPr> (alinhamento, espaçamento).
  const posRun = posInsercao + runDe(" " + linhas[0]).length;
  const iniP = saida.lastIndexOf("<w:p", saida.lastIndexOf("<w:p", posRun) + 1) >= 0
    ? saida.lastIndexOf("<w:p", posRun) : -1;
  const fimP = saida.indexOf("</w:p>", posRun);
  if (iniP === -1 || fimP === -1) {
    // sem parágrafo identificável: cai para quebras simples
    return base.slice(0, posInsercao) +
      `<w:r>${rPrValor}<w:t xml:space="preserve"> ${esc(linhas[0])}</w:t>` +
      linhas.slice(1).map((l) => `<w:br/><w:t xml:space="preserve">${esc(l)}</w:t>`).join("") +
      "</w:r>" + base.slice(posInsercao);
  }
  const mPPr = saida.slice(iniP, fimP).match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = mPPr ? mPPr[0] : "";
  const extras = linhas.slice(1).map((l) => `<w:p>${pPr}${runDe(l)}</w:p>`).join("");
  return saida.slice(0, fimP + 6) + extras + saida.slice(fimP + 6);
}

/** Preenche a célula ao lado de um rótulo de linha (tabela "Dados do Tanque":
 *  Altura | ___ ). A célula-alvo está vazia, então injetamos um run novo. */
function preencherCelulaVizinha(xml: string, rotuloLinha: string, valor?: string): string {
  if (!valor) return xml;
  const reLinha = /<w:tr\b[\s\S]*?<\/w:tr>/g;
  let m: RegExpExecArray | null;
  while ((m = reLinha.exec(xml)) !== null) {
    const linha = m[0];
    if (!new RegExp(`<w:t[^>]*>\\s*${rotuloLinha}\\s*</w:t>`).test(linha)) continue;
    const celulas = linha.match(/<w:tc\b[\s\S]*?<\/w:tc>/g);
    if (!celulas || celulas.length < 2) continue;
    const alvo = celulas[1];
    if (textoDe(alvo) !== "") continue;               // já preenchida: não mexe
    const run = '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>' +
      `<w:t xml:space="preserve">${esc(valor)}</w:t></w:r>`;
    let nova = alvo;
    const posP = alvo.lastIndexOf("</w:p>");
    if (posP !== -1) nova = alvo.slice(0, posP) + run + alvo.slice(posP);
    else nova = alvo.replace("</w:tc>", `<w:p>${run}</w:p></w:tc>`);
    const linhaNova = linha.replace(alvo, nova);
    return xml.slice(0, m.index) + linhaNova + xml.slice(m.index + linha.length);
  }
  return xml;
}

/** Injeta um texto na última posição de uma célula (que costuma estar vazia). */
function injetarNaCelula(tcXml: string, valor: string, tamanho = 18): string {
  const run = `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${tamanho}"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(valor)}</w:t></w:r>`;
  const pos = tcXml.lastIndexOf("</w:p>");
  if (pos !== -1) return tcXml.slice(0, pos) + run + tcXml.slice(pos);
  return tcXml.replace("</w:tc>", `<w:p>${run}</w:p></w:tc>`);
}

/** Preenche a linha de dados do quadro de controle de revisão da capa.
 *
 *  O quadro tem 3 linhas: a PRIMEIRA é a linha de dados (vazia no modelo, com
 *  altura reservada), a segunda traz os rótulos (REVISÃO, STATUS, DATA…) e a
 *  terceira o texto de confidencialidade. Preenchemos as 6 células da primeira
 *  linha, na ordem dos rótulos. */
function preencherQuadroRevisao(xml: string, valores: (string | undefined)[]): string {
  if (valores.every((v) => !v)) return xml;
  const reTbl = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = reTbl.exec(xml)) !== null) {
    const tbl = m[0];
    if (!/>REVIS[ÃA]O</.test(tbl)) continue;
    const linhas = tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g);
    if (!linhas || linhas.length === 0) continue;
    const primeira = linhas[0];
    const celulas = primeira.match(/<w:tc\b[\s\S]*?<\/w:tc>/g);
    if (!celulas) continue;
    let novaLinha = primeira;
    for (let i = celulas.length - 1; i >= 0; i--) {
      const v = valores[i];
      if (!v) continue;
      novaLinha = novaLinha.replace(celulas[i], injetarNaCelula(celulas[i], v));
    }
    const novaTbl = tbl.replace(primeira, novaLinha);
    return xml.slice(0, m.index) + novaTbl + xml.slice(m.index + tbl.length);
  }
  return xml;
}

/** Ficha de equipamento: nome em negrito e tabela de duas colunas
 *  (rótulo | valor), sem bordas aparentes — espelha o relatório modelo. */
function fichaEquipamentoXml(
  f: { nome: string; especificacoes: { rotulo: string; valor: string }[]; foto?: { dados: ArrayBuffer; extensao: "png" | "jpeg" } },
  rIdFoto?: string,
  idImg = 1,
): string {
  const cab =
    '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:before="120" w:after="60"/>' +
    '<w:ind w:left="709"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/></w:rPr>' +
    `<w:t xml:space="preserve">${esc(f.nome)}</w:t></w:r></w:p>`;

  const especs = f.especificacoes || [];
  const temFoto = !!(f.foto && rIdFoto);
  if (especs.length === 0 && !temFoto) return cab;

  const semBorda =
    '<w:tblBorders><w:top w:val="none" w:sz="0"/><w:left w:val="none" w:sz="0"/>' +
    '<w:bottom w:val="none" w:sz="0"/><w:right w:val="none" w:sz="0"/>' +
    '<w:insideH w:val="none" w:sz="0"/><w:insideV w:val="none" w:sz="0"/></w:tblBorders>';

  const cel = (txt: string, negrito: boolean, larg: number) =>
    `<w:tc><w:tcPr><w:tcW w:w="${larg}" w:type="dxa"/></w:tcPr>` +
    '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:after="0"/>' +
    `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${negrito ? "<w:b/>" : ""}<w:sz w:val="20"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${negrito ? "<w:b/>" : ""}<w:sz w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(txt)}</w:t></w:r></w:p></w:tc>`;

  // Larguras: com foto, a ficha ocupa ~60% e a imagem ~40%.
  const larguraFotoCm = 6.2;
  const colEspec = temFoto ? [2600, 2900] : [3260, 5670];
  const larguraFicha = colEspec[0] + colEspec[1];

  const linhas = especs
    .filter((e) => (e.rotulo || "").trim() || (e.valor || "").trim())
    .map((e) => `<w:tr>${cel(e.rotulo || "", true, colEspec[0])}${cel(e.valor || "", false, colEspec[1])}</w:tr>`)
    .join("");

  const tabelaEspecs =
    `<w:tbl><w:tblPr>${semBorda}<w:tblW w:w="${larguraFicha}" w:type="dxa"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${colEspec[0]}"/><w:gridCol w:w="${colEspec[1]}"/></w:tblGrid>` +
    linhas + "</w:tbl>";

  if (!temFoto) {
    return cab +
      `<w:tbl><w:tblPr><w:tblInd w:w="709" w:type="dxa"/>${semBorda}` +
      `<w:tblW w:w="${larguraFicha}" w:type="dxa"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="${colEspec[0]}"/><w:gridCol w:w="${colEspec[1]}"/></w:tblGrid>` +
      linhas + "</w:tbl>" + espaco();
  }

  // Tabela externa: ficha à esquerda, foto à direita (centrada verticalmente).
  const alturaFoto = alturaProporcional(f.foto!, larguraFotoCm);
  const colFoto = Math.round(larguraFotoCm * 567) + 120;
  const celulaFoto =
    `<w:tc><w:tcPr><w:tcW w:w="${colFoto}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
    figuraXml(rIdFoto!, idImg, larguraFotoCm, alturaFoto) + "</w:tc>";

  return cab +
    `<w:tbl><w:tblPr><w:tblInd w:w="709" w:type="dxa"/>${semBorda}` +
    `<w:tblW w:w="${larguraFicha + colFoto}" w:type="dxa"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${larguraFicha}"/><w:gridCol w:w="${colFoto}"/></w:tblGrid>` +
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="${larguraFicha}" w:type="dxa"/></w:tcPr>` +
    tabelaEspecs + '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p></w:tc>' +
    celulaFoto + "</w:tr></w:tbl>" + espaco();
}

/** Título de tópico ("11. Ensaio…"): Arial 12 negrito, como no modelo. */
function tituloTopico(numero: number, titulo: string): string {
  return '<w:p><w:pPr><w:spacing w:before="240" w:after="120" w:line="240" w:lineRule="auto"/>' +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/></w:rPr>' +
    `<w:t xml:space="preserve">${numero}. ${esc(titulo)}:</w:t></w:r></w:p>`;
}

/** Título de subtópico (8.1, 8.2 …): Arial 12 em negrito, como no modelo. */
function tituloSubtopico(numero: string, titulo: string): string {
  return '<w:p><w:pPr><w:spacing w:before="180" w:after="60" w:line="240" w:lineRule="auto"/>' +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/></w:rPr>' +
    `<w:t xml:space="preserve">${esc(numero)} ${esc(titulo)}</w:t></w:r></w:p>`;
}

/** Parágrafo vazio de respiro entre fichas. */
function espaco(): string {
  return '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>';
}

/** Injeta parágrafos dentro da primeira célula de uma tabela vazia
 *  (as "caixas" do template, como a de Métodos). */
function injetarNaCaixa(tblXml: string, paragrafos: string): string {
  const pos = tblXml.lastIndexOf("</w:p>");
  if (pos !== -1) return tblXml.slice(0, pos + 6) + paragrafos + tblXml.slice(pos + 6);
  return tblXml.replace("</w:tc>", `${paragrafos}</w:tc>`);
}

// ── Geração ──────────────────────────────────────────────────────────────────

/** A capa é o tópico 0: tudo que vem antes do título "1." (título do relatório,
 *  cliente, endereço e o quadro de controle de revisão). Pode ser omitida. */
/** Parâmetros das tabelas de laudo, na ordem em que estão no modelo. */
export const LAUDO_PARAMETROS = [
  "Cor Aparente (mg Pt-Co/L)",
  "Turbidez (NTU)",
  "Coliformes Totais (P/A)",
  "Escherichia coli (P/A)",
  "Bactérias Heterotróficas (UFC/mL)",
];
/** Colunas de cada parâmetro, na ordem das células da tabela. */
export const LAUDO_COLUNAS = ["Valor", "Incerteza", "LQ", "LD", "Limite"];

/** Preenche as células "[dado coletado]" de uma tabela de laudo.
 *  A tabela é localizada pelo texto do cabeçalho ("Antes da Limpeza"). */
function preencherLaudo(xml: string, cabecalho: string, valores?: string[][]): string {
  if (!valores || valores.length === 0) return xml;
  const reTbl = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = reTbl.exec(xml)) !== null) {
    const tbl = m[0];
    if (!textoDe(tbl).toLowerCase().includes(cabecalho.toLowerCase())) continue;
    const linhas = tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g);
    if (!linhas) continue;
    let nova = tbl;
    // linha 0 é o cabeçalho; a partir daí, uma linha por parâmetro
    linhas.slice(1).forEach((linha, i) => {
      const dados = valores[i];
      if (!dados) return;
      const celulas = linha.match(/<w:tc\b[\s\S]*?<\/w:tc>/g);
      if (!celulas) return;
      let linhaNova = linha;
      // célula 0 é o nome do parâmetro; as seguintes recebem os valores
      celulas.slice(1).forEach((cel, j) => {
        const v = dados[j];
        if (!v || !textoDe(cel).includes("[dado coletado]")) return;
        linhaNova = linhaNova.replace(cel, trocarTexto(cel, "[dado coletado]", v));
      });
      nova = nova.replace(linha, linhaNova);
    });
    return xml.slice(0, m.index) + nova + xml.slice(m.index + tbl.length);
  }
  return xml;
}

export const TOPICO_CAPA = { numero: 0, titulo: "Capa e controle de revisão" };

/** Títulos originais do template, na ordem. Usados para localizar as seções. */
export const TOPICOS_PADRAO: { numero: number; titulo: string }[] = [
  { numero: 1, titulo: "Identificação do local" },
  { numero: 2, titulo: "Identificação do tanque" },
  { numero: 3, titulo: "Métodos" },
  { numero: 4, titulo: "Equipamentos utilizados" },
  { numero: 5, titulo: "Equipe de trabalho" },
  { numero: 6, titulo: "Dados reservatório" },
  { numero: 7, titulo: "Batimetria" },
  { numero: 8, titulo: "Foto da Inspeção Visual Interna" },
  { numero: 9, titulo: "Conclusão" },
  { numero: 10, titulo: "Recomendações" },
];

/**
 * Chaves canônicas de tópico, reconhecidas pelo TÍTULO.
 *
 * O número de um tópico muda de um modelo para outro — no de batimetria
 * "Equipe de trabalho" é o 5, no do POP 001 é o 6; "Recomendações" é o 10 num
 * e o 14 no outro. Amarrar conteúdo ao número faria o texto cair na seção
 * errada. Por isso identificamos cada seção pelo título e só então
 * descobrimos que número ela tem NAQUELE modelo.
 */
const CHAVES_TOPICO: { chave: string; re: RegExp }[] = [
  { chave: "local", re: /identifica[çc][ãa]o do local/i },
  { chave: "tanque", re: /identifica[çc][ãa]o do tanque/i },
  { chave: "metodos", re: /^\s*\d+\.?\s*m[ée]todos?\b/i },
  { chave: "equipamentos", re: /equipamentos?\s+utilizados?/i },
  { chave: "anexos", re: /^\s*\d+\.?\s*anexos\b/i },
  { chave: "equipe", re: /equipe de trabalho/i },
  { chave: "reservatorio", re: /dados\s+(do\s+)?reservat[óo]rio/i },
  { chave: "batimetria", re: /^\s*\d+\.?\s*batimetria\b/i },
  { chave: "sanitizacao", re: /sanitiza[çc][ãa]o/i },
  { chave: "coletas", re: /coletas?\s+das?\s+amostras/i },
  { chave: "limpeza", re: /limpeza\s+robotizada/i },
  { chave: "apos-limpeza", re: /imagens?\s+ap[óo]s\s+a\s+limpeza/i },
  { chave: "analise", re: /an[áa]lise\s+f[íi]sico/i },
  { chave: "fotos-internas", re: /inspe[çc][ãa]o visual interna/i },
  { chave: "observacoes", re: /^\s*\d+\.?\s*observa[çc][õo]es/i },
  { chave: "conclusao", re: /^\s*\d+\.?\s*conclus[ãa]o/i },
  { chave: "recomendacoes", re: /^\s*\d+\.?\s*recomenda[çc][õo]es/i },
];

/** Chave canônica de um título de tópico, ou null se não reconhecido. */
function chaveDoTitulo(texto: string): string | null {
  return CHAVES_TOPICO.find((c) => c.re.test(texto))?.chave || null;
}

/** Detecta o número do tópico de nível 1 num bloco ("7. Batimetria:" → 7). */
function numeroTopico(texto: string): number | null {
  // Os modelos são irregulares: "1. Identificação", "8.Sanitização" (sem
  // espaço) e "11 Imagens" (sem ponto) são todos títulos de tópico. Já
  // "9.1 Imagens" é SUBtópico e não pode casar — daí o cuidado de exigir que
  // depois do separador venha algo que não seja dígito.
  const m = texto.match(/^(\d{1,2})(?:\.\s*|\s+)(?=[^\d\s])/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // O modelo do POP 001 vai até 14; não limitamos mais a 10.
  return n >= 1 && n <= 30 ? n : null;
}

/** Marcador de imagem do modelo: [imagem], [Imagem2], [IMAGEM DO LAUDO]… */
const RE_VAGA = /\[\s*imagem[^\]]*\]/i;

export interface VagaImagem {
  /** Posição na ordem do documento. */
  indice: number;
  /** Tópico do modelo a que a vaga pertence. */
  topico: number;
  /** Legenda que o modelo já traz logo abaixo do marcador. */
  legenda: string;
  /** Texto do marcador, para exibição. */
  marcador: string;
}

/**
 * Lista as vagas de imagem de um modelo, na ordem do documento.
 *
 * O modelo do POP 001 já traz a legenda escrita ("Figura 3- Ponto de coleta
 * higienizado…") logo abaixo de cada marcador. Em vez de recriar essas
 * legendas no código, lemos o próprio arquivo: o formulário mostra a legenda
 * de cada vaga e o usuário só anexa a foto correspondente.
 */
export async function lerVagasDeImagem(templateUrl?: string): Promise<VagaImagem[]> {
  const JSZip = (await import("jszip")).default;
  const resp = await fetch(templateUrl || "/templates/relatorio-asp-v3.docx");
  if (!resp.ok) return [];
  const zip = await JSZip.loadAsync(await resp.arrayBuffer());
  const doc = zip.file("word/document.xml");
  if (!doc) return [];
  const xml = await doc.async("string");
  const body = xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("</w:body>"));
  const blocos = separarBlocos(body);

  const vagas: VagaImagem[] = [];
  let topicoAtual = 0;
  blocos.forEach((b, i) => {
    const n = numeroTopico(b.texto);
    if (n !== null) topicoAtual = n;
    const achados = b.texto.match(new RegExp(RE_VAGA.source, "gi")) || [];
    achados.forEach((marcador) => {
      // legenda = primeiro bloco seguinte que começa com "Figura"
      let legenda = "";
      for (let k = i + 1; k < Math.min(i + 4, blocos.length); k++) {
        if (/^Figura\s/i.test(blocos[k].texto)) { legenda = blocos[k].texto; break; }
      }
      vagas.push({ indice: vagas.length, topico: topicoAtual, legenda, marcador });
    });
  });
  return vagas;
}

/** Gera o .docx preenchido. Devolve um Blob pronto para download. */
export async function gerarRelatorioDocx(dados: DadosRelatorio): Promise<Blob> {
  const JSZip = (await import("jszip")).default;

  // Cada procedimento pode ter o seu modelo; sem isso, usa o padrão da ASP.
  const resp = await fetch(dados.templateUrl || "/templates/relatorio-asp-v3.docx");
  if (!resp.ok) throw new Error("Não foi possível carregar o modelo do relatório.");
  const zip = await JSZip.loadAsync(await resp.arrayBuffer());

  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Modelo inválido: falta word/document.xml.");
  let xml = await docFile.async("string");

  // 1) Margens ABNT.
  //
  // Antes disso, ancoramos as imagens de cabeçalho/rodapé à PÁGINA. Elas
  // costumam vir ancoradas à COLUNA de texto: ao mudarmos a margem esquerda
  // para o padrão ABNT, todas escorregariam para a direita e o logo da borda
  // sairia do papel. Convertendo o deslocamento (somando a margem ORIGINAL),
  // a posição fica independente das margens — vale para qualquer modelo
  // enviado no Catálogo, não só para os nossos.
  const margemOriginal = Number(xml.match(/<w:pgMar\b[^>]*w:left="(\d+)"/)?.[1] || 0);
  if (margemOriginal) {
    const emuMargem = margemOriginal * 635;                 // 1 twip = 635 EMU
    for (const nome of Object.keys(zip.files)) {
      if (!/^word\/(header|footer)\d*\.xml$/.test(nome)) continue;
      const arq = zip.file(nome);
      if (!arq) continue;
      let hx = await arq.async("string");
      const antes = hx;
      hx = hx.replace(
        /<wp:positionH relativeFrom="column"><wp:posOffset>(-?\d+)<\/wp:posOffset>/g,
        (_m, off) => `<wp:positionH relativeFrom="page"><wp:posOffset>${Number(off) + emuMargem}</wp:posOffset>`
      );
      if (hx !== antes) zip.file(nome, hx);
    }
  }

  xml = aplicarMargensAbnt(xml);

  // 2) Marcadores simples
  // O título vai inteiro, como digitado — o modelo não traz mais prefixo.
  xml = trocarMarcador(xml, "[TITULO]", dados.titulo);
  // Os modelos escrevem os marcadores com caixas diferentes ([CLIENTE] num,
  // [Cliente] noutro) — cobrimos as variantes.
  for (const m of ["[CLIENTE]", "[Cliente]", "[cliente]"]) xml = trocarMarcador(xml, m, dados.cliente);
  for (const m of ["[Endereço]", "[ENDEREÇO]", "[endereço]", "[Endereco]"]) {
    xml = trocarMarcador(xml, m, dados.endereco);
  }
  xml = trocarMarcador(xml, "[Volume de sedimento]", dados.volumeSedimento || "—");
  xml = trocarMarcador(xml, "[data de realização do relatorio]", dados.dataRelatorio || "");
  // Texto padrão do POP 001: data da operação e os quatro horários, na ordem
  // em que aparecem (chegada, início, fim, saída).
  if (dados.dataOperacao) xml = trocarMarcador(xml, "[data]", dados.dataOperacao);
  (dados.horarios || []).forEach((h) => {
    if (h) xml = trocarTexto(xml, "[horario]", h);      // troca uma ocorrência por vez
  });
  // Tópico "Limpeza robotizada" do POP 001.
  xml = trocarMarcador(xml, "[volume do sedimento]", dados.volumeSedimento || "");
  xml = trocarMarcador(xml, "[altura de sedimento]", dados.alturaSedimento || "");
  xml = trocarMarcador(xml, "[data de realização]", dados.dataExecucao || "");

  // Valores das coletas: a troca é DIRIGIDA pela legenda, não pela ordem —
  // "[dado coletado]" aparece dezenas de vezes no modelo (tabelas do laudo) e
  // uma substituição sequencial acertaria a ocorrência errada.
  const valorNaLegenda = (trecho: string, valor?: string) => {
    if (!valor) return;
    // Procuramos pelo TEXTO VISÍVEL do parágrafo: o Word fragmenta a legenda
    // em vários runs, então casar no XML cru não funcionaria.
    const re = /<w:p\b[\s\S]*?<\/w:p>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const texto = textoDe(m[0]);
      if (!texto.includes("[dado coletado]")) continue;
      if (!texto.toLowerCase().includes(trecho.toLowerCase())) continue;
      const novoP = trocarTexto(m[0], "[dado coletado]", valor);
      xml = xml.slice(0, m.index) + novoP + xml.slice(m.index + m[0].length);
      return;
    }
  };
  valorNaLegenda("cloro livre antes", dados.cloroAntes);
  valorNaLegenda("cloro livre depois", dados.cloroDepois);
  valorNaLegenda("pH antes", dados.phAntes);
  valorNaLegenda("pH depois", dados.phDepois);

  xml = preencherLaudo(xml, "Antes da Limpeza", dados.laudoAntes);
  xml = preencherLaudo(xml, "Após a Limpeza", dados.laudoDepois);

  // A unidade/cliente aparece no texto padrão; aceita marcador e também o nome
  // que veio escrito no modelo original.
  const unidadeTexto = dados.unidade || dados.cliente || "";
  if (unidadeTexto) {
    xml = trocarMarcador(xml, "[unidade]", unidadeTexto);
    xml = trocarMarcador(xml, "Dow Hortolândia", unidadeTexto);
  }

  // 3) Quadro de controle de revisão (capa), na ordem dos rótulos
  // O quadro tem 6 colunas no modelo de batimetria e 7 no do POP 001, que
  // acrescenta "REVISADO POR" entre CHECADO e APROVADO. Passamos as 7 e a
  // função ignora as que sobram quando a tabela é menor.
  xml = preencherQuadroRevisao(xml, [
    dados.revisao, dados.statusRevisao, dados.dataRevisao,
    dados.preparadoPor, dados.checadoPor,
    ...(dados.revisadoPorCapa ? [dados.revisadoPorCapa] : []),
    dados.aprovadoPor,
  ]);
  xml = preencherRotulo(xml, "Relatório: ", dados.relatorioCodigo);
  xml = preencherRotulo(xml, "Procedimento: ", dados.procedimento);

  // 4) Tabelas (rótulo + valor)
  xml = preencherRotulo(xml, "Cliente...: ", dados.cliente);
  xml = preencherRotulo(xml, "Unidade.:  ", dados.unidade);
  xml = preencherRotulo(xml, "Contato.: ", dados.contato);
  xml = preencherRotulo(xml, "Execução...: ", dados.dataExecucao);
  // "Relatório.:" do tópico 1 leva o código do projeto (não a data).
  xml = preencherRotulo(xml, "Relatório.: ", dados.relatorioCodigo);
  xml = preencherRotulo(xml, "TAG: ", dados.tag);
  xml = preencherRotulo(xml, "Área: ", dados.area);
  xml = preencherRotulo(xml, "Material: ", dados.material);
  xml = preencherRotulo(xml, "Capacidade Nominal: ", dados.capacidadeNominal);
  xml = preencherRotulo(xml, "Altura do tanque: ", dados.alturaTanque);
  xml = preencherRotulo(xml, "Altura: ", dados.alturaTanque);      // rótulo curto do POP 001
  xml = preencherRotulo(xml, "Diâmetro: ", dados.diametro);
  xml = preencherRotulo(xml, "Histórico: ", dados.historico);
  xml = preencherRotulo(xml, "Nível da água: ", dados.nivelAgua);
  xml = preencherRotulo(xml, "Comprimento: ", dados.comprimento);
  xml = preencherRotulo(xml, "Largura: ", dados.largura);
  xml = preencherRotulo(xml, "Observações:  ", htmlParaTexto(dados.observacoesTanque));
  // Envolvidos: um por linha, como no relatório de referência.
  const equipeTxt = htmlParaTexto(dados.equipe);
  xml = preencherRotulo(xml, "Envolvidos:", equipeTxt ? "\n" + equipeTxt : undefined);
  // Bloco de assinaturas
  xml = preencherRotulo(xml, "Relatório elaborado por:", dados.elaboradoPor ? " " + dados.elaboradoPor : undefined);
  xml = preencherRotulo(xml, "Relatório revisado por:", dados.revisadoPor ? " " + dados.revisadoPor : undefined);
  // Tópico 6 — quadro "Dados do Tanque": células vazias ao lado dos rótulos.
  xml = preencherCelulaVizinha(xml, "Altura", dados.alturaTanque);
  xml = preencherCelulaVizinha(xml, "Diâmetro", dados.diametro);
  xml = preencherCelulaVizinha(xml, "Comprimento", dados.comprimento);
  xml = preencherCelulaVizinha(xml, "Largura", dados.largura);
  xml = preencherCelulaVizinha(xml, "Capacidade", dados.capacidadeTanque || dados.capacidadeNominal);
  // A linha "Equipamento" vem preenchida no modelo: trocamos pelo tipo informado.
  if (dados.equipamentoTanque) {
    xml = trocarTexto(xml, "Tanque de combate a incêndio", dados.equipamentoTanque);
  }

  // Tópico 7 — o modelo traz um intervalo fixo de um relatório antigo
  // ("entre 1,43 e 1,58 m³"). Substituímos pela faixa de ±5% desta medição.
  if (dados.volumeMin && dados.volumeMax) {
    const faixa = `${dados.volumeMin} e ${dados.volumeMax} m³`;
    const antes = xml;
    xml = trocarTexto(xml, "entre1,43 e 1,58 m³", `entre ${faixa}`);
    if (xml === antes) xml = trocarTexto(xml, "1,43 e 1,58 m³", faixa);
  }

  // 4) Imagens: registra no ZIP + relationships + content types
  // Fotos das fichas de equipamento entram na mesma fila de registro das
  // figuras — o ZIP e o arquivo de relações são únicos.
  const fotosFicha = (dados.equipamentosFicha || [])
    .map((f, i) => ({ i, foto: f.foto }))
    .filter((x): x is { i: number; foto: { dados: ArrayBuffer; extensao: "png" | "jpeg" } } => !!x.foto);
  const rIdDaFicha = new Map<number, string>();

  const rels: { rId: string; nome: string }[] = [];
  const paraRegistrar: { dados: ArrayBuffer; extensao: "png" | "jpeg" }[] = [
    ...(dados.imagens || []),
    ...fotosFicha.map((x) => x.foto),
  ];
  if (paraRegistrar.length > 0) {
    const relsPath = "word/_rels/document.xml.rels";
    const relsFile = zip.file(relsPath);
    let relsXml = relsFile ? await relsFile.async("string") : "";
    let ctXml = (await zip.file("[Content_Types].xml")?.async("string")) || "";

    let proximo = 900;
    for (let i = 0; i < paraRegistrar.length; i++) {
      const img = paraRegistrar[i];
      const nome = `asp${i + 1}.${img.extensao}`;
      zip.file(`word/media/${nome}`, img.dados);
      const rId = `rIdASP${proximo++}`;
      relsXml = relsXml.replace(
        "</Relationships>",
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nome}"/></Relationships>`
      );
      rels.push({ rId, nome });
      // garante a extensão declarada
      if (!ctXml.includes(`Extension="${img.extensao}"`)) {
        const mime = img.extensao === "png" ? "image/png" : "image/jpeg";
        ctXml = ctXml.replace("<Types ", `<Types `).replace(
          /(<Types[^>]*>)/,
          `$1<Default Extension="${img.extensao}" ContentType="${mime}"/>`
        );
      }
    }
    zip.file(relsPath, relsXml);
    if (ctXml) zip.file("[Content_Types].xml", ctXml);
    // as fotos de ficha vêm depois das figuras na fila de registro
    const base = (dados.imagens || []).length;
    fotosFicha.forEach((x, k) => rIdDaFicha.set(x.i, rels[base + k].rId));
  }

  // 5) Tópicos: montar blocos, aplicar conteúdo, ocultar e renumerar
  const iniBody = xml.indexOf("<w:body>") + 8;
  const fimBody = xml.lastIndexOf("</w:body>");
  const body = xml.slice(iniBody, fimBody);
  const blocos = separarBlocos(body);

  // mapeia o índice inicial de cada tópico
  const inicioDoTopico = new Map<number, number>();
  blocos.forEach((b, idx) => {
    const n = numeroTopico(b.texto);
    if (n !== null && !inicioDoTopico.has(n)) inicioDoTopico.set(n, idx);
  });

  // Qual número cada seção tem NESTE modelo (ver CHAVES_TOPICO).
  const numeroDaChave = new Map<string, number>();
  blocos.forEach((b) => {
    const n = numeroTopico(b.texto);
    if (n === null) return;
    const chave = chaveDoTitulo(b.texto);
    if (chave && !numeroDaChave.has(chave)) numeroDaChave.set(chave, n);
  });

  const ocultos = new Set(dados.topicos.filter((t) => !t.visivel).map((t) => t.numero));
  // Texto de cada tópico: entra logo DEPOIS do título, não no fim da seção
  // (o template tem parágrafos vazios de respiro que jogariam o texto adiante).
  const textoDoTopico = new Map<number, string>();
  const addTexto = (n: number, s: string) =>
    textoDoTopico.set(n, (textoDoTopico.get(n) || "") + s);
  // "Anexos" existe só no modelo do POP 001 e numa posição diferente da do
  // outro modelo, por isso é localizado pelo TÍTULO. Se o modelo não tiver
  // esse tópico, o conteúdo simplesmente não é usado.
  /** Envia conteúdo para a seção com aquela CHAVE, seja qual for o número
   *  que ela tenha neste modelo. Seção inexistente = conteúdo ignorado. */
  const addPorChave = (chave: string, conteudo: string) => {
    const n = numeroDaChave.get(chave);
    if (n !== undefined && conteudo) addTexto(n, conteudo);
  };

  if (dados.anexos?.trim()) addPorChave("anexos", htmlParaParagrafos(dados.anexos));
  if (dados.metodos) addPorChave("metodos", htmlParaParagrafos(dados.metodos));
  (dados.equipamentosFicha || []).forEach((f, i) =>
    addPorChave("equipamentos", fichaEquipamentoXml(f, rIdDaFicha.get(i), 500 + i)));
  if (dados.equipamentos) addPorChave("equipamentos", htmlParaParagrafos(dados.equipamentos));
  if (dados.fotosInternas) addPorChave("fotos-internas", htmlParaParagrafos(dados.fotosInternas));
  if (dados.conclusao) addPorChave("conclusao", htmlParaParagrafos(dados.conclusao));
  if (dados.recomendacoes) addPorChave("recomendacoes", htmlParaParagrafos(dados.recomendacoes));

  // Figuras: legenda ABNT acima ("Figura N – …") e fonte abaixo. As que têm
  // âncora ("6.1") entram logo abaixo daquele subtítulo; as demais, na seção.
  const figurasDoTopico = new Map<number, string>();
  const figurasDaAncora = new Map<string, string>();
  /** Fotos destinadas às VAGAS do modelo, na ordem, por tópico. Ficam sem
   *  legenda gerada porque o modelo já traz a legenda de cada vaga. */
  const vagasDoTopico = new Map<number, string[]>();
  (dados.imagens || []).forEach((img, i) => {
    if (ocultos.has(img.topico)) return;
    const rId = rels[i]?.rId;
    if (!rId) return;
    const largura = img.larguraCm || 15;
    // Proporção real do arquivo — o fator fixo de antes achatava as fotos.
    const altura = alturaProporcional(img, largura);
    // Legenda ABAIXO da figura (padrão adotado pela ASP), seguida da fonte.
    const bloco =
      figuraXml(rId, i + 1, largura, altura) +
      legendaFigura(img.legenda) +
      legendaAbnt(`Fonte: ${img.fonte || "ASP Serviços Industriais"}`);
    if (img.vaga) {
      // Vai para uma vaga do modelo: só a figura, sem legenda nem fonte —
      // o modelo já traz a legenda escrita logo abaixo da vaga.
      const so = figuraXml(rId, i + 1, largura, altura);
      const lista = vagasDoTopico.get(img.topico) || [];
      lista.push(so);
      vagasDoTopico.set(img.topico, lista);
    } else if (img.ancora) {
      figurasDaAncora.set(img.ancora, (figurasDaAncora.get(img.ancora) || "") + bloco);
    } else {
      figurasDoTopico.set(img.topico, (figurasDoTopico.get(img.topico) || "") + bloco);
    }
  });

  const MARCADOR_IMAGENS = "[Imagens grafica da batimetria]";

  /** Um parágrafo é uma VAGA de imagem quando seu texto é só um marcador:
   *  [imagem], [Imagem2], [imagem3], [IMAGEM DO LAUDO]… O modelo do POP 001
   *  usa isso para fixar a posição — e a legenda logo abaixo já vem escrita. */
  const ehVagaDeImagem = (t: string) => /^\[\s*(imagem\s*\d*|imagem do laudo)\s*\]$/i.test(t.trim());
  /** Legenda que acompanha uma vaga ("Figura 7- …"). Some junto com a vaga
   *  quando não há foto, para não sobrar legenda órfã. */
  const ehLegendaDeFigura = (t: string) => /^figura\s*\d+\s*[-–]/i.test(t.trim());

  // reconstrói o corpo bloco a bloco
  const ordem = Array.from(inicioDoTopico.entries()).sort((a, b) => a[1] - b[1]);
  const fimDoTopico = new Map<number, number>();
  ordem.forEach(([n, ini], k) => {
    const proximoIni = k + 1 < ordem.length ? ordem[k + 1][1] : blocos.length;
    fimDoTopico.set(n, proximoIni);
  });

  // novo número de cada tópico visível (renumeração sequencial)
  // Tópicos próprios do procedimento: cada um sabe depois de qual tópico
  // padrão entra (`apos`), então podem ficar no meio dos demais.
  const extras = (dados.topicosExtras || []).filter((e) => e?.titulo?.trim() || e?.texto?.trim());
  const aposDo = (i: number) => Math.max(0, Math.min(10, extras[i].apos ?? 10));
  const extrasApos = (k: number) =>
    extras.map((_, i) => i).filter((i) => aposDo(i) === k);

  const novoNumero = new Map<number, number>();
  const numeroExtra = new Map<number, number>();
  let seq = 0;
  extrasApos(0).forEach((i) => numeroExtra.set(i, ++seq));
  TOPICOS_PADRAO.forEach((t) => {
    if (!ocultos.has(t.numero)) novoNumero.set(t.numero, ++seq);
    extrasApos(t.numero).forEach((i) => numeroExtra.set(i, ++seq));
  });

  /** Bloco XML de um tópico extra: título numerado, texto e fotos. */
  const xmlExtra = (i: number): string => {
    const e = extras[i];
    const ancora = `extra-${i}`;
    const figs = figurasDaAncora.get(ancora) || "";
    figurasDaAncora.delete(ancora);
    return tituloTopico(numeroExtra.get(i) ?? 0, e.titulo || "") +
      (e.texto ? htmlParaParagrafos(e.texto) : "") + figs;
  };

  // Tópico 8 — subtópicos criados pelo usuário (8.1, 8.2 …), cada um com o
  // seu título e as suas fotos. A numeração segue o número FINAL do tópico,
  // para continuar certa quando algum tópico anterior é ocultado.
  const nFotosInternas = numeroDaChave.get("fotos-internas") ?? 8;
  if (!ocultos.has(nFotosInternas) && (dados.subtopicos8 || []).length > 0) {
    const n8 = novoNumero.get(nFotosInternas) ?? nFotosInternas;
    let bloco8 = "";
    (dados.subtopicos8 || []).forEach((st, i) => {
      const ancora = `sub8-${i}`;
      const figs = figurasDaAncora.get(ancora) || "";
      if (!st.titulo?.trim() && !figs) return;      // subtópico vazio: ignora
      bloco8 += tituloSubtopico(`${n8}.${i + 1}`, st.titulo || "");
      bloco8 += figs;
      figurasDaAncora.delete(ancora);
    });
    if (bloco8) addTexto(nFotosInternas, bloco8);
  }

  const extrasEmitidos = new Set<number>();
  let saida = "";
  /** Emite os tópicos próprios cuja posição já passou (até `ate`, inclusive). */
  const emitirExtrasAte = (ate: number) => {
    extras.forEach((_, i) => {
      if (!extrasEmitidos.has(i) && aposDo(i) <= ate) {
        saida += xmlExtra(i);
        extrasEmitidos.add(i);
      }
    });
  };

  // Capa (tópico 0): se desmarcada, começamos direto no título "1.".
  const capaOculta = dados.topicos.some((t) => t.numero === 0 && !t.visivel);
  let idx = capaOculta ? (inicioDoTopico.get(1) ?? 0) : 0;
  while (idx < blocos.length) {
    const nTop = numeroTopico(blocos[idx].texto);
    if (nTop !== null && inicioDoTopico.get(nTop) === idx) {
      const fim = fimDoTopico.get(nTop) ?? blocos.length;
      // tudo que devia entrar ANTES deste tópico (inclusive de tópicos ocultos)
      emitirExtrasAte(nTop - 1);
      if (ocultos.has(nTop)) { idx = fim; continue; }          // tópico oculto: pula tudo
      const novo = novoNumero.get(nTop) ?? nTop;
      const figuras = figurasDoTopico.get(nTop);
      let figurasUsadas = false;
      for (let k = idx; k < fim; k++) {
        let bx = blocos[k].xml;
        const t = blocos[k].texto;
        // renumera o título e também os subtítulos (6.1, 6.2 → 5.1, 5.2)
        if (novo !== nTop && new RegExp(`^\\s*${nTop}(\\.|\\s|$)`).test(t)) {
          bx = renumerarBloco(bx, nTop, novo);
        }
        // o marcador de imagens dá lugar às figuras (some se não houver)
        if (t.includes(MARCADOR_IMAGENS)) {
          if (figuras) { saida += figuras; figurasUsadas = true; }
          continue;
        }
        // Vagas DENTRO de uma tabela (a grade 2×2 da sanitização): cada
        // célula tem seu marcador, então trocamos parágrafo a parágrafo.
        if (bx.startsWith("<w:tbl>") && /\[\s*(imagem\s*\d*|imagem do laudo)\s*\]/i.test(t)) {
          const lista = vagasDoTopico.get(nTop) || [];
          bx = bx.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (par) => {
            if (!ehVagaDeImagem(textoDe(par))) return par;
            const foto = lista.shift();
            if (!foto) return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
            figurasUsadas = true;
            return foto;
          });
          vagasDoTopico.set(nTop, lista);
          saida += bx;
          continue;
        }
        // Vaga de imagem do modelo: entra a próxima foto deste tópico, SEM
        // legenda gerada — a legenda já está escrita no modelo, logo abaixo.
        // Sem foto, a vaga e a legenda dela são removidas.
        if (ehVagaDeImagem(t)) {
          const vaga = vagasDoTopico.get(nTop);
          const proxima = vaga && vaga.length > 0 ? vaga.shift() : null;
          if (proxima) { saida += proxima; figurasUsadas = true; }
          else {
            // a legenda pode vir 1 ou 2 blocos adiante (há parágrafos de
            // respiro no modelo): descartamos a primeira que aparecer.
            for (let j = k + 1; j < Math.min(k + 3, fim); j++) {
              if (ehLegendaDeFigura(blocos[j].texto)) {
                for (let z = k + 1; z <= j; z++) if (z !== j) saida += blocos[z].xml;
                k = j;
                break;
              }
            }
          }
          continue;
        }
        // Caixa vazia logo após o título (ex.: Métodos): o texto entra DENTRO
        // dela, que é para isso que existe no modelo.
        const txtTopico = textoDoTopico.get(nTop);
        if (txtTopico && k === idx + 1 && bx.startsWith("<w:tbl>") && t === "") {
          saida += injetarNaCaixa(bx, txtTopico);
          textoDoTopico.delete(nTop);
          continue;
        }
        saida += bx;
        // Figuras ancoradas em subtítulo (6.1, 6.2, 6.3) entram logo abaixo dele.
        // A comparação usa o texto ORIGINAL do bloco, antes da renumeração.
        for (const [ancora, fig] of figurasDaAncora) {
          if (t.startsWith(ancora)) { saida += fig; figurasDaAncora.delete(ancora); }
        }
        // sem caixa: o texto vem logo após o título
        if (k === idx && txtTopico && !(idx + 1 < fim && blocos[idx + 1].xml.startsWith("<w:tbl>") && blocos[idx + 1].texto === "")) {
          saida += txtTopico;
          textoDoTopico.delete(nTop);
        }
      }
      // figuras de tópicos sem marcador próprio entram ao final da seção
      if (figuras && !figurasUsadas) saida += figuras;
      emitirExtrasAte(nTop);                    // os que vêm logo depois dele
      idx = fim;
      continue;
    }
    saida += blocos[idx].xml;
    idx++;
  }

  // O <w:sectPr> final (margens + referência a cabeçalho/rodapé) fica no fim do
  // body e NÃO é um bloco w:p/w:tbl — precisa ser recolocado, senão o documento
  // perde o timbre e volta às margens padrão.
  emitirExtrasAte(10);                        // o que sobrou fecha o documento

  const fimUltimoBloco = blocos.length > 0 ? blocos[blocos.length - 1].fim : 0;
  saida += body.slice(fimUltimoBloco);

  // Numera as figuras na ORDEM DO DOCUMENTO (e não na ordem em que foram
  // anexadas), como manda a ABNT.
  let nFig = 0;
  saida = saida.split(MARCA_FIG).reduce((acc, parte, i) =>
    i === 0 ? parte : acc + String(++nFig) + parte, "");

  xml = xml.slice(0, iniBody) + saida + xml.slice(fimBody);
  zip.file("word/document.xml", xml);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
