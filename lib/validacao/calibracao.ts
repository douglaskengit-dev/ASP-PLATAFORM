/** Calibração dos equipamentos — regras puras (navegador + API + rotina).
 *
 * Equipamento do Catálogo com `exige_calibracao` tem UNIDADES (nº de série/
 * patrimônio), cada uma com a calibração vigente: data, validade em meses (o
 * vencimento é calculado) ou vencimento informado, certificado, laboratório.
 *
 *   Situação de uma unidade (hoje, ou na data da visita):
 *     🟢 em_dia · 🟡 vence_breve (até 30 dias) · 🔴 vencida · ⚪ sem_calibracao
 *
 *   Ao registrar:
 *     ⛔ data da calibração vazia, inválida ou no futuro · validade fora de
 *        1–120 meses · vencimento antes da calibração · unidade repetida
 *        (mesma identificação no mesmo equipamento)
 *     ⚠️ a calibração registrada já está vencida
 *
 *   Avisos da rotina diária (uma vez por etapa e vencimento): 30 dias, 7
 *   dias, no dia, e uma vez por semana depois de vencida.
 *
 * Datas sempre AAAA-MM-DD (dia de Brasília). Nada aqui bloqueia o uso do
 * equipamento numa OS — o agendamento e o checklist só avisam. */
import { addAviso, addErro, novoResultado, ResultadoValidacao } from "./resultado";
import { normalizarEspacos } from "./texto";

export type SituacaoCalibracao = "em_dia" | "vence_breve" | "vencida" | "sem_calibracao";

/** "Vence em breve" a partir de quantos dias antes do vencimento. */
export const DIAS_VENCE_BREVE = 30;
export const VALIDADE_MESES_PADRAO = 12;
export const VALIDADE_MESES_MAX = 120;
export const CERTIFICADO_MAX_BYTES = 4 * 1024 * 1024;
export const PASTA_CERTIFICADOS = "calibracao/";

export const ROTULO_SITUACAO_CALIBRACAO: Record<SituacaoCalibracao, string> = {
  em_dia: "Em dia",
  vence_breve: "Vence em breve",
  vencida: "Vencida",
  sem_calibracao: "Sem calibração",
};
export const ICONE_SITUACAO_CALIBRACAO: Record<SituacaoCalibracao, string> = {
  em_dia: "🟢", vence_breve: "🟡", vencida: "🔴", sem_calibracao: "⚪",
};
/** Gravidade para ordenar (maior = pior). */
export const GRAVIDADE_CALIBRACAO: Record<SituacaoCalibracao, number> = {
  em_dia: 0, vence_breve: 1, sem_calibracao: 2, vencida: 3,
};

export interface CalibracaoDados {
  calibrado_em?: string | null;
  vence_em?: string | null;
  validade_meses?: number | null;
  certificado?: string | null;
  laboratorio?: string | null;
  certificado_path?: string | null;
}

export interface UnidadeEquipamento extends CalibracaoDados {
  id: string;
  equipamento_id: string;
  identificacao: string;
  observacao?: string | null;
  ativo?: boolean | null;
  atualizado_em?: string | null;
}

