/**
 * Leitura do laudo do laboratório quando o PDF é IMAGEM (escaneado ou
 * "Imprimir em PDF"): o PDF vai para a IA (mesma conexão da análise de TR —
 * `getAnthropicClient`, que respeita a ANTHROPIC_BASE_URL do gateway), que só
 * TRANSCREVE os valores numa ferramenta de saída estruturada. Nada é
 * inferido: célula ilegível volta vazia e a linha fica em branco para
 * digitar. O resultado passa pela mesma normalização do leitor de texto
 * (celulaLida) e a tela destaca tudo para revisão.
 */
import { getAnthropicClient, MODELO_ANALISE } from "@/lib/claudeAnalysis";
import { LAUDO_COLUNAS, LAUDO_PARAMETROS } from "./relatorio";
import { celulaLida, type LaudoLido } from "./laudo-leitura";

/** Nome do parâmetro como a IA deve devolver (ordem de LAUDO_PARAMETROS). */
const PARAMETROS_IA = ["Cor Aparente", "Turbidez", "Coliformes Totais", "Escherichia coli", "Bactérias Heterotróficas"] as const;

const FERRAMENTA = {
  name: "registrar_laudo",
  description: "Registra os valores transcritos de um Relatório de Ensaio de análise de água.",
  input_schema: {
    type: "object" as const,
    properties: {
      documentoValido: { type: "boolean", description: "true só se o documento for um Relatório de Ensaio de análise de água e os resultados estiverem legíveis." },
      relatorioEnsaio: { type: "string", description: 'Número do "Relatório de Ensaio" como escrito (ex.: "26846/2026.0.A"). "" se não houver.' },
      dataColeta: { type: "string", description: 'Data da coleta como escrita, dd/mm/aaaa. "" se não houver.' },
      cloroResidualLivre: { type: "string", description: 'Valor de "Cloro Residual Livre" como escrito. "" se não houver.' },
      ph: { type: "string", description: 'Valor de "pH" como escrito. "" se não houver.' },
      naoAtende: {
        type: "array", items: { type: "string" },
        description: 'Parâmetros que a interpretação do laudo diz que NÃO ATENDEM à legislação, como escritos. [] se a amostra atende ou não houver interpretação.',
      },
      parametros: {
        type: "array",
        description: "Uma entrada por parâmetro encontrado na tabela de Resultados Analíticos.",
        items: {
          type: "object",
          properties: {
            parametro: { type: "string", enum: [...PARAMETROS_IA] },
            resultado: { type: "string", description: 'Coluna Resultado, exatamente como escrita (ex.: "2,60 mg Pt-Co/L", "< 1 UFC/mL", "Presença P-A/100ml", "-").' },
            limitePortaria: { type: "string", description: 'Coluna Portaria GM/MS nº888 (limite), como escrita (ex.: "15 mg Pt-Co/L", "Ausência em 100 mL P-A/100ml", "-").' },
            incerteza: { type: "string", description: 'Coluna Incerteza, como escrita ("-" se o laudo traz "-").' },
            lq: { type: "string", description: "Coluna LQ, como escrita." },
            ld: { type: "string", description: "Coluna LD, como escrita." },
          },
          required: ["parametro", "resultado", "limitePortaria", "incerteza", "lq", "ld"],
        },
      },
    },
    required: ["documentoValido", "relatorioEnsaio", "dataColeta", "cloroResidualLivre", "ph", "naoAtende", "parametros"],
  },
};

const INSTRUCOES = `Você transcreve laudos de laboratório (Relatório de Ensaio de água) para um sistema.
Regras, sem exceção:
- Transcreva SOMENTE o que está escrito no documento, caractere por caractere, nas mesmas casas decimais (vírgula como o laudo usa). Nunca calcule, arredonde, complete ou deduza um valor.
- Se uma célula estiver ilegível, cortada ou ausente, devolva "" para ela. Prefira "" a arriscar.
- Mantenha "<", "-" e as palavras Presença/Ausência como estão.
- Cada coluna vai no campo dela; não desloque valores entre colunas.
- Se o documento não for um Relatório de Ensaio de água, ou se os resultados não estiverem legíveis, use documentoValido=false e deixe parametros vazio.
Responda apenas chamando a ferramenta registrar_laudo.`;

type EntradaIA = {
  documentoValido?: boolean; relatorioEnsaio?: string; dataColeta?: string; cloroResidualLivre?: string; ph?: string;
  naoAtende?: string[];
  parametros?: { parametro?: string; resultado?: string; limitePortaria?: string; incerteza?: string; lq?: string; ld?: string }[];
};

const numero = (s?: string) => {
  const n = Number((s || "").trim().replace(",", "."));
  return (s || "").trim() && isFinite(n) ? n : undefined;
};

/** Converte a transcrição da IA no mesmo formato do leitor de texto. */
export function laudoDaTranscricao(x: EntradaIA): LaudoLido {
  const grade = LAUDO_PARAMETROS.map(() => LAUDO_COLUNAS.map(() => ""));
  const incompletos: string[] = [];
  let lidos = 0;
  PARAMETROS_IA.forEach((nome, i) => {
    const p = (x.parametros || []).find((q) => (q.parametro || "").toLowerCase() === nome.toLowerCase());
    if (!p) return;
    // ordem do sistema: [valor, incerteza, LQ, LD, limite]
    const cel = [p.resultado, p.incerteza, p.lq, p.ld, p.limitePortaria].map(celulaLida);
    if (cel.some((c) => c === null) || !cel[0]) { incompletos.push(LAUDO_PARAMETROS[i]); return; }
    const [valor, inc, lq, ld, lim] = cel as string[];
    grade[i] = [valor, inc, lq, ld, lim === "-" ? "" : lim];
    lidos++;
  });
  const dc = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((x.dataColeta || "").trim());
  return {
    amostra: (x.relatorioEnsaio || "").trim() || undefined,
    dataColeta: dc ? `${dc[3]}-${dc[2]}-${dc[1]}` : undefined,
    cloro: numero(x.cloroResidualLivre), ph: numero(x.ph),
    grade, lidos, incompletos,
    naoAtende: (x.naoAtende || []).map((s) => s.replace(/\(P\/A\)/gi, "").trim()).filter(Boolean),
    ehRelatorioDeEnsaio: !!x.documentoValido,
  };
}

/** A IA está configurada no servidor? (mesma chave da análise de TR) */
export const iaDisponivel = () => !!process.env.ANTHROPIC_API_KEY;

export async function lerLaudoViaIA(pdf: Buffer): Promise<LaudoLido> {
  const resp = await getAnthropicClient().messages.create({
    model: process.env.LAUDO_IA_MODEL || MODELO_ANALISE,
    max_tokens: 2000,
    system: INSTRUCOES,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: FERRAMENTA.name },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
        { type: "text", text: "Transcreva os valores deste laudo." },
      ],
    }],
  });
  const uso = resp.content.find((b) => b.type === "tool_use");
  if (!uso || uso.type !== "tool_use") throw new Error("A IA não devolveu a leitura do laudo.");
  return laudoDaTranscricao(uso.input as EntradaIA);
}
