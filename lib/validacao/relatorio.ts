/** Regras da Fase 4 — o RELATÓRIO da OS (gp_relatorios): versões, envio,
 * identificação, datas, pessoas e fotos. Puras: a tela (GerarRelatorio e a
 * página da OS) chama com o que já tem; a API (lib/asp/relatorio-api.ts) com
 * o que leu do banco.
 *
 *   ⛔ versão única por OS/tipo (calculada no servidor) · um rascunho por
 *      OS/tipo · tipo segue a fase (inspeção até a 5, execução da 6 em
 *      diante) · arquivo PDF/DOCX de verdade, até 30 MB · o mesmo arquivo já
 *      enviado nesta OS · revisão/código só mudam à mão por Admin, Gerência
 *      ou função com "Editar revisão/código" · datas válidas; data do
 *      relatório nem futura nem antes
 *      da coleta · horários da limpeza em ordem · cliente/TAG/procedimento
 *      iguais ao cadastro · fotos: repetida, sem legenda, duas na mesma vaga,
 *      formato ≠ PNG/JPEG, mais de 10 MB
 *   ⚠️ status da revisão em branco · medida diferente da medição · a mesma
 *      pessoa preparou e checou/aprovou · legendas repetidas · fotos em
 *      tópico desmarcado (não saem) · data de execução no futuro */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { dataIsoValida } from "./formatos";
import { normalizarEspacos, normalizarTexto } from "./texto";
import type { DadosRelatorio } from "../asp/relatorio";
import type { LaudoPdf } from "./relatorioExecucao";

export type TipoRelatorio = "inspecao" | "execucao";

/** Relatório já gravado nesta OS (linha de gp_relatorios, não excluída). */
export interface RelatorioRef {
  id: string;
  tipo: string;
  versao: number;
  status: string;
  arquivoHash?: string | null;
  /** SHA-256 da versão assinada (Fase 5/9), se houver. */
  assinadoHash?: string | null;
}

const MB = 1024 * 1024;
/** Arquivo enviado de fora (PDF/DOCX). */
export const RELATORIO_MAX_BYTES = 30 * MB;
/** Relatório gerado pelo sistema (DOCX com as fotos embutidas). */
export const RELATORIO_GERADO_MAX_BYTES = 150 * MB;
/** Cada foto do relatório (o arquivo original). */
export const FOTO_MAX_BYTES = 10 * MB;

export const ROTULO_TIPO: Record<TipoRelatorio, string> = { inspecao: "inspeção", execucao: "execução" };
export const ROTULO_STATUS_RELATORIO: Record<string, string> = {
  rascunho: "Rascunho", em_aprovacao: "Em aprovação", aprovado: "Aprovado", ajustar: "Ajustar",
  assinado: "Assinado", substituido: "Substituído",
};

function br(iso?: string | null): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

/** "dd/mm/aaaa" → "aaaa-mm-dd". ISO passa direto; o resto vira "". */
export function brParaIso(s: string | null | undefined): string {
  const v = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return "";
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return dataIsoValida(iso) ? iso : "";
}

