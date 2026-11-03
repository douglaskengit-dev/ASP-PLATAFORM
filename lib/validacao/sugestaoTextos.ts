/**
 * Texto sugerido para a Conclusão e as Recomendações do relatório (HTML do
 * editor), em linguagem técnica de relatório, montado com os dados do próprio
 * formulário — o técnico revisa antes de gerar. Mesma regra da Conclusão das
 * Análises: só afirma o que os dados sustentam (sem valor, sem frase) e não
 * repete parágrafo que já está no texto.
 *
 *   Relatório de inspeção: objeto e data, levantamento batimétrico (volume,
 *   faixa, camada, % da capacidade), ocorrências da inspeção visual interna e
 *   o parecer → programar a limpeza com desinfecção e análises, tratar as
 *   ocorrências, manter a periodicidade.
 *   Relatório de execução: serviço e sedimento removido, amostras e laudos
 *   (fora do limite, melhora após a limpeza, conformidade só com o laudo de
 *   após completo), cloro e pH de campo e o parecer → desinfecção e nova
 *   análise, investigar parâmetros, ajustar cloração/pH, manter a
 *   periodicidade e o controle da qualidade da água.
 */
import type { UnidadeCloro } from "../asp/fotos-execucao";
import { CLORO_MINIMO } from "../asp/rdo";
import {
  CLORO_MAXIMO, COL_VALOR, FONTE_PORTARIA_888, foraDoLimite, fraseForaDoLimite, gradeLaudo, lerCelulaLaudo,
  lerNumeroBr, lerValorMedido, PH_FAIXA, semConclusaoNoLimite, textoNumeroBr,
} from "./relatorioExecucao";
import { normalizarTexto } from "./texto";

export interface DadosSugestao {
  /** Relatório de execução (o serviço já feito); false = de inspeção. */
  execucao: boolean;
  /** Procedimento de limpeza robotizada (POP 001). */
  limpeza: boolean;
  tag?: string | null;
  cliente?: string | null;
  procedimento?: string | null;
  /** AAAA-MM-DD. */
  dataExecucao?: string | null;
  volumeSedimento?: string | null;
  /** Faixa do volume (±5% da batimetria), em m³. */
  volumeMin?: string | null;
  volumeMax?: string | null;
  alturaSedimento?: string | null;
  capacidadeTanque?: string | null;
  phDepois?: string | null;
  cloroDepois?: string | null;
  laudoAntes?: string[][] | null;
  laudoDepois?: string[][] | null;
  /** Nº das amostras / relatórios de ensaio do laboratório. */
  amostraAntes?: string | null;
  amostraDepois?: string | null;
  unidadeCloro: UnidadeCloro;
  /** Títulos dos subtópicos da inspeção visual interna (o que foi achado). */
  achados?: string[];
}

/** "12,480 m³" / "1.500,00 m³" / "0,35 m" → número. */
function numeroComUnidade(s: string | null | undefined): number | null {
  return lerNumeroBr((s || "").trim().replace(/\s*(m³|m3|m|cm)\.?$/i, ""));
}