export interface RegistroCalibracao extends CalibracaoDados {
  id: string;
  unidade_id: string;
  calibrado_em: string;
  vence_em: string;
  registrado_por?: string | null;
  registrado_em?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dataIsoCalibracao(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Soma meses mantendo o dia (31/01 + 1 mês → 28 ou 29/02). */
export function somarMesesCalibracao(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Dias de `de` até `ate` (positivo se `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  const t = (s: string) => { const [a, m, d] = s.split("-").map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((t(ate) - t(de)) / 86400000);
}

/** DD/MM/AAAA. */
export function dataBrCalibracao(iso: string | null | undefined): string {
  return iso && ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
}

/** Vencimento de uma calibração: o informado, ou data + validade. */
export function vencimentoCalibracao(d: Pick<CalibracaoDados, "calibrado_em" | "vence_em" | "validade_meses">): string | null {
  if (dataIsoCalibracao(d.vence_em)) return d.vence_em;
  if (dataIsoCalibracao(d.calibrado_em) && Number.isInteger(d.validade_meses) && (d.validade_meses as number) > 0) {
    return somarMesesCalibracao(d.calibrado_em, d.validade_meses as number);
  }
  return null;
}

/** Situação na data `ref` (hoje, ou o último dia da visita). */
export function situacaoCalibracao(venceEm: string | null | undefined, ref: string): SituacaoCalibracao {
  if (!dataIsoCalibracao(venceEm)) return "sem_calibracao";
  const dias = diasEntre(ref, venceEm);
  if (dias < 0) return "vencida";
  return dias <= DIAS_VENCE_BREVE ? "vence_breve" : "em_dia";
}

/** "vence em 12 dias (20/11/2026)", "vence hoje", "vencida há 3 dias (…)". */
export function textoVencimento(venceEm: string | null | undefined, hoje: string): string {
  if (!dataIsoCalibracao(venceEm)) return "sem calibração cadastrada";
  const dias = diasEntre(hoje, venceEm);
  const data = dataBrCalibracao(venceEm);
  if (dias === 0) return `vence hoje (${data})`;
  if (dias === 1) return `vence amanhã (${data})`;
  if (dias > 0) return `vence em ${dias} dias (${data})`;
  return dias === -1 ? `vencida desde ontem (${data})` : `vencida há ${-dias} dias (${data})`;
}

/** Unidade ativa com o vencimento mais distante (a "melhor" para levar). */
export function melhorUnidade<T extends Pick<UnidadeEquipamento, "vence_em" | "ativo">>(unidades: T[]): T | null {
  const ativas = (unidades || []).filter((u) => u.ativo !== false);
  if (!ativas.length) return null;
  return ativas.slice().sort((a, b) => (b.vence_em || "").localeCompare(a.vence_em || ""))[0];
}

/** Pior situação entre as unidades ativas (o selo do equipamento na lista
 *  do Catálogo). Sem unidade ativa: sem_calibracao. */
export function situacaoEquipamento(unidades: Pick<UnidadeEquipamento, "vence_em" | "ativo">[], hoje: string): SituacaoCalibracao {
  const ativas = (unidades || []).filter((u) => u.ativo !== false);
  if (!ativas.length) return "sem_calibracao";
  return ativas.map((u) => situacaoCalibracao(u.vence_em, hoje))
    .sort((a, b) => GRAVIDADE_CALIBRACAO[b] - GRAVIDADE_CALIBRACAO[a])[0];
}

// ── Validação ────────────────────────────────────────────────────────────

export const ROTULOS_CALIBRACAO: Record<string, string> = {
  identificacao: "Nº de série / patrimônio",
  calibrado_em: "Data da calibração",
  validade_meses: "Validade",
  vence_em: "Vencimento",
  certificado: "Certificado",
  laboratorio: "Laboratório",
};

/** Chave para comparar identificações (sem espaços extras, minúscula). */
export const chaveIdentificacao = (s: string | null | undefined) => normalizarEspacos(s).toLowerCase();

export function validarUnidade(
  d: { id?: string | null; identificacao?: string | null },
  outras: Pick<UnidadeEquipamento, "id" | "identificacao">[] = []
): ResultadoValidacao {
  const r = novoResultado();
  const ident = normalizarEspacos(d.identificacao);
  if (!ident) addErro(r, "identificacao", "Informe o nº de série ou patrimônio da unidade.");
  else if (ident.length > 80) addErro(r, "identificacao", "Use até 80 caracteres.");
  else {
    const igual = outras.find((u) => u.id !== d.id && chaveIdentificacao(u.identificacao) === chaveIdentificacao(ident));
    if (igual) addErro(r, "identificacao", `Já existe a unidade “${igual.identificacao}” neste equipamento.`);
  }
  return r;
}

/** Calibração digitada. `hoje` = dia de Brasília. */
export function validarCalibracao(d: CalibracaoDados, hoje: string): ResultadoValidacao {
  const r = novoResultado();
  const data = (d.calibrado_em || "").trim();
  if (!data) addErro(r, "calibrado_em", "Informe a data da calibração.");
  else if (!dataIsoCalibracao(data)) addErro(r, "calibrado_em", "Data da calibração inválida.");
  else if (data > hoje) addErro(r, "calibrado_em", "A data da calibração não pode ser no futuro.");

  const temVence = !!(d.vence_em || "").trim();
  if (temVence) {
    if (!dataIsoCalibracao(d.vence_em)) addErro(r, "vence_em", "Vencimento inválido.");
    else if (dataIsoCalibracao(data) && d.vence_em! <= data) addErro(r, "vence_em", "O vencimento precisa ser depois da data da calibração.");
  } else {
    const m = d.validade_meses;
    if (m === null || m === undefined || Number.isNaN(m)) addErro(r, "validade_meses", "Informe a validade em meses (ou o vencimento).");
    else if (!Number.isInteger(m) || m < 1 || m > VALIDADE_MESES_MAX) addErro(r, "validade_meses", `A validade vai de 1 a ${VALIDADE_MESES_MAX} meses.`);
  }
  if ((d.certificado || "").length > 120) addErro(r, "certificado", "Use até 120 caracteres.");
  if ((d.laboratorio || "").length > 160) addErro(r, "laboratorio", "Use até 160 caracteres.");

  const vence = vencimentoCalibracao(d);
  if (vence && dataIsoCalibracao(data) && !Object.keys(r.erros).length && vence < hoje) {
    addAviso(r, temVence ? "vence_em" : "validade_meses", `Esta calibração já está vencida (${dataBrCalibracao(vence)}).`);
  }
  return r;
}

/** Calibração limpa para gravar (vencimento já calculado). */
export function normalizarCalibracao(d: CalibracaoDados): Required<Omit<CalibracaoDados, "vence_em">> & { vence_em: string | null } {
  const temVence = dataIsoCalibracao(d.vence_em);
  const meses = Number.isInteger(d.validade_meses) ? (d.validade_meses as number) : null;
  return {
    calibrado_em: (d.calibrado_em || "").trim(),
    validade_meses: temVence ? null : meses,
    vence_em: vencimentoCalibracao({ ...d, validade_meses: meses }),
    certificado: normalizarEspacos(d.certificado) || null,
    laboratorio: normalizarEspacos(d.laboratorio) || null,
    certificado_path: d.certificado_path || null,
  };
}

export function caminhoCertificadoValido(c: unknown): c is string {
  return typeof c === "string" && /^calibracao\/[0-9a-f-]{36}\.pdf$/.test(c);
}

// ── Avisos da rotina ─────────────────────────────────────────────────────

/** Etapa do aviso para o vencimento em `hoje` (null = nada a avisar agora).
 *  Faltando 30–8 dias → "30d"; 7–1 → "7d"; no dia → "hoje"; vencida → uma
 *  por semana ("vencida-0" do 1º ao 7º dia, "vencida-1" do 8º ao 14º…).
 *  Se a rotina falhar um dia, a etapa ainda vale no seguinte. */
export function etapaAvisoCalibracao(venceEm: string | null | undefined, hoje: string): string | null {
  if (!dataIsoCalibracao(venceEm)) return null;
  const dias = diasEntre(hoje, venceEm);
  if (dias > DIAS_VENCE_BREVE) return null;
  if (dias > 7) return "30d";
  if (dias > 0) return "7d";
  if (dias === 0) return "hoje";
  return `vencida-${Math.floor((-dias - 1) / 7)}`;
}

export interface ItemAvisoCalibracao { equipamento: string; identificacao: string; vence_em: string }

/** Título e texto da notificação do dia (todas as unidades juntas). */
export function mensagemAvisoCalibracao(itens: ItemAvisoCalibracao[], hoje: string): { titulo: string; mensagem: string } {
  const vencidas = itens.filter((i) => diasEntre(hoje, i.vence_em) < 0).length;
  const vencendo = itens.length - vencidas;
  const partes = [
    vencidas ? `${vencidas} vencida${vencidas > 1 ? "s" : ""}` : "",
    vencendo ? `${vencendo} vencendo` : "",
  ].filter(Boolean);
  const titulo = `Calibração de equipamentos: ${partes.join(" e ")}`;
  const linhas = itens
    .slice().sort((a, b) => a.vence_em.localeCompare(b.vence_em))
    .map((i) => `${i.equipamento} (${i.identificacao}) — ${textoVencimento(i.vence_em, hoje)}`);
  const mensagem = linhas.length > 4 ? `${linhas.slice(0, 4).join("; ")}; e mais ${linhas.length - 4}.` : linhas.join("; ") + ".";
  return { titulo, mensagem };
}

// ── Agendamento ──────────────────────────────────────────────────────────

/** O que o agendamento precisa saber de um equipamento que exige calibração. */
export interface CalibracaoDoEquipamento {
  nome: string;
  unidades: { identificacao: string; vence_em: string | null }[];
}

/** Aviso (ou null) para um equipamento levado na visita que termina em
 *  `fim` (sem data: hoje). */
export function avisoCalibracaoNaVisita(c: CalibracaoDoEquipamento, hoje: string, fim: string | null): string | null {
  const calibradas = c.unidades.filter((u) => dataIsoCalibracao(u.vence_em));
  if (!calibradas.length) {
    return c.unidades.length
      ? `“${c.nome}” exige calibração e nenhuma unidade tem calibração cadastrada — registre no Catálogo.`
      : `“${c.nome}” exige calibração e não tem unidade cadastrada no Catálogo.`;
  }
  const melhor = calibradas.slice().sort((a, b) => (b.vence_em || "").localeCompare(a.vence_em || ""))[0];
  const vence = melhor.vence_em!;
  const plural = c.unidades.length > 1;
  if (vence < hoje) {
    return `“${c.nome}”: calibração vencida${plural ? " em todas as unidades" : ""} (${plural ? "a mais recente venceu" : "venceu"} em ${dataBrCalibracao(vence)}).`;
  }
  const ref = fim && dataIsoCalibracao(fim) ? fim : hoje;
  if (vence < ref) {
    return `“${c.nome}”: a calibração ${plural ? "da unidade mais recente " : ""}vence em ${dataBrCalibracao(vence)}, antes do fim da visita (${dataBrCalibracao(ref)}).`;
  }
  return null;
}