/** "aaaa-mm-dd" → "dd/mm/aaaa" (como sai no documento). Outro texto passa. */
export function isoParaBr(s: string | null | undefined): string {
  const v = (s || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? br(v) : v;
}

// ── Versões e envio ──────────────────────────────────────────────────────────

/** O tipo do relatório é o da fase da OS: inspeção até a 5, execução da 6
 *  em diante. */
export function tipoDaFase(fase: number): TipoRelatorio {
  return fase <= 5 ? "inspecao" : "execucao";
}

/** Erro quando o tipo não é o da fase atual, ou null. */
export function erroTipoNaFase(tipo: string, fase: number, comInspecao: boolean = true): string | null {
  if (tipo !== "inspecao" && tipo !== "execucao") return "Tipo de relatório inválido.";
  // OS sem inspeção nunca recebe relatório de inspeção (as fases 2–5 não existem para ela).
  if (tipo === "inspecao" && comInspecao === false) {
    return "Esta OS é sem inspeção — não aceita relatório de inspeção (só o de execução).";
  }
  const certo = tipoDaFase(fase);
  if (tipo === certo) return null;
  return tipo === "inspecao"
    ? `Relatório de inspeção só até a fase 5 — esta OS está na fase ${fase} (relatório de execução).`
    : `Relatório de execução só a partir da fase 6 — esta OS está na fase ${fase} (relatório de inspeção).`;
}

const doTipo = (rels: RelatorioRef[], tipo: string) => rels.filter((r) => r.tipo === tipo);

/** Próxima versão do tipo: maior versão (fora `excluirId`) + 1. */
export function proximaVersao(rels: RelatorioRef[], tipo: string, excluirId?: string | null): number {
  return doTipo(rels, tipo).filter((r) => r.id !== excluirId).reduce((m, r) => Math.max(m, r.versao || 0), 0) + 1;
}

export function rascunhoDoTipo(rels: RelatorioRef[], tipo: string): RelatorioRef | null {
  return doTipo(rels, tipo).filter((r) => r.status === "rascunho").sort((a, b) => b.versao - a.versao)[0] || null;
}

/** Os em aprovação do tipo, da versão mais alta para a mais baixa (o normal
 *  é um só; mais de um só em dados antigos). */
export function emAprovacaoDoTipo(rels: RelatorioRef[], tipo: string): RelatorioRef[] {
  return doTipo(rels, tipo).filter((r) => r.status === "em_aprovacao").sort((a, b) => b.versao - a.versao);
}

/** O que acontece ao mandar um relatório para aprovação: a versão que ele
 *  terá e quem ele substitui. `rascunhoId` = enviando um rascunho existente
 *  (fica com a versão dele se ela já for a maior; senão, vai para o fim). */
export function planejarEnvio(rels: RelatorioRef[], tipo: string, rascunhoId?: string | null): {
  versao: number; substitui: RelatorioRef[];
} {
  const proprio = rascunhoId ? rels.find((r) => r.id === rascunhoId) : null;
  const maiorOutros = proximaVersao(rels, tipo, rascunhoId) - 1;
  const versao = proprio && proprio.versao > maiorOutros ? proprio.versao : maiorOutros + 1;
  return { versao, substitui: emAprovacaoDoTipo(rels, tipo).filter((r) => r.id !== rascunhoId) };
}

/** Revisão do relatório = reprovações ("Ajustar") do MESMO tipo nesta OS. */
export function revisaoDoTipo(rels: RelatorioRef[], tipo: string): number {
  return doTipo(rels, tipo).filter((r) => r.status === "ajustar").length;
}

/** Campo "Relatório" da capa: "37/MG/26 Rev1". Sem código do projeto, "". */
export function codigoRelatorio(codigoProjeto: string | null | undefined, revisao: number | string): string {
  const base = normalizarEspacos(codigoProjeto);
  return base ? `${base} Rev${revisao}` : "";
}

/** "o relatório de inspeção v2 (Em aprovação)". */
export function descreverRelatorio(r: RelatorioRef): string {
  const tipo = ROTULO_TIPO[r.tipo as TipoRelatorio] || r.tipo;
  return `o relatório de ${tipo} v${r.versao} (${ROTULO_STATUS_RELATORIO[r.status] || r.status})`;
}

/** Relatório desta OS (qualquer tipo, não excluído) com o mesmo arquivo —
 *  o enviado ou a versão assinada. */
export function arquivoRelatorioRepetido(hash: string | null | undefined, rels: RelatorioRef[], excluirId?: string | null): RelatorioRef | null {
  if (!hash) return null;
  return rels.find((r) => r.id !== excluirId && (r.arquivoHash === hash || r.assinadoHash === hash)) || null;
}

// ── Arquivo (PDF / DOCX) ─────────────────────────────────────────────────────

export type FormatoRelatorio = "pdf" | "docx";

/** Pelo conteúdo: "%PDF-" (até 1 KB de lixo antes, como o leitor aceita) ou
 *  ZIP ("PK\3\4", o contêiner do DOCX). A extensão não conta. */
export function assinaturaArquivo(bytes: Uint8Array): "pdf" | "zip" | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  const alvo = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const fim = Math.min(bytes.length - alvo.length, 1024);
  for (let i = 0; i <= fim; i++) if (alvo.every((b, k) => bytes[i + k] === b)) return "pdf";
  return null;
}