const dataBr = (iso?: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : xs[0]);
const m3 = (n: number) => `${textoNumeroBr(n)} m³`;
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Corrosão no costado" → "corrosão no costado" no meio da frase (sigla como "TQ-01" fica). */
const minuscula = (s: string) => (/^[A-ZÀ-Ú][a-zà-ú]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "reservatório TQ-01" — ou "tanque TQ-01" quando a identificação já é "Tanque TQ-01". */
function objeto(d: DadosSugestao): string {
  const t = (d.tag || "").trim();
  if (!t) return "reservatório";
  return /^(tanque|reservat[oó]rio|cisterna)\b/i.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : `reservatório ${t}`;
}
const doCliente = (d: DadosSugestao) => (d.cliente?.trim() ? `, do cliente ${d.cliente.trim()}` : "");
const peloProcedimento = (d: DadosSugestao) => (d.procedimento?.trim() ? `, conforme o procedimento ${d.procedimento.trim()}` : "");
/** "Em 15/10/2026, foi realizada…" / "Foi realizada…" */
const abertura = (d: DadosSugestao, verbo: string) => (dataBr(d.dataExecucao) ? `Em ${dataBr(d.dataExecucao)}, ${verbo}` : maiuscula(verbo));

/** O laudo de após está completo (todo parâmetro com resultado). */
function laudoCompleto(g: string[][] | null | undefined): boolean {
  return !!g && gradeLaudo(g).every((l) => lerCelulaLaudo(l[COL_VALOR]).tipo !== "vazio");
}
const temLaudo = (g: string[][] | null | undefined) => !!g && gradeLaudo(g).some((l) => lerCelulaLaudo(l[COL_VALOR]).tipo !== "vazio");

interface Sedimento { vol: number | null; pct: number | null; texto: string }

/** Parágrafo do levantamento batimétrico (vazio sem dado). */
function sedimento(d: DadosSugestao): Sedimento {
  const vol = numeroComUnidade(d.volumeSedimento);
  const alt = d.alturaSedimento?.trim();
  const cap = numeroComUnidade(d.capacidadeTanque);
  const pct = vol !== null && cap && cap > 0 ? Math.round((vol / cap) * 1000) / 10 : null;
  if (vol === null) {
    return { vol, pct, texto: alt ? `A camada de sedimento medida no fundo do ${objeto(d)} apresentou altura aproximada de ${alt}.` : "" };
  }
  if (vol === 0) {
    return { vol, pct, texto: "O levantamento batimétrico não indicou acúmulo de sedimento detectável no fundo do reservatório no momento da inspeção." };
  }
  const min = lerNumeroBr(d.volumeMin), max = lerNumeroBr(d.volumeMax);
  return {
    vol, pct,
    texto: `O levantamento batimétrico indicou volume estimado de sedimento de ${m3(vol)}`
      + (min !== null && max !== null ? ` (faixa de ${d.volumeMin!.trim()} m³ a ${d.volumeMax!.trim()} m³, considerada a incerteza do método)` : "")
      + (alt ? `, com camada de altura aproximada de ${alt}` : "")
      + (pct !== null && pct >= 0.1
        ? `, o que corresponde a cerca de ${textoNumeroBr(pct)}% da capacidade do reservatório${d.capacidadeTanque?.trim() ? ` (${d.capacidadeTanque.trim()})` : ""}`
        : "")
      + ".",
  };
}

interface Qualidade {
  foraApos: ReturnType<typeof foraDoLimite>;
  /** Fora do limite antes e dentro na amostra de após. */
  melhoraram: string[];
  /** Laudo de após completo, sem nada fora e sem resultado inconclusivo. */
  conformeApos: boolean;
  cloroOk: boolean | null;
  phOk: boolean | null;
}

function qualidade(d: DadosSugestao): Qualidade {
  const foraAntes = foraDoLimite("laudoAntes", d.laudoAntes);
  const foraApos = foraDoLimite("laudoDepois", d.laudoDepois);
  const inconclusivosApos = semConclusaoNoLimite(d.laudoDepois);
  const conformeApos = !foraApos.length && laudoCompleto(d.laudoDepois) && !inconclusivosApos.length;
  const gDep = d.laudoDepois ? gradeLaudo(d.laudoDepois) : null;
  const melhoraram = foraAntes
    .filter((f) => gDep && lerCelulaLaudo(gDep[f.linha][COL_VALOR]).tipo !== "vazio"
      && !foraApos.some((x) => x.linha === f.linha) && !inconclusivosApos.some((x) => x.linha === f.linha))
    .map((f) => f.nome);
  const cl = lerValorMedido(d.cloroDepois), ph = lerValorMedido(d.phDepois);
  return {
    foraApos, melhoraram, conformeApos,
    cloroOk: cl === null ? null : cl >= CLORO_MINIMO && cl <= CLORO_MAXIMO,
    phOk: ph === null ? null : ph >= PH_FAIXA.min && ph <= PH_FAIXA.max,
  };
}

function paragrafosConclusao(d: DadosSugestao): string[] {
  const ps: string[] = [];
  const sed = sedimento(d);

  if (!d.execucao) {
    ps.push(`${abertura(d, "foi realizada")} a inspeção técnica do ${objeto(d)}${doCliente(d)}${peloProcedimento(d)}, com o objetivo de avaliar as condições internas do reservatório e quantificar o acúmulo de sedimento no fundo.`);
    if (sed.texto) ps.push(sed.texto);
    if (d.achados?.length) {
      ps.push(`Na inspeção visual interna, foram registradas as seguintes ocorrências: ${lista(d.achados.map(minuscula))}, conforme o registro fotográfico apresentado neste relatório.`);
    }
    if (sed.vol !== null && sed.vol > 0) {
      ps.push(`Com base nos dados levantados, o ${objeto(d)} apresenta acúmulo de sedimento que justifica a programação de limpeza${d.achados?.length ? ", além de ocorrências que requerem avaliação técnica" : ""}.`);
    } else if (sed.vol === 0) {
      ps.push(`Com base nos dados levantados, o ${objeto(d)} não apresentou acúmulo de sedimento que demande limpeza no momento da inspeção${d.achados?.length ? "; as ocorrências registradas, contudo, requerem avaliação técnica" : ""}.`);
    }
    return ps;
  }

  // execução
  ps.push(`${abertura(d, "foi executada")} ${d.limpeza ? "a limpeza robotizada" : "o serviço"} do ${objeto(d)}${doCliente(d)}${peloProcedimento(d)}`
    + (sed.vol
      ? `, com remoção estimada de ${m3(sed.vol)} de sedimento acumulado no fundo do reservatório${sed.pct !== null && sed.pct >= 0.1 ? ` (cerca de ${textoNumeroBr(sed.pct)}% da sua capacidade)` : ""}`
      : "")
    + ".");

  const q = qualidade(d);
  if (temLaudo(d.laudoAntes) || temLaudo(d.laudoDepois)) {
    const amostras = [d.amostraAntes?.trim() && `${d.amostraAntes.trim()}, antes da limpeza`, d.amostraDepois?.trim() && `${d.amostraDepois.trim()}, após a limpeza`]
      .filter(Boolean) as string[];
    ps.push(`Para a avaliação da qualidade da água, foram coletadas amostras antes e após a limpeza e encaminhadas para análise físico-química e microbiológica em laboratório${amostras.length ? ` — ${amostras.length > 1 ? "amostras" : "amostra"} nº ${amostras.join("; ")} —` : ""}, com os resultados comparados aos padrões de potabilidade da ${FONTE_PORTARIA_888}.`);
  }
  const fora = [...foraDoLimite("laudoAntes", d.laudoAntes), ...q.foraApos];
  if (fora.length) ps.push(fora.map(fraseForaDoLimite).join(" "));
  if (q.melhoraram.length && q.conformeApos) {
    ps.push(`Observa-se melhora da qualidade da água após a intervenção: ${lista(q.melhoraram)}, em desacordo antes da limpeza, ${q.melhoraram.length > 1 ? "passaram" : "passou"} a atender ao padrão na amostra coletada após o serviço.`);
  }
  if (q.conformeApos) {
    ps.push(`Na amostra coletada após a limpeza, todos os parâmetros analisados atenderam aos padrões de potabilidade da ${FONTE_PORTARIA_888}.`);
  }

  const cl = lerValorMedido(d.cloroDepois), ph = lerValorMedido(d.phDepois);
  const medidas: string[] = [];
  if (cl !== null) medidas.push(`cloro residual livre de ${textoNumeroBr(cl)} ${d.unidadeCloro}`);
  if (ph !== null) medidas.push(`pH de ${textoNumeroBr(ph)}`);
  if (medidas.length) {
    const problemas: string[] = [];
    if (q.cloroOk === false) {
      problemas.push(cl! < CLORO_MINIMO ? `o cloro residual livre ficou abaixo do mínimo de 0,2 ${d.unidadeCloro}` : `o cloro residual livre ficou acima do máximo de ${CLORO_MAXIMO} ${d.unidadeCloro}`);
    }
    if (q.phOk === false) problemas.push("o pH ficou fora da faixa de 6,0 a 9,0");
    ps.push(`As medições de campo realizadas após a limpeza indicaram ${lista(medidas)}`
      + (problemas.length ? `; ${lista(problemas)} (referência: ${FONTE_PORTARIA_888}).` : `, dentro das faixas de referência da ${FONTE_PORTARIA_888}.`));
  }

  const pendente = q.foraApos.length > 0 || q.cloroOk === false || q.phOk === false;
  if (pendente) {
    ps.push("Em razão dos resultados em desacordo após a limpeza, recomenda-se a adoção das medidas indicadas no tópico de Recomendações e a confirmação por nova análise antes da liberação do reservatório para uso.");
  } else if (q.conformeApos) {
    ps.push("Dessa forma, os resultados obtidos indicam que os objetivos da limpeza foram atingidos, com a água armazenada em conformidade com os padrões de potabilidade para os parâmetros avaliados.");
  }
  return ps;
}

function paragrafosRecomendacoes(d: DadosSugestao): string[] {
  const ps: string[] = [];
  const sed = sedimento(d);

  if (!d.execucao) {
    if (sed.vol && sed.vol > 0) {
      ps.push(`Recomenda-se a programação da limpeza do ${objeto(d)}, com remoção do sedimento acumulado (volume estimado de ${m3(sed.vol)}), de modo a restabelecer o volume útil de reservação e reduzir o risco de comprometimento da qualidade da água armazenada.`);
      ps.push(`Recomenda-se que a limpeza seja acompanhada de desinfecção e de coleta de amostras de água antes e após a intervenção, para análise físico-química e microbiológica conforme a ${FONTE_PORTARIA_888}.`);
    } else if (sed.vol === 0) {
      ps.push("Recomenda-se manter o reservatório no programa de inspeções periódicas, a fim de acompanhar a evolução do acúmulo de sedimento.");
    }
    if (d.achados?.length) {
      ps.push(`Recomenda-se a avaliação técnica das ocorrências registradas na inspeção visual interna (${lista(d.achados.map(minuscula))}) por profissional habilitado, com a definição das medidas corretivas e do prazo de execução.`);
    }
  } else {
    const q = qualidade(d);
    const micro = q.foraApos.filter((f) => f.pa).map((f) => f.nome);
    const quimicos = q.foraApos.filter((f) => !f.pa).map((f) => f.nome);
    if (micro.length) {
      ps.push(`Recomenda-se proceder à desinfecção do reservatório e das tubulações a jusante, seguida de nova coleta para análise microbiológica, até a obtenção de resultado ausente em 100 mL para ${lista(micro)}, conforme a ${FONTE_PORTARIA_888}.`);
    }
    if (quimicos.length) {
      ps.push(`Para ${lista(quimicos)}, ${quimicos.length > 1 ? "que permaneceram" : "que permaneceu"} acima do valor máximo permitido após a limpeza, recomenda-se investigar a origem — como a qualidade da água de abastecimento ou a ressuspensão de sedimento residual —, adotar as correções necessárias e repetir a coleta e a análise.`);
    }
    const cl = lerValorMedido(d.cloroDepois);
    if (q.cloroOk === false && cl !== null && cl < CLORO_MINIMO) {
      ps.push(`Recomenda-se o ajuste da dosagem de cloro, de modo a manter o teor de cloro residual livre entre 0,2 e ${CLORO_MAXIMO} ${d.unidadeCloro} em todo o sistema de distribuição, conforme a ${FONTE_PORTARIA_888}.`);
    } else if (q.cloroOk === false) {
      ps.push(`Recomenda-se a redução da dosagem de cloro, de modo a manter o teor de cloro residual livre abaixo de ${CLORO_MAXIMO} ${d.unidadeCloro}, conforme a ${FONTE_PORTARIA_888}.`);
    }
    if (q.phOk === false) {
      ps.push(`Recomenda-se o monitoramento e a correção do pH da água, mantendo-o na faixa de 6,0 a 9,0 de referência da ${FONTE_PORTARIA_888}.`);
    }
    ps.push("Recomenda-se manter o controle periódico da qualidade da água armazenada, com coleta e análise laboratorial na frequência prevista no plano de amostragem do sistema.");
  }
  ps.push("Recomenda-se manter a periodicidade de inspeção, limpeza e desinfecção do reservatório estabelecida no plano de manutenção, com inspeção prévia para avaliação do acúmulo de sedimento e das condições estruturais internas.");
  return ps;
}

/** Parágrafos novos (HTML), sem repetir o que já está escrito. */
function paragrafosNovos(ps: string[], atual: string | null | undefined): string {
  const ja = normalizarTexto((atual || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " "));
  return ps
    .filter((f) => f && !ja.includes(normalizarTexto(f)))
    .map((f) => `<p>${maiuscula(f).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
}

export function sugestaoTextoConclusao(d: DadosSugestao, atual?: string | null): string {
  return paragrafosNovos(paragrafosConclusao(d), atual);
}

export function sugestaoTextoRecomendacoes(d: DadosSugestao, atual?: string | null): string {
  return paragrafosNovos(paragrafosRecomendacoes(d), atual);
}
