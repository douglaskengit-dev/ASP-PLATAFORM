/**
 * Texto sugerido para a Conclusão e as Recomendações do relatório (HTML do
 * editor), montado com os dados do próprio formulário — o técnico revisa
 * antes de gerar. Mesma regra da Conclusão das Análises: só afirma o que os
 * dados sustentam (sem valor, sem frase) e não repete frase que já está no
 * texto.
 *
 *   Relatório de inspeção: data e procedimento, sedimento da batimetria
 *   (volume, camada, % da capacidade), pontos da inspeção visual interna →
 *   recomenda a limpeza (ou manter as inspeções) e tratar os pontos.
 *   Relatório de execução: o que foi feito e quanto sedimento saiu, laudo
 *   (fora do limite, ou dentro dos padrões só com o laudo de após completo),
 *   cloro e pH de após → recomenda corrigir o que ficou fora.
 */
import type { UnidadeCloro } from "../asp/fotos-execucao";
import { CLORO_MINIMO } from "../asp/rdo";
import {
  CLORO_MAXIMO, COL_VALOR, FONTE_PORTARIA_888, foraDoLimite, fraseForaDoLimite, gradeLaudo, lerCelulaLaudo, lerNumeroBr,
  lerValorMedido, PH_FAIXA, semConclusaoNoLimite, textoNumeroBr,
} from "./relatorioExecucao";
import { normalizarTexto } from "./texto";