function mbBr(n: number): string {
  return (n / MB).toFixed(1).replace(".", ",");
}

/** Confere o arquivo do relatório pelos BYTES: PDF de verdade ou DOCX (ZIP
 *  cujo [Content_Types].xml declara um documento do Word), dentro do limite.
 *  Assíncrona porque abre o ZIP. */
export async function examinarArquivoRelatorio(
  bytes: Uint8Array | null | undefined, opcoes: { tamanho?: number; max?: number } = {}
): Promise<{ erro: string | null; formato: FormatoRelatorio | null }> {
  const n = opcoes.tamanho ?? bytes?.length ?? 0;
  const max = opcoes.max ?? RELATORIO_MAX_BYTES;
  if (!bytes || n === 0) return { erro: "O arquivo está vazio.", formato: null };
  if (n > max) return { erro: `O arquivo tem ${mbBr(n)} MB — o limite é ${Math.round(max / MB)} MB.`, formato: null };
  const sig = assinaturaArquivo(bytes);
  if (sig === "pdf") return { erro: null, formato: "pdf" };
  const naoE = "O arquivo não é um PDF nem um DOCX válido (o conteúdo não confere com a extensão). Exporte ou salve de novo em PDF ou Word (.docx).";
  if (sig !== "zip") return { erro: naoE, formato: null };
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const tipos = await zip.file("[Content_Types].xml")?.async("string");
    if (!tipos || !/wordprocessingml/i.test(tipos)) {
      return { erro: "O arquivo é um ZIP, mas não um documento do Word (.docx). Envie PDF ou DOCX.", formato: null };
    }
    return { erro: null, formato: "docx" };
  } catch {
    return { erro: "O DOCX está corrompido (não foi possível abrir). Salve de novo no Word.", formato: null };
  }
}

// ── Fotos ────────────────────────────────────────────────────────────────────

export type FormatoImagem = "png" | "jpeg" | "gif" | "webp" | "heic" | "bmp";

