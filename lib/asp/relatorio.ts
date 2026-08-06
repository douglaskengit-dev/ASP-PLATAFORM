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
 *   5. inserção das imagens (mapa de calor, 3D, fotos) com legenda ABNT.
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
  /** Legenda ABNT — vai ACIMA da figura ("Figura N – …"). */
  legenda: string;
  /** Fonte da figura — vai ABAIXO ("Fonte: …"). */
  fonte?: string;
  /** Largura em cm (padrão 15, cabe na mancha ABNT de 16 cm). */
  larguraCm?: number;
  /** Em qual tópico entra (número original). */
  topico: number;
  /** Subtópico de destino ("6.1", "6.2", "6.3"). A figura entra logo abaixo
   *  daquele subtítulo, em vez de no fim da seção. */
  ancora?: string;
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
  equipamentosFicha?: { nome: string; especificacoes: { rotulo: string; valor: string }[] }[];
  equipe?: string;
  volumeSedimento?: string;
  fotosInternas?: string;   // texto do tópico 8
  conclusao?: string;       // tópico 9
  recomendacoes?: string;   // tópico 10
  // Bloco de assinaturas (fim do documento)
  elaboradoPor?: string;   // usuário de Operações
  revisadoPor?: string;    // usuário da Gerência
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
  return {
    alturaTanque: medicao.height ? `${num(medicao.height)} ${un}` : "",
    diametro: medicao.dimValue ? `${num(medicao.dimValue)} ${un}` : "",
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

/** Legenda de figura: Arial 10, centralizada, entrelinha simples. */
function legendaAbnt(texto: string, antes = false): string {
  return '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" ' +
    `w:before="${antes ? 120 : 0}" w:after="${antes ? 0 : 120}"/><w:jc w:val="center"/>` +
    '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>' +
    `<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
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

/** Acrescenta o valor logo após um rótulo de célula ("Cliente...: " → "…: ACME").
 *  Usa a troca que atravessa runs, pois os rótulos também vêm fragmentados. */
function preencherRotulo(xml: string, rotulo: string, valor?: string): string {
  if (!valor) return xml;
  return trocarTexto(xml, rotulo, rotulo + valor);
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
function fichaEquipamentoXml(f: { nome: string; especificacoes: { rotulo: string; valor: string }[] }): string {
  const cab =
    '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:before="120" w:after="60"/>' +
    '<w:ind w:left="709"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="22"/></w:rPr>' +
    `<w:t xml:space="preserve">${esc(f.nome)}</w:t></w:r></w:p>`;
  if (!f.especificacoes || f.especificacoes.length === 0) return cab;
  const cel = (txt: string, negrito: boolean, larg: number) =>
    `<w:tc><w:tcPr><w:tcW w:w="${larg}" w:type="dxa"/></w:tcPr>` +
    '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:after="0"/>' +
    `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${negrito ? "<w:b/>" : ""}<w:sz w:val="20"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${negrito ? "<w:b/>" : ""}<w:sz w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(txt)}</w:t></w:r></w:p></w:tc>`;
  const linhas = f.especificacoes
    .filter((e) => (e.rotulo || "").trim() || (e.valor || "").trim())
    .map((e) => `<w:tr>${cel(e.rotulo || "", true, 3260)}${cel(e.valor || "", false, 5670)}</w:tr>`) 
    .join("");
  return cab +
    '<w:tbl><w:tblPr><w:tblInd w:w="709" w:type="dxa"/>' +
    '<w:tblBorders><w:top w:val="none" w:sz="0"/><w:left w:val="none" w:sz="0"/>' +
    '<w:bottom w:val="none" w:sz="0"/><w:right w:val="none" w:sz="0"/>' +
    '<w:insideH w:val="none" w:sz="0"/><w:insideV w:val="none" w:sz="0"/></w:tblBorders>' +
    '<w:tblW w:w="8930" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3260"/><w:gridCol w:w="5670"/></w:tblGrid>' +
    linhas + "</w:tbl>" +
    '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>';
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

/** Detecta o número do tópico de nível 1 num bloco ("7. Batimetria:" → 7). */
function numeroTopico(texto: string): number | null {
  const m = texto.match(/^(\d{1,2})\.\s/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 10 ? n : null;
}

/** Gera o .docx preenchido. Devolve um Blob pronto para download. */
export async function gerarRelatorioDocx(dados: DadosRelatorio): Promise<Blob> {
  const JSZip = (await import("jszip")).default;

  const resp = await fetch("/templates/relatorio-asp-v3.docx");
  if (!resp.ok) throw new Error("Não foi possível carregar o modelo do relatório.");
  const zip = await JSZip.loadAsync(await resp.arrayBuffer());

  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Modelo inválido: falta word/document.xml.");
  let xml = await docFile.async("string");

  // 1) Margens ABNT
  xml = aplicarMargensAbnt(xml);

  // 2) Marcadores simples
  // O modelo já traz "Relatório de " antes do [TITULO]; se o usuário digitou
  // o título completo, removemos o prefixo para não sair "Relatório de Relatório de…".
  const titulo = (dados.titulo || "").replace(/^\s*relat[óo]rio\s+de\s+/i, "");
  xml = trocarMarcador(xml, "[TITULO]", titulo);
  xml = trocarMarcador(xml, "[CLIENTE]", dados.cliente);
  xml = trocarMarcador(xml, "[Endereço]", dados.endereco);
  xml = trocarMarcador(xml, "[Volume de sedimento]", dados.volumeSedimento || "—");
  xml = trocarMarcador(xml, "[data de realização do relatorio]", dados.dataRelatorio || "");

  // 3) Quadro de controle de revisão (capa), na ordem dos rótulos
  xml = preencherQuadroRevisao(xml, [
    dados.revisao, dados.statusRevisao, dados.dataRevisao,
    dados.preparadoPor, dados.checadoPor, dados.aprovadoPor,
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
  xml = preencherRotulo(xml, "Diâmetro: ", dados.diametro);
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
  const rels: { rId: string; nome: string }[] = [];
  if (dados.imagens && dados.imagens.length > 0) {
    const relsPath = "word/_rels/document.xml.rels";
    const relsFile = zip.file(relsPath);
    let relsXml = relsFile ? await relsFile.async("string") : "";
    let ctXml = (await zip.file("[Content_Types].xml")?.async("string")) || "";

    let proximo = 900;
    for (let i = 0; i < dados.imagens.length; i++) {
      const img = dados.imagens[i];
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

  const ocultos = new Set(dados.topicos.filter((t) => !t.visivel).map((t) => t.numero));
  // Texto de cada tópico: entra logo DEPOIS do título, não no fim da seção
  // (o template tem parágrafos vazios de respiro que jogariam o texto adiante).
  const textoDoTopico = new Map<number, string>();
  const addTexto = (n: number, s: string) =>
    textoDoTopico.set(n, (textoDoTopico.get(n) || "") + s);
  if (dados.metodos) addTexto(3, htmlParaParagrafos(dados.metodos));
  for (const f of dados.equipamentosFicha || []) addTexto(4, fichaEquipamentoXml(f));
  if (dados.equipamentos) addTexto(4, htmlParaParagrafos(dados.equipamentos));
  if (dados.fotosInternas) addTexto(8, htmlParaParagrafos(dados.fotosInternas));
  if (dados.conclusao) addTexto(9, htmlParaParagrafos(dados.conclusao));
  if (dados.recomendacoes) addTexto(10, htmlParaParagrafos(dados.recomendacoes));

  // Figuras: legenda ABNT acima ("Figura N – …") e fonte abaixo. As que têm
  // âncora ("6.1") entram logo abaixo daquele subtítulo; as demais, na seção.
  const figurasDoTopico = new Map<number, string>();
  const figurasDaAncora = new Map<string, string>();
  (dados.imagens || []).forEach((img, i) => {
    if (ocultos.has(img.topico)) return;
    const rId = rels[i]?.rId;
    if (!rId) return;
    const largura = img.larguraCm || 15;
    const altura = Math.round(largura * 0.72 * 100) / 100;
    const bloco =
      legendaAbnt(`Figura ${MARCA_FIG} – ${img.legenda}`, true) +
      figuraXml(rId, i + 1, largura, altura) +
      legendaAbnt(`Fonte: ${img.fonte || "ASP Serviços Industriais"}`);
    if (img.ancora) {
      figurasDaAncora.set(img.ancora, (figurasDaAncora.get(img.ancora) || "") + bloco);
    } else {
      figurasDoTopico.set(img.topico, (figurasDoTopico.get(img.topico) || "") + bloco);
    }
  });

  const MARCADOR_IMAGENS = "[Imagens grafica da batimetria]";

  // reconstrói o corpo bloco a bloco
  const ordem = Array.from(inicioDoTopico.entries()).sort((a, b) => a[1] - b[1]);
  const fimDoTopico = new Map<number, number>();
  ordem.forEach(([n, ini], k) => {
    const proximoIni = k + 1 < ordem.length ? ordem[k + 1][1] : blocos.length;
    fimDoTopico.set(n, proximoIni);
  });

  // novo número de cada tópico visível (renumeração sequencial)
  const novoNumero = new Map<number, number>();
  let seq = 0;
  TOPICOS_PADRAO.forEach((t) => {
    if (!ocultos.has(t.numero)) novoNumero.set(t.numero, ++seq);
  });

  let saida = "";
  // Capa (tópico 0): se desmarcada, começamos direto no título "1.".
  const capaOculta = dados.topicos.some((t) => t.numero === 0 && !t.visivel);
  let idx = capaOculta ? (inicioDoTopico.get(1) ?? 0) : 0;
  while (idx < blocos.length) {
    const nTop = numeroTopico(blocos[idx].texto);
    if (nTop !== null && inicioDoTopico.get(nTop) === idx) {
      const fim = fimDoTopico.get(nTop) ?? blocos.length;
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
      idx = fim;
      continue;
    }
    saida += blocos[idx].xml;
    idx++;
  }

  // O <w:sectPr> final (margens + referência a cabeçalho/rodapé) fica no fim do
  // body e NÃO é um bloco w:p/w:tbl — precisa ser recolocado, senão o documento
  // perde o timbre e volta às margens padrão.
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