export interface DadosSugestao {
  /** Relatório de execução (o serviço já feito); false = de inspeção. */
  execucao: boolean;
  /** Procedimento de limpeza robotizada (POP 001). */
  limpeza: boolean;
  tag?: string | null;
  procedimento?: string | null;
  /** AAAA-MM-DD. */
  dataExecucao?: string | null;
  volumeSedimento?: string | null;
  alturaSedimento?: string | null;
  capacidadeTanque?: string | null;
  phDepois?: string | null;
  cloroDepois?: string | null;
  laudoAntes?: string[][] | null;
  laudoDepois?: string[][] | null;
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
/** "do tanque TQ-01" — sem repetir quando a identificação já é "Tanque TQ-01". */
const doTanque = (tag?: string | null) => {
  const t = (tag || "").trim();
  if (!t) return "do tanque";
  return /^tanque\b/i.test(t) ? `do ${t.replace(/^tanque/i, "tanque")}` : `do tanque ${t}`;
};

/** O laudo de após está completo (todo parâmetro com resultado). */
function laudoCompleto(g: string[][] | null | undefined): boolean {
  return !!g && gradeLaudo(g).every((l) => lerCelulaLaudo(l[COL_VALOR]).tipo !== "vazio");
}

function sedimento(d: DadosSugestao): { vol: number | null; frase: string } {
  const vol = numeroComUnidade(d.volumeSedimento);
  const alt = d.alturaSedimento?.trim();
  if (vol === null) return { vol, frase: alt ? `A camada de sedimento medida foi de cerca de ${alt}.` : "" };
  if (vol === 0) return { vol, frase: "A batimetria não indicou acúmulo de sedimento no fundo do tanque." };
  const cap = numeroComUnidade(d.capacidadeTanque);
  const pct = cap && cap > 0 ? (vol / cap) * 100 : null;
  return {
    vol,
    frase: `Pela batimetria, foi estimado um volume de sedimento de ${textoNumeroBr(vol)} m³`
      + (alt ? `, com camada de cerca de ${alt}` : "")
      + (pct !== null && pct >= 0.1 ? `, o equivalente a ${textoNumeroBr(Math.round(pct * 10) / 10)}% da capacidade do tanque` : "")
      + ".",
  };
}

function frasesConclusao(d: DadosSugestao): string[] {
  const frases: string[] = [];
  const data = dataBr(d.dataExecucao);
  const proc = d.procedimento?.trim() ? `, conforme o procedimento ${d.procedimento.trim()}` : "";
  const sed = sedimento(d);

  if (!d.execucao) {
    frases.push(`A inspeção ${doTanque(d.tag)} foi realizada${data ? ` em ${data}` : ""}${proc}.`);
    if (sed.frase) frases.push(sed.frase);
    if (d.achados?.length) frases.push(`Na inspeção visual interna foram registrados os seguintes pontos: ${lista(d.achados)}.`);
    return frases;
  }

  if (d.limpeza) {
    frases.push(`A limpeza robotizada ${doTanque(d.tag)} foi realizada${data ? ` em ${data}` : ""}`
      + (sed.vol ? `, com a remoção de aproximadamente ${textoNumeroBr(sed.vol)} m³ de sedimento` : "") + ".");
  } else {
    frases.push(`O serviço ${doTanque(d.tag)} foi executado${data ? ` em ${data}` : ""}${proc}.`);
  }

  // laudo: o que ficou fora (antes e após); "dentro dos padrões" só com o de após completo e conforme
  const fora = [...foraDoLimite("laudoAntes", d.laudoAntes), ...foraDoLimite("laudoDepois", d.laudoDepois)];
  frases.push(...fora.map(fraseForaDoLimite));
  const foraApos = fora.some((f) => f.chave === "laudoDepois");
  if (!foraApos && laudoCompleto(d.laudoDepois) && !semConclusaoNoLimite(d.laudoDepois).length) {
    frases.push(`Os parâmetros analisados na amostra coletada após a limpeza atenderam aos limites da ${FONTE_PORTARIA_888}.`);
  }

  // cloro e pH de após fora da faixa
  const cl = lerValorMedido(d.cloroDepois);
  if (cl !== null && (cl < CLORO_MINIMO || cl > CLORO_MAXIMO)) {
    frases.push(`O cloro livre medido após a limpeza (${textoNumeroBr(cl)} ${d.unidadeCloro}) ficou ${cl < CLORO_MINIMO ? `abaixo do mínimo de 0,2 ${d.unidadeCloro}` : `acima do máximo de ${CLORO_MAXIMO} ${d.unidadeCloro}`}.`);
  }
  const ph = lerValorMedido(d.phDepois);
  if (ph !== null && (ph < PH_FAIXA.min || ph > PH_FAIXA.max)) {
    frases.push(`O pH medido após a limpeza (${textoNumeroBr(ph)}) ficou fora da faixa de 6,0 a 9,0 recomendada.`);
  }
  return frases;
}

function frasesRecomendacoes(d: DadosSugestao): string[] {
  const frases: string[] = [];
  const sed = sedimento(d);

  if (!d.execucao) {
    if (sed.vol && sed.vol > 0) {
      frases.push(`Recomenda-se a limpeza ${doTanque(d.tag)} para a remoção do sedimento acumulado (volume estimado de ${textoNumeroBr(sed.vol)} m³).`);
    } else if (sed.vol === 0) {
      frases.push("Como não foi identificado acúmulo de sedimento, recomenda-se manter o tanque no plano de inspeções periódicas.");
    }
    if (d.achados?.length) frases.push(`Recomenda-se avaliar e tratar os pontos registrados na inspeção visual interna (${lista(d.achados)}).`);
  } else {
    const foraApos = foraDoLimite("laudoDepois", d.laudoDepois);
    const quimicos = foraApos.filter((f) => !f.pa).map((f) => f.nome);
    const micro = foraApos.filter((f) => f.pa).map((f) => f.nome);
    if (micro.length) {
      frases.push(`Recomenda-se a desinfecção do reservatório e nova análise microbiológica, pela presença de ${lista(micro)} na amostra de após a limpeza.`);
    }
    if (quimicos.length) {
      frases.push(`Para ${lista(quimicos)}, que ${quimicos.length > 1 ? "ficaram" : "ficou"} acima do limite após a limpeza, recomenda-se identificar a causa, corrigir e realizar nova coleta e análise.`);
    }
    const cl = lerValorMedido(d.cloroDepois);
    if (cl !== null && cl < CLORO_MINIMO) {
      frases.push(`Recomenda-se ajustar a cloração para manter o cloro livre entre 0,2 e ${CLORO_MAXIMO} ${d.unidadeCloro} (${FONTE_PORTARIA_888}).`);
    } else if (cl !== null && cl > CLORO_MAXIMO) {
      frases.push(`Recomenda-se reduzir a dosagem de cloro, para manter o cloro livre abaixo de ${CLORO_MAXIMO} ${d.unidadeCloro} (${FONTE_PORTARIA_888}).`);
    }
    const ph = lerValorMedido(d.phDepois);
    if (ph !== null && (ph < PH_FAIXA.min || ph > PH_FAIXA.max)) {
      frases.push("Recomenda-se acompanhar e corrigir o pH da água, que ficou fora da faixa de 6,0 a 9,0.");
    }
  }
  frases.push("Recomenda-se manter a inspeção e a limpeza periódicas do reservatório, conforme o plano de manutenção.");
  return frases;
}

/** Parágrafos novos (HTML), sem repetir o que já está escrito. */
function paragrafosNovos(frases: string[], atual: string | null | undefined): string {
  const ja = normalizarTexto((atual || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " "));
  return frases
    .filter((f) => !ja.includes(normalizarTexto(f)))
    .map((f) => `<p>${f.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("");
}

export function sugestaoTextoConclusao(d: DadosSugestao, atual?: string | null): string {
  return paragrafosNovos(frasesConclusao(d), atual);
}

export function sugestaoTextoRecomendacoes(d: DadosSugestao, atual?: string | null): string {
  return paragrafosNovos(frasesRecomendacoes(d), atual);
}
