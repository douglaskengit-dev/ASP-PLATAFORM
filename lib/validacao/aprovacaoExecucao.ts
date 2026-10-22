/** Fase 9 — APROVAÇÃO do relatório de EXECUÇÃO: o que é próprio dela, além
 * das regras gerais da aprovação (aprovacao.ts — mesma pessoa, arquivo não
 * baixado, OS mudou depois do envio…). Tudo ⚠️, nunca bloqueia: aparece no
 * card de ações (perto de "Aprovar") e no confirm da aprovação. Puro: a
 * página da OS chama com o que já carregou (snapshot da versão avaliada,
 * procedimento, RDOs, coleta de fotos e período da execução).
 *
 *   ⚠️ procedimento com laudo e a versão sem o PDF do laudo (relatório
 *      enviado antes da Fase 8)
 *   ⚠️ parâmetro do laudo (antes/depois) fora do limite não citado na
 *      Conclusão
 *   ⚠️ resultado não conforme após a limpeza: cloro livre DEPOIS abaixo de
 *      0,2 (CVS 6) ou parâmetro do laudo DEPOIS fora do limite
 *   ⚠️ dias do período da execução sem RDO desta OS
 *   ⚠️ RDO da OS com o .docx desatualizado ou nunca gerado
 *   ⚠️ coleta de fotos da execução incompleta
 *
 * A categoria de reprovação "Laudo/Laboratório" (só no relatório de
 * execução) fica em aprovacao.ts, com as demais. */
import { addAviso, novoResultado, type ResultadoValidacao } from "./resultado";
import { diasSemRdo, textoDiasSemRdo } from "./execucao";
import type { Periodo } from "./periodo";
import {
  foraDoLimite, foraNaoCitados, lerValorMedido, textoNumeroBr, type ForaDoLimite, type LaudoPdf,
} from "./relatorioExecucao";
import { arquivoEmDia, CLORO_MINIMO, dataBr, numeroRdo } from "../asp/rdo";
import { pendenciasColeta, type RegistroFotosExecucao, type UnidadeCloro } from "../asp/fotos-execucao";

/** Snapshot (gp_relatorios.dados) da versão avaliada — só o que importa aqui. */
export interface SnapshotAprovacaoExecucao {
  d?: Record<string, any> | null;
  laudoPdf?: LaudoPdf | null;
}

/** RDO como a página o tem (só o que importa aqui). */
export interface RdoArquivo {
  numero: number;
  data: string;
  arquivo_path: string | null;
  arquivo_em: string | null;
  atualizado_em: string;
}

export interface ContextoAprovacaoExecucao {
  /** gp_relatorios.dados da versão em avaliação (null = enviado de fora, sem snapshot). */
  dados: SnapshotAprovacaoExecucao | null | undefined;
  /** Procedimento com o bloco do laudo (procedimentoUsaLaudo). */
  usaLaudo: boolean;
  unidadeCloro: UnidadeCloro;
  hoje: string;
  periodo: Periodo | null;
  /** RDOs que cobrem a OS; null/undefined = não carregados (sem avisos de RDO). */
  rdos?: RdoArquivo[] | null;
  /** Coleta de fotos; null/undefined = não carregada (sem aviso). */
  coleta?: RegistroFotosExecucao | null;
}

export const ROTULO_NAO_CONFORME = "Resultado não conforme após a limpeza";

/** Texto curto de um parâmetro fora do limite ("Turbidez 7 NTU — limite 5 NTU"). */
function textoFora(f: ForaDoLimite): string {
  if (f.pa) return `${f.nome} Presente — padrão: ausência em 100 mL`;
  const u = f.unidade ? ` ${f.unidade}` : "";
  return `${f.nome} ${f.valor}${u} — limite ${f.limite}${u}`;
}

/** O que torna o resultado após a limpeza não conforme (vazio = conforme ou
 *  sem dado): cloro livre DEPOIS < 0,2 (CVS 6) e parâmetros do laudo DEPOIS
 *  fora do limite. */