/** Formato da imagem pelos bytes (não pela extensão). */
export function formatoImagem(b: Uint8Array): FormatoImagem | null {
  const s = (i: number, n: number) => String.fromCharCode(...Array.from(b.slice(i, i + n)));
  if (b.length < 12) return null;
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (s(0, 4) === "GIF8") return "gif";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "webp";
  if (s(0, 2) === "BM") return "bmp";
  if (s(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(s(8, 4))) return "heic";
  return null;
}

/** Foto do relatório como fica no snapshot do rascunho. `caminho` = arquivo
 *  no storage (rascunho-fotos/… ou a foto original da coleta da execução). */
export interface FotoSalva {
  caminho?: string;
  hash: string;
  extensao: "png" | "jpeg";
  nome: string;
  legenda: string;
  topico: number;
  ancora?: string;
  vaga?: boolean;
  vagaIndice?: number;
  fonte?: string;
  /** Veio da coleta de fotos da execução (rótulo do item). */
  coleta?: string;
  /** SHA-256 do arquivo ESCOLHIDO (antes de converter WebP/HEIC…) — upload
   *  manual. Igual a `hash` quando já era PNG/JPEG. */
  hashOriginal?: string;
  /** SHA-256 guardado na coleta de fotos da execução (do original, antes da
   *  compressão) — fotos pré-carregadas. A API o relê do banco. */
  hashColeta?: string;
}

/** Tópico das fotos das seções extras do procedimento (âncora extra-<i>):
 *  não pertencem a nenhum tópico numerado, então nenhum checkbox as esconde
 *  — antes iam no 9 e sumiam ao desmarcar a Conclusão. */
export const TOPICO_EXTRAS = -1;

/** Pasta das fotos de rascunho desta OS. */
export function pastaFotosRascunho(inspecaoId: string): string {
  return `relatorios/${inspecaoId}/rascunho-fotos/`;
}

/** Caminho aceito para uma foto do snapshot: rascunho-fotos/<sha256>.<ext>
 *  ou foto da coleta da execução desta OS. */
export function caminhoFotoValido(caminho: string | null | undefined, inspecaoId: string): boolean {
  if (!caminho || caminho.includes("..")) return false;
  const p = pastaFotosRascunho(inspecaoId);
  if (caminho.startsWith(p)) return /^[0-9a-f]{64}\.(png|jpg)$/.test(caminho.slice(p.length));
  return caminho.startsWith(`fotos-execucao/${inspecaoId}/`);
}

// ── Snapshot do formulário ───────────────────────────────────────────────────

export type PapelPessoa = "preparadoPor" | "checadoPor" | "revisadoPorCapa" | "aprovadoPor" | "elaboradoPor" | "revisadoPor";
export const PAPEIS_PESSOA: PapelPessoa[] = ["preparadoPor", "checadoPor", "revisadoPorCapa", "aprovadoPor", "elaboradoPor", "revisadoPor"];

/** Tudo que o formulário "Gerar relatório" precisa para ser reconstruído. */
export interface SnapshotRelatorio {
  /** 2 = datas ISO, pessoas por id, fotos salvas, capacidade única. */
  versaoSnapshot?: number;
  d: Partial<DadosRelatorio>;
  subs8?: { titulo: string }[];
  textosExtras?: Record<number, string>;
  textosTopico?: Record<number, string>;
  visiveis: Record<number, boolean>;
  equipeIds: string[];
  equipIds: string[];
  coletaId: string;
  /** Ids dos usuários por papel (os nomes vão em `d`, para o documento). */
  pessoas?: Partial<Record<PapelPessoa, string>>;
  /** Revisão/código digitados à mão (por quem pode): não são recalculados. */
  revisaoManual?: boolean;
  /** Valores automáticos da medição quando o rascunho foi salvo — reabrir
   *  só troca o que a MEDIÇÃO mudou desde então, não o que foi digitado. */
  medicaoBase?: Record<string, string>;
  fotos?: FotoSalva[];
  /** PDF do laudo do laboratório (relatório de execução, Fase 8). */
  laudoPdf?: LaudoPdf | null;
  laudoPdfDepois?: LaudoPdf | null;
}

/** Campos que vêm do cadastro (só leitura no formulário). */
export const CAMPOS_CADASTRO = ["cliente", "endereco", "tag", "procedimento", "codigoProjeto"] as const;
/** Campos que vêm da medição (editáveis, com aviso de divergência). */
export const CAMPOS_MEDICAO = ["alturaTanque", "diametro", "comprimento", "largura", "capacidadeTanque", "volumeSedimento"] as const;
export const CAMPOS_DATA = ["dataRelatorio", "dataRevisao", "dataExecucao", "dataOperacao"] as const;

export const ROTULOS_RELATORIO: Record<string, string> = {
  titulo: "Título", cliente: "Cliente", endereco: "Endereço", tag: "TAG", procedimento: "Procedimento",
  codigoProjeto: "Código do projeto",
  dataRelatorio: "Data do relatório", dataRevisao: "Data da revisão", dataExecucao: "Data de execução",
  dataOperacao: "Data da operação", horarios: "Horários da operação",
  revisao: "Revisão", relatorioCodigo: "Relatório (código)", statusRevisao: "Status da revisão",
  preparadoPor: "Preparado por", checadoPor: "Checado por", revisadoPorCapa: "Revisado por (capa)",
  aprovadoPor: "Aprovado por", elaboradoPor: "Elaborado por", revisadoPor: "Revisado por",
  alturaTanque: "Altura do tanque", diametro: "Diâmetro", comprimento: "Comprimento", largura: "Largura",
  capacidadeTanque: "Capacidade", volumeSedimento: "Volume de sedimento",
  fotos: "Fotos",
  coletaId: "Medição", arquivo: "Arquivo",
};

/** Número de uma medida ("12,48 m³", "1.234,5") → 12.48. */
export function numeroDeTexto(s: string | null | undefined): number | null {
  const m = /-?\d[\d.,]*/.exec((s || "").replace(/\s/g, ""));
  if (!m) return null;
  let t = m[0];
  t = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(t);
  return isNaN(n) ? null : n;
}

/** Faixa de ±5% do volume de sedimento (texto do tópico 7) — sempre
 *  derivada do volume, nunca digitada. */
export function faixaVolume(volume: string | null | undefined): { volumeMin: string; volumeMax: string } {
  const n = numeroDeTexto(volume);
  if (n === null) return { volumeMin: "", volumeMax: "" };
  const f = (v: number) => v.toFixed(2).replace(".", ",");
  return { volumeMin: f(n * 0.95), volumeMax: f(n * 1.05) };
}

const ORDEM_HORARIOS = ["Chegada ao site", "Início da limpeza", "Conclusão", "Saída do site"];

/** Horários da limpeza: os preenchidos têm de estar em ordem. */
export function erroHorarios(h: string[] | null | undefined): string | null {
  const lista = (h || []).map((x, i) => ({ x: (x || "").trim(), i })).filter((v) => v.x);
  for (const v of lista) if (!/^\d{2}:\d{2}$/.test(v.x)) return `${ORDEM_HORARIOS[v.i]}: horário inválido.`;
  for (let k = 1; k < lista.length; k++) {
    if (lista[k].x < lista[k - 1].x) {
      return `${ORDEM_HORARIOS[lista[k].i]} (${lista[k].x}) não pode ser antes de ${ORDEM_HORARIOS[lista[k - 1].i].toLowerCase()} (${lista[k - 1].x}).`;
    }
  }
  return null;
}

export interface ContextoRelatorio {
  /** AAAA-MM-DD no fuso de Brasília. */
  hoje: string;
  /** Data da coleta (medição) escolhida, se houver. */
  dataColeta?: string | null;
  /** Revisão calculada (reprovações do mesmo tipo) e o código da capa. */
  revisaoEsperada: number;
  codigoEsperado: string;
  podeEditarRevisao: boolean;
  /** Valores do cadastro — a API confere que o snapshot não os mudou. */
  cadastro?: Partial<Record<(typeof CAMPOS_CADASTRO)[number], string>>;
  /** Valores automáticos da medição escolhida — aviso de divergência. */
  medicaoAuto?: Record<string, string>;
  /** Quantas vagas de imagem o modelo tem em cada tópico (se lido). */
  vagasPorTopico?: Record<number, number>;
  /** Nome do tópico, para as mensagens de fotos. */
  nomeTopico?: (n: number) => string;
}

const igualTexto = (a: unknown, b: unknown) => normalizarTexto(String(a ?? "")) === normalizarTexto(String(b ?? ""));

export function validarRelatorio(s: SnapshotRelatorio, ctx: ContextoRelatorio): ResultadoValidacao {
  const r = novoResultado();
  const d = s.d || {};
  const vis = (n: number) => s.visiveis?.[n] !== false;
  const nomeTopico = ctx.nomeTopico || ((n: number) => (n === TOPICO_EXTRAS ? "seções do procedimento" : `tópico ${n}`));

  if (vis(0) && !normalizarEspacos(d.titulo)) addErro(r, "titulo", "Informe o título do relatório.");

  // Datas
  const dr = (d.dataRelatorio || "").trim();
  if (!dr) addErro(r, "dataRelatorio", "Informe a data do relatório.");
  else if (!dataIsoValida(dr)) addErro(r, "dataRelatorio", "Data inválida.");
  else if (dr > ctx.hoje) addErro(r, "dataRelatorio", "A data do relatório não pode estar no futuro.");
  else if (ctx.dataColeta && dataIsoValida(ctx.dataColeta) && dr < ctx.dataColeta) {
    addErro(r, "dataRelatorio", `A data do relatório não pode ser antes da coleta da medição usada (${br(ctx.dataColeta)}).`);
  }
  for (const k of ["dataRevisao", "dataExecucao", "dataOperacao"] as const) {
    const v = (d[k] || "").trim();
    if (!v) continue;
    if (!dataIsoValida(v)) addErro(r, k, "Data inválida.");
    else if (v > ctx.hoje) addAviso(r, k, "Está no futuro — confira.");
  }
  const eh = erroHorarios(d.horarios);
  if (eh) addErro(r, "horarios", eh);

  // Revisão e código
  const rev = String(d.revisao ?? "").trim();
  const cod = normalizarEspacos(d.relatorioCodigo);
  const revMudou = rev !== String(ctx.revisaoEsperada);
  const codMudou = cod !== normalizarEspacos(ctx.codigoEsperado);
  if (!ctx.podeEditarRevisao) {
    if (revMudou) addErro(r, "revisao", `A revisão é calculada pelo sistema (Rev${ctx.revisaoEsperada}) — só Admin, Gerência ou uma função com “Editar revisão/código” podem alterar.`);
    if (codMudou) addErro(r, "relatorioCodigo", `O código é calculado pelo sistema (“${ctx.codigoEsperado || "sem código do projeto"}”) — só Admin, Gerência ou uma função com “Editar revisão/código” podem alterar.`);
  } else {
    if (rev && !/^\d{1,3}$/.test(rev)) addErro(r, "revisao", "A revisão é um número inteiro (0, 1, 2…).");
    else if (revMudou) addAviso(r, "revisao", `Diferente da calculada pelo sistema (Rev${ctx.revisaoEsperada}).`);
    if (codMudou) addAviso(r, "relatorioCodigo", `Diferente do calculado (“${ctx.codigoEsperado || "sem código"}”).`);
  }
  if (vis(0) && !(d.statusRevisao || "").trim()) addAviso(r, "statusRevisao", "Status da revisão em branco.");

  // Cadastro (só a API passa): o formulário não deixa editar.
  if (ctx.cadastro) {
    for (const k of CAMPOS_CADASTRO) {
      if (!(k in ctx.cadastro)) continue;
      if (!igualTexto(d[k as keyof DadosRelatorio], ctx.cadastro[k])) {
        addErro(r, k, `Difere do cadastro (“${ctx.cadastro[k] || "vazio"}”). Para mudar, edite o cadastro e reabra o formulário.`);
      }
    }
  }

  // Medição
  if (ctx.medicaoAuto) {
    for (const k of CAMPOS_MEDICAO) {
      const auto = ctx.medicaoAuto[k];
      const atual = d[k as keyof DadosRelatorio] as string | undefined;
      if (!auto || !normalizarEspacos(atual)) continue;
      const na = numeroDeTexto(auto), nb = numeroDeTexto(atual);
      const iguais = na !== null && nb !== null ? Math.abs(na - nb) < 0.005 : igualTexto(auto, atual);
      if (!iguais) addAviso(r, k, `Diferente da medição (${auto}).`);
    }
  }

  // Pessoas
  const p = s.pessoas || {};
  if (p.preparadoPor) {
    for (const k of ["checadoPor", "revisadoPorCapa", "aprovadoPor"] as const) {
      if (p[k] && p[k] === p.preparadoPor) addAviso(r, k, "Mesma pessoa que preparou o relatório.");
    }
  }
  if (p.elaboradoPor && p.revisadoPor && p.elaboradoPor === p.revisadoPor) {
    addAviso(r, "revisadoPor", "Mesma pessoa que elaborou o relatório.");
  }

  // Subtópicos do 8
  if (vis(8)) {
    const vistos = new Map<string, number>();
    (s.subs8 || []).forEach((st, i) => {
      const t = normalizarTexto(st.titulo);
      if (!t) { addErro(r, `subs8.${i}`, `Subtópico 8.${i + 1} sem título — dê um título ou remova-o.`); return; }
      if (vistos.has(t)) addAviso(r, `subs8.${i}`, `Subtópico 8.${i + 1} com o mesmo título do 8.${(vistos.get(t) as number) + 1}.`);
      else vistos.set(t, i);
    });
  }

  // Fotos
  const fotos = s.fotos || [];
  const porHash = new Map<string, number>();
  const porLegenda = new Map<string, number>();
  const porVaga = new Map<string, number>();
  const porTopicoVaga = new Map<number, number>();
  const ocultas: string[] = [];
  fotos.forEach((f, i) => {
    const campo = `fotos.${i}`;
    const nome = f.coleta || f.nome || `foto ${i + 1}`;
    if (f.extensao !== "png" && f.extensao !== "jpeg") addErro(r, campo, `“${nome}”: só PNG ou JPEG entram no documento.`);
    // A mesma imagem: o arquivo do relatório, o original escolhido (antes da
    // conversão) ou o original da coleta de fotos da execução (antes da
    // compressão) — a foto pré-carregada e o mesmo original anexado à mão.
    const chaves = Array.from(new Set([f.hash, f.hashOriginal, f.hashColeta].filter((h): h is string => !!h)));
    const j = chaves.map((h) => porHash.get(h)).find((x) => x !== undefined);
    if (j !== undefined) {
      const outra = fotos[j];
      addErro(r, campo, `“${nome}” é a mesma imagem de “${outra.coleta || outra.nome}” (${nomeTopico(outra.topico)}). Remova uma delas.`);
    } else chaves.forEach((h) => porHash.set(h, i));
    if (!f.vaga) {
      const leg = normalizarTexto(f.legenda);
      if (!leg) addErro(r, campo, `Escreva a legenda de “${nome}”.`);
      else {
        const j = porLegenda.get(leg);
        if (j !== undefined) addAviso(r, campo, `Legenda igual à de “${fotos[j].coleta || fotos[j].nome}”.`);
        else porLegenda.set(leg, i);
      }
    } else {
      porTopicoVaga.set(f.topico, (porTopicoVaga.get(f.topico) || 0) + 1);
      if (f.vagaIndice !== undefined && f.vagaIndice !== null && f.vagaIndice >= 0) {
        const k = `${f.topico}:${f.vagaIndice}`;
        const j = porVaga.get(k);
        if (j !== undefined) {
          addErro(r, campo, `“${nome}” e “${fotos[j].coleta || fotos[j].nome}” estão na mesma vaga (${nomeTopico(f.topico)}, vaga ${f.vagaIndice + 1}). Mova uma delas.`);
        } else porVaga.set(k, i);
      }
    }
    if (!vis(f.topico)) ocultas.push(`${nome} (${nomeTopico(f.topico)})`);
  });
  if (ctx.vagasPorTopico) {
    porTopicoVaga.forEach((qtd, t) => {
      const cap = ctx.vagasPorTopico?.[t];
      if (cap !== undefined && qtd > cap) addErro(r, "fotos", `${nomeTopico(t)}: ${qtd} fotos para ${cap} vaga(s) do modelo — remova ${qtd - cap}.`);
    });
  }
  if (ocultas.length) {
    addAviso(r, "fotosOcultas", `${ocultas.length} foto(s) em tópico desmarcado não entram no relatório: ${ocultas.join("; ")}.`);
  }
  return r;
}

// ── Reabrir rascunho ─────────────────────────────────────────────────────────

/** Dados frescos (do banco) para reabrir um rascunho. */
export interface DadosFrescos {
  /** Pré-preenchimento atual (cadastro, revisão, código…). */
  d: Partial<DadosRelatorio>;
  /** Medições ativas da OS (ids) e a aprovada, se houver. */
  coletasIds: string[];
  coletaAprovadaId?: string | null;
  /** Medição padrão quando a do rascunho sumiu (aprovada ou mais recente). */
  coletaPadraoId?: string | null;
  /** Valores automáticos de uma medição (camposDaMedicao, já em metros). */
  medicaoDe: (coletaId: string) => Record<string, string>;
}

const vazio = (v: unknown) => (v == null || v === "" ? "vazio" : String(v));

/** Rascunho salvo → formulário de hoje: datas em ISO, capacidade única,
 *  e os dados que vêm do banco atualizados. Devolve o que mudou, em texto. */
export function atualizarRascunho(salvo: SnapshotRelatorio, fresco: DadosFrescos): {
  snapshot: SnapshotRelatorio; mudancas: string[];
} {
  const mudancas: string[] = [];
  const d: Partial<DadosRelatorio> = { ...(salvo.d || {}) };
  for (const k of CAMPOS_DATA) if (d[k]) d[k] = brParaIso(d[k]) || d[k];
  if (!d.capacidadeTanque && d.capacidadeNominal) d.capacidadeTanque = d.capacidadeNominal;
  delete d.capacidadeNominal;

  const trocar = (k: keyof DadosRelatorio, novo: unknown, rotulo?: string) => {
    const antes = d[k];
    if (String(antes ?? "") === String(novo ?? "")) return;
    mudancas.push(`${rotulo || ROTULOS_RELATORIO[k as string] || String(k)}: ${vazio(antes)} → ${vazio(novo)}`);
    (d as any)[k] = novo;
  };
  for (const k of CAMPOS_CADASTRO) if (k in fresco.d) trocar(k, fresco.d[k] ?? "");
  if (!salvo.revisaoManual) {
    trocar("revisao", fresco.d.revisao ?? "");
    trocar("relatorioCodigo", fresco.d.relatorioCodigo ?? "");
  }

  let coletaId = salvo.coletaId || "";
  let trocouColeta = false;
  if (coletaId && !fresco.coletasIds.includes(coletaId)) {
    coletaId = fresco.coletaPadraoId || "";
    trocouColeta = true;
    mudancas.push(coletaId ? "A medição usada no rascunho foi excluída — passou a usar a medição aprovada (ou a mais recente)." : "A medição usada no rascunho foi excluída.");
  } else if (fresco.coletaAprovadaId && fresco.coletaAprovadaId !== coletaId) {
    coletaId = fresco.coletaAprovadaId;
    trocouColeta = true;
    mudancas.push("Outra medição foi aprovada depois do rascunho — o relatório passou a usar a medição aprovada.");
  } else if (!coletaId && fresco.coletaPadraoId) {
    coletaId = fresco.coletaPadraoId;
    trocouColeta = true;
    mudancas.push("Uma medição foi registrada depois do rascunho — o relatório passou a usá-la.");
  }

  const auto = coletaId ? fresco.medicaoDe(coletaId) : {};
  const base = salvo.medicaoBase;
  for (const k of CAMPOS_MEDICAO) {
    const a = auto[k] ?? "";
    // Só o que a medição mudou: valor digitado à mão (com aviso) fica.
    const mudouNaMedicao = trocouColeta || (base ? (base[k] ?? "") !== a : false);
    if (mudouNaMedicao) trocar(k, a);
  }
  Object.assign(d, faixaVolume(d.volumeSedimento));

  return {
    snapshot: { ...salvo, versaoSnapshot: 2, d, coletaId, medicaoBase: auto },
    mudancas,
  };
}