export function naoConformidadesDepois(d: Record<string, any> | null | undefined, unidade: UnidadeCloro): string[] {
  if (!d) return [];
  const out: string[] = [];
  const cloro = lerValorMedido(typeof d.cloroDepois === "string" ? d.cloroDepois : d.cloroDepois != null ? String(d.cloroDepois) : "");
  if (cloro !== null && cloro >= 0 && cloro < CLORO_MINIMO) {
    out.push(`cloro livre ${textoNumeroBr(cloro)} ${unidade} — abaixo do mínimo de 0,2 ${unidade} (comunicado CVS 6)`);
  }
  for (const f of foraDoLimite("laudoDepois", d.laudoDepois)) out.push(textoFora(f));
  return out;
}

/** RDOs com o .docx desatualizado (editado depois de gerado) ou nunca gerado. */
export function rdosSemArquivoEmDia(rdos: RdoArquivo[]): { desatualizados: RdoArquivo[]; semArquivo: RdoArquivo[] } {
  const ord = [...rdos].sort((a, b) => (a.data || "").localeCompare(b.data || "") || a.numero - b.numero);
  return {
    semArquivo: ord.filter((r) => !r.arquivo_path),
    desatualizados: ord.filter((r) => !!r.arquivo_path && !arquivoEmDia(r)),
  };
}

const rotuloRdo = (r: RdoArquivo) => `nº ${numeroRdo(r.numero)} (${dataBr(r.data)})`;

/** ⚠️ da aprovação do relatório de execução (fase 9). Chaves: laudoPdf,
 *  conclusao, naoConforme, rdos, rdoArquivo, fotos. */
export function avisosAprovacaoExecucao(c: ContextoAprovacaoExecucao): ResultadoValidacao {
  const r = novoResultado();
  const d = c.dados?.d || null;

  // 1) PDF do laudo (relatório enviado antes da Fase 8)
  if (c.usaLaudo && !c.dados?.laudoPdf?.caminho) {
    addAviso(r, "laudoPdf", "Esta versão não tem o PDF do laudo do laboratório (enviada antes de o laudo ser exigido) — confira o laudo antes de aprovar ou reprove com a categoria Laudo/Laboratório.");
  }

  // 2) Fora do limite e não citado na Conclusão
  if (d) {
    const fora = [...foraDoLimite("laudoAntes", d.laudoAntes), ...foraDoLimite("laudoDepois", d.laudoDepois)];
    const naoCitados = foraNaoCitados(fora, d.conclusao);
    if (naoCitados.length) {
      const nomes = naoCitados.map((f) => `${f.nome} (${f.chave === "laudoAntes" ? "antes" : "depois"})`);
      addAviso(r, "conclusao", `Parâmetro(s) do laudo fora do limite não citado(s) na Conclusão: ${Array.from(new Set(nomes)).join(", ")}.`);
    }
  }

  // 3) Resultado não conforme após a limpeza
  const nc = naoConformidadesDepois(d, c.unidadeCloro);
  if (nc.length) addAviso(r, "naoConforme", `${ROTULO_NAO_CONFORME}: ${nc.join("; ")}.`);

  if (c.rdos) {
    // 4) Dias do período sem RDO (só os que já passaram)
    const faltam = diasSemRdo(c.periodo, c.rdos.map((x) => x.data), c.hoje, c.hoje);
    if (faltam.length) addAviso(r, "rdos", `Dias do período da execução sem RDO desta OS: ${textoDiasSemRdo(faltam)}.`);
    // 5) .docx do RDO desatualizado / nunca gerado
    const { desatualizados, semArquivo } = rdosSemArquivoEmDia(c.rdos);
    if (desatualizados.length) {
      addAviso(r, "rdoArquivo", `RDO(s) editado(s) depois de gerar o .docx (arquivo desatualizado): ${desatualizados.map(rotuloRdo).join(", ")}.`);
    }
    if (semArquivo.length) {
      addAviso(r, "rdoArquivo", `RDO(s) sem o .docx gerado: ${semArquivo.map(rotuloRdo).join(", ")}.`);
    }
  }

  // 6) Coleta de fotos incompleta
  if (c.coleta) {
    const pend = pendenciasColeta(c.coleta);
    if (pend.length) addAviso(r, "fotos", `Coleta de fotos da execução incompleta (${pend.length} pendência(s)): ${pend.join("; ")}.`);
  }
  return r;
}
