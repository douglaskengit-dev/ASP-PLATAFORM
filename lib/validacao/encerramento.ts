/** Fase 10 — ENCERRAMENTO da OS e ENTREGA ao cliente. Puro (navegador +
 * API): a página da OS mostra as pendências e as mensagens; a API
 * (/api/inspecoes/[id]/encerramento e /entregas) recalcula tudo no
 * servidor e repete o que bloqueia.
 *
 *   ⛔ encerrar com pendência (sem ser o encerramento manual) · data de
 *      encerramento no futuro (Brasília) ou antes da última atividade da OS
 *      · encerramento manual sem justificativa com sentido (≥ 15 caracteres)
 *      ou por quem não é Admin/Gerência · Comercial só encerra sem pendência
 *      · reabrir sem motivo com sentido ou sem ser Admin/Gerência
 *   ⛔ entrega: data no futuro ou antes da data dos documentos · contato fora
 *      dos contatos do cliente · nenhum arquivo · meio fora da lista
 *      ("outro" exige descrever)
 *   ⚠️ mesmo arquivo já entregue ao mesmo contato (mostra a data) · encerrar
 *      sem entrega registrada
 *
 * Pendências (cada uma aponta a seção que resolve — #relatorios, #rdos…):
 *   relatório de execução sem a versão assinada · relatório de inspeção sem
 *   a versão assinada (só se a OS tem relatório de inspeção) · PDF do laudo
 *   faltando (procedimento com laudo) · RDO sem .docx ou com .docx
 *   desatualizado · dia do período da execução sem RDO · coleta de fotos da
 *   execução incompleta · relatório em rascunho ou em aprovação. */
import { addAviso, addErro, novoResultado, type ResultadoValidacao } from "./resultado";
import { erroDescricaoMotivo } from "./aprovacao";
import { diasSemRdo, textoDiasSemRdo } from "./execucao";
import { dataIsoValida, hojeBrasil } from "./formatos";
import { normalizarEspacos } from "./texto";
import type { Periodo } from "./periodo";
import { rdosSemArquivoEmDia, type RdoArquivo } from "./aprovacaoExecucao";
import { pendenciasColeta, type RegistroFotosExecucao } from "../asp/fotos-execucao";
import { numeroRdo } from "../asp/rdo";

// ── Permissões ───────────────────────────────────────────────────────────────

/** Encerrar a OS (sem pendências): Admin, Gerência e Comercial. */
export const PERFIS_ENCERRAR = ["admin", "gerencia", "comercial"];
/** Encerrar ignorando pendências (manual) e reabrir: só Admin e Gerência. */
export const PERFIS_ENCERRAR_MANUAL = ["admin", "gerencia"];
export const PERFIS_REABRIR = ["admin", "gerencia"];
/** Registrar entrega ao cliente: Admin, Gerência e Comercial. */
export const PERFIS_ENTREGA = ["admin", "gerencia", "comercial"];

export const podeEncerrar = (perfil: string | null | undefined) => PERFIS_ENCERRAR.includes(perfil || "");
export const podeEncerrarManual = (perfil: string | null | undefined) => PERFIS_ENCERRAR_MANUAL.includes(perfil || "");
export const podeReabrir = (perfil: string | null | undefined) => PERFIS_REABRIR.includes(perfil || "");
export const podeRegistrarEntrega = (perfil: string | null | undefined) => PERFIS_ENTREGA.includes(perfil || "");

// ── Datas ────────────────────────────────────────────────────────────────────

/** Dia (AAAA-MM-DD) em Brasília de uma data ISO com hora; data pura passa direto. */
export function diaBrasilia(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = new Date(iso);
  return isNaN(t.getTime()) ? null : hojeBrasil(t);
}

/** "DD/MM/AAAA". */
export function dataBrCompleta(iso: string | null | undefined): string {
  const d = diaBrasilia(iso);
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "";
}

/** "DD/MM". */
export function dataBrCurta(iso: string | null | undefined): string {
  return dataBrCompleta(iso).slice(0, 5);
}

// ── Pendências ───────────────────────────────────────────────────────────────

/** Relatório como a página/API o tem (só o que importa aqui). */
export interface RelatorioEncerramento {
  id: string;
  tipo: string;
  versao: number;
  status: string;
  dados?: { laudoPdf?: { caminho?: string | null } | null } | null;
  avaliado_em?: string | null;
  assinado_em?: string | null;
}

/** Seção da página da OS que resolve a pendência (âncora da URL). */
export type SecaoPendencia = "relatorios" | "rdos" | "fotos" | "agendamentos";

export interface PendenciaEncerramento {
  chave: string;
  texto: string;
  secao: SecaoPendencia;
}

export interface ContextoPendencias {
  /** Relatórios NÃO excluídos da OS. */
  relatorios: RelatorioEncerramento[];
  /** Procedimento com o bloco do laudo (procedimentoUsaLaudo). */
  usaLaudo: boolean;
  /** RDOs (não excluídos) que cobrem a OS. */
  rdos: RdoArquivo[];
  /** Período da execução (agendamento de execução ativo). */
  periodo: Periodo | null;
  hoje: string;
  /** Coleta de fotos da execução (null = nada gravado → tudo pendente). */
  coleta: RegistroFotosExecucao | null;
}

const ROT_TIPO: Record<string, string> = { inspecao: "inspeção", execucao: "execução" };
const rotRdo = (r: RdoArquivo) => `nº ${numeroRdo(r.numero)} (${dataBrCompleta(r.data)})`;

/** Relatório "atual" do tipo: o assinado; senão o de maior versão que não
 *  foi substituído. */
export function relatorioAtual(rels: RelatorioEncerramento[], tipo: string): RelatorioEncerramento | null {
  const doTipo = rels.filter((r) => r.tipo === tipo && r.status !== "substituido").sort((a, b) => b.versao - a.versao);
  return doTipo.find((r) => r.status === "assinado") || doTipo[0] || null;
}

/** Tudo que impede o encerramento normal (vazio = pode encerrar). */
export function pendenciasEncerramento(c: ContextoPendencias): PendenciaEncerramento[] {
  const out: PendenciaEncerramento[] = [];
  const rels = c.relatorios || [];

  // 1) Relatório de execução assinado
  const exec = relatorioAtual(rels, "execucao");
  if (!rels.some((r) => r.tipo === "execucao" && r.status === "assinado")) {
    out.push({
      chave: "relExecucao", secao: "relatorios",
      texto: exec
        ? `Relatório de execução sem a versão assinada (v${exec.versao} está “${rotuloStatus(exec.status)}”) — envie o PDF assinado.`
        : "Nenhum relatório de execução — gere, aprove e envie a versão assinada.",
    });
  }
  // 2) Relatório de inspeção assinado (só se a OS tem relatório de inspeção)
  const temInspecao = rels.some((r) => r.tipo === "inspecao");
  if (temInspecao && !rels.some((r) => r.tipo === "inspecao" && r.status === "assinado")) {
    const insp = relatorioAtual(rels, "inspecao");
    out.push({
      chave: "relInspecao", secao: "relatorios",
      texto: `Relatório de inspeção sem a versão assinada${insp ? ` (v${insp.versao} está “${rotuloStatus(insp.status)}”)` : ""} — envie o PDF assinado.`,
    });
  }
  // 3) PDF do laudo (procedimento com laudo)
  if (c.usaLaudo && exec && !exec.dados?.laudoPdf?.caminho) {
    out.push({
      chave: "laudo", secao: "relatorios",
      texto: `O relatório de execução v${exec.versao} está sem o PDF do laudo do laboratório (o procedimento usa laudo).`,
    });
  }
  // 4) Rascunho / em aprovação esquecidos
  for (const r of rels.filter((x) => x.status === "rascunho")) {
    out.push({ chave: `rascunho:${r.id}`, secao: "relatorios",
      texto: `Relatório de ${ROT_TIPO[r.tipo] || r.tipo} v${r.versao} ficou em rascunho — envie para aprovação ou exclua.` });
  }
  for (const r of rels.filter((x) => x.status === "em_aprovacao")) {
    out.push({ chave: `emAprovacao:${r.id}`, secao: "relatorios",
      texto: `Relatório de ${ROT_TIPO[r.tipo] || r.tipo} v${r.versao} está em aprovação — a Gerência precisa aprovar ou reprovar.` });
  }
  // 5) RDOs: .docx não gerado / desatualizado
  const { semArquivo, desatualizados } = rdosSemArquivoEmDia(c.rdos || []);
  if (semArquivo.length) {
    out.push({ chave: "rdoSemArquivo", secao: "rdos", texto: `RDO(s) sem o .docx gerado: ${semArquivo.map(rotRdo).join(", ")}.` });
  }
  if (desatualizados.length) {
    out.push({ chave: "rdoDesatualizado", secao: "rdos",
      texto: `RDO(s) editado(s) depois de gerar o .docx (arquivo desatualizado): ${desatualizados.map(rotRdo).join(", ")}.` });
  }
  // 6) Dias do período sem RDO (o período inteiro — a execução acabou)
  const faltam = diasSemRdo(c.periodo, (c.rdos || []).map((r) => r.data), c.hoje);
  if (faltam.length) {
    out.push({ chave: "diasSemRdo", secao: "rdos", texto: `Dia(s) do período da execução sem RDO desta OS: ${textoDiasSemRdo(faltam)}.` });
  }
  // 7) Coleta de fotos da execução
  const pend = pendenciasColeta(c.coleta || { agua_antes: false, agua_depois: false, limpeza_confirmada: false, itens: {} });
  if (pend.length) {
    out.push({ chave: "fotos", secao: "fotos",
      texto: `Coleta de fotos da execução incompleta (${pend.length} pendência(s)): ${pend.slice(0, 4).join("; ")}${pend.length > 4 ? "; …" : "."}` });
  }
  return out;
}

function rotuloStatus(s: string): string {
  return ({ rascunho: "Rascunho", em_aprovacao: "Em aprovação", aprovado: "Aprovado", ajustar: "Ajustar", assinado: "Assinado", substituido: "Substituído" } as Record<string, string>)[s] || s;
}

// ── Última atividade da OS ───────────────────────────────────────────────────

export interface ContextoAtividade {
  rdos: { data: string }[];
  relatorios: { avaliado_em?: string | null; assinado_em?: string | null }[];
  coletas: { data_coleta?: string | null }[];
  periodo: Periodo | null;
}

/** Último dia com atividade na OS (Brasília): RDO, avaliação/assinatura de
 *  relatório, coleta e fim do período da execução. null = nenhuma. */
export function ultimaAtividade(c: ContextoAtividade): { dia: string; origem: string } | null {
  const cands: { dia: string | null; origem: string }[] = [
    ...(c.rdos || []).map((r) => ({ dia: diaBrasilia(r.data), origem: "RDO" })),
    ...(c.relatorios || []).flatMap((r) => [
      { dia: diaBrasilia(r.avaliado_em), origem: "avaliação de relatório" },
      { dia: diaBrasilia(r.assinado_em), origem: "versão assinada de relatório" },
    ]),
    ...(c.coletas || []).map((x) => ({ dia: diaBrasilia(x.data_coleta), origem: "coleta" })),
    { dia: c.periodo?.fim || null, origem: "fim do período da execução" },
  ];
  let melhor: { dia: string; origem: string } | null = null;
  for (const x of cands) if (x.dia && (!melhor || x.dia > melhor.dia)) melhor = { dia: x.dia, origem: x.origem };
  return melhor;
}

// ── Encerrar ─────────────────────────────────────────────────────────────────

export interface DadosEncerramento {
  data: string | null | undefined;
  manual?: boolean;
  justificativa?: string | null;
}

export interface ContextoEncerramento {
  perfil: string | null | undefined;
  hoje: string;
  ultima: { dia: string; origem: string } | null;
  pendencias: PendenciaEncerramento[];
  /** Entregas registradas (para o aviso "sem entrega"). undefined = não checado. */
  entregas?: number;
}

export const ROTULOS_ENCERRAMENTO: Record<string, string> = {
  data: "Data de encerramento", justificativa: "Justificativa", pendencias: "Pendências", perfil: "Permissão",
};

export function validarEncerramento(d: DadosEncerramento, c: ContextoEncerramento): ResultadoValidacao {
  const r = novoResultado();
  if (!podeEncerrar(c.perfil)) addErro(r, "perfil", "Só Admin, Gerência e Comercial encerram a OS.");
  if (d.manual && !podeEncerrarManual(c.perfil)) {
    addErro(r, "perfil", "Só Admin e Gerência podem encerrar ignorando pendências.");
  }
  const data = (d.data || "").trim();
  if (!data) addErro(r, "data", "Informe a data de encerramento.");
  else if (!dataIsoValida(data)) addErro(r, "data", "Data inválida.");
  else if (data > c.hoje) addErro(r, "data", "A data de encerramento não pode estar no futuro.");
  else if (c.ultima && data < c.ultima.dia) {
    addErro(r, "data", `A data não pode ser anterior à última atividade da OS (${dataBrCompleta(c.ultima.dia)} — ${c.ultima.origem}).`);
  }
  if (d.manual) {
    const e = erroJustificativa(d.justificativa);
    if (e) addErro(r, "justificativa", e);
  } else if (c.pendencias.length) {
    addErro(r, "pendencias", `${c.pendencias.length} pendência(s) impedem o encerramento — resolva-as${podeEncerrarManual(c.perfil) ? " ou use “Encerrar manualmente”" : ""}.`);
  }
  if (c.entregas === 0) addAviso(r, "entrega", "Nenhuma entrega ao cliente registrada nesta OS — registre em “Entregas ao cliente” quando enviar os documentos.");
  return r;
}

/** Justificativa do encerramento manual / motivo da reabertura: mesma régua
 *  do motivo de reprovação (≥ 15 caracteres, com sentido). */
export function erroJustificativa(
  t: string | null | undefined, oQue = "a justificativa", exemplo = "cliente dispensou o relatório de inspeção assinado",
): string | null {
  const e = erroDescricaoMotivo(t);
  if (!e) return null;
  if (e.startsWith("Descreva o que")) return `Escreva ${oQue}.`;
  if (e.startsWith("Motivo sem sentido")) return `Texto sem sentido — explique ${oQue} (ex.: “${exemplo}”).`;
  return e.replace("Descreva melhor o ajuste", `Detalhe ${oQue}`);
}

export function validarReabertura(d: { motivo: string | null | undefined }, perfil: string | null | undefined): ResultadoValidacao {
  const r = novoResultado();
  if (!podeReabrir(perfil)) addErro(r, "perfil", "Só Admin e Gerência podem reabrir a OS.");
  const e = erroJustificativa(d.motivo, "o motivo da reabertura", "cliente pediu correção na data do relatório");
  if (e) addErro(r, "motivo", e);
  return r;
}

export const ROTULOS_REABERTURA: Record<string, string> = { motivo: "Motivo", perfil: "Permissão" };

/** "Já encerrada por Fulana em 05/11." */
export function mensagemJaEncerrada(nome: string | null | undefined, em: string | null | undefined): string {
  return `Esta OS já foi encerrada${nome ? ` por ${nome}` : ""}${em ? ` em ${dataBrCurta(em)}` : ""}. Recarregue a página.`;
}

/** Texto de quem encerrou: "OS encerrada em 05/11/2026 por Fulana". */
export function textoEncerrada(em: string | null | undefined, nome: string | null | undefined, manual?: boolean): string {
  return `OS encerrada${manual ? " manualmente" : ""} em ${dataBrCompleta(em)}${nome ? ` por ${nome}` : ""}`;
}

// ── Conclusão do projeto ─────────────────────────────────────────────────────

/** O projeto está concluído quando tem OS ativa (fora da lixeira) e TODAS as
 *  ativas estão encerradas. */
export function projetoConcluido(oss: { excluido_em?: string | null; encerrada_em?: string | null }[]): boolean {
  const ativas = (oss || []).filter((o) => !o.excluido_em);
  return ativas.length > 0 && ativas.every((o) => !!o.encerrada_em);
}

// ── Entrega ao cliente ───────────────────────────────────────────────────────

export const MEIOS_ENTREGA = [
  { valor: "email", rotulo: "E-mail" },
  { valor: "impresso", rotulo: "Impresso" },
  { valor: "pendrive", rotulo: "Pendrive" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export type MeioEntrega = (typeof MEIOS_ENTREGA)[number]["valor"];

export function rotuloMeio(meio: string | null | undefined, outro?: string | null): string {
  if (meio === "outro") return outro ? `Outro — ${outro}` : "Outro";
  return MEIOS_ENTREGA.find((m) => m.valor === meio)?.rotulo || meio || "";
}

/** Arquivo final da OS que pode ser entregue. `chave` identifica o arquivo
 *  (tipo + id do registro ou caminho); `hash` (SHA-256) quando conhecido. */
export interface ArquivoEntrega {
  chave: string;
  tipo: "relatorio" | "relatorio_assinado" | "laudo" | "rdo" | "coleta";
  id: string | null;
  caminho: string | null;
  nome: string;
  hash: string | null;
  /** Data do documento (AAAA-MM-DD ou ISO) — a entrega não pode ser antes. */
  data: string | null;
}

export interface EntregaRegistrada {
  id: string;
  data: string;
  contato_id: string | null;
  contato_nome?: string | null;
  arquivos: { chave?: string; tipo?: string; id?: string | null; caminho?: string | null; nome?: string; hash?: string | null }[];
  excluido_em?: string | null;
}

/** Mesmo arquivo (hash ou chave) já entregue ao mesmo contato. */
export function entregasRepetidas(
  arquivos: ArquivoEntrega[], contatoId: string | null | undefined, anteriores: EntregaRegistrada[], excluirId?: string | null,
): { nome: string; data: string }[] {
  if (!contatoId) return [];
  const out: { nome: string; data: string }[] = [];
  for (const a of arquivos) {
    for (const e of anteriores) {
      if (e.excluido_em || e.contato_id !== contatoId || (excluirId && e.id === excluirId)) continue;
      const igual = (e.arquivos || []).some((x) => (a.hash && x.hash && x.hash === a.hash) || (x.chave && x.chave === a.chave));
      if (igual) { out.push({ nome: a.nome, data: e.data }); break; }
    }
  }
  return out;
}

export interface DadosEntrega {
  data: string | null | undefined;
  contatoId: string | null | undefined;
  /** Chaves dos arquivos marcados. */
  arquivos: string[];
  meio: string | null | undefined;
  meioOutro?: string | null;
  observacao?: string | null;
}

export interface ContextoEntrega {
  perfil: string | null | undefined;
  hoje: string;
  /** Contatos do cliente (gp_orgaos_contatos). */
  contatos: { id: string; nome_completo?: string | null }[];
  /** Arquivos finais que podem ser entregues. */
  disponiveis: ArquivoEntrega[];
  /** Entregas já registradas na OS (aviso de repetição). */
  anteriores: EntregaRegistrada[];
}

export const ROTULOS_ENTREGA: Record<string, string> = {
  data: "Data da entrega", contato: "Contato que recebeu", arquivos: "Arquivos entregues", meio: "Meio",
  meioOutro: "Meio (outro)", observacao: "Observação", perfil: "Permissão",
};

export function validarEntrega(d: DadosEntrega, c: ContextoEntrega): ResultadoValidacao {
  const r = novoResultado();
  if (!podeRegistrarEntrega(c.perfil)) addErro(r, "perfil", "Só Admin, Gerência e Comercial registram entregas.");

  const escolhidos = c.disponiveis.filter((a) => d.arquivos.includes(a.chave));
  if (!d.arquivos.length) addErro(r, "arquivos", "Marque ao menos um arquivo entregue.");
  else if (escolhidos.length !== new Set(d.arquivos).size) addErro(r, "arquivos", "Arquivo fora dos documentos finais desta OS — recarregue a página.");

  const data = (d.data || "").trim();
  const docMax = escolhidos.map((a) => diaBrasilia(a.data)).filter(Boolean).sort().pop() || null;
  if (!data) addErro(r, "data", "Informe a data da entrega.");
  else if (!dataIsoValida(data)) addErro(r, "data", "Data inválida.");
  else if (data > c.hoje) addErro(r, "data", "A data da entrega não pode estar no futuro.");
  else if (docMax && data < docMax) {
    const doc = escolhidos.find((a) => diaBrasilia(a.data) === docMax);
    addErro(r, "data", `A entrega não pode ser antes da data dos documentos (${doc?.nome || "documento"} é de ${dataBrCompleta(docMax)}).`);
  }

  if (!d.contatoId) addErro(r, "contato", "Escolha o contato do cliente que recebeu (ou cadastre um novo).");
  else if (!c.contatos.some((x) => x.id === d.contatoId)) addErro(r, "contato", "Contato não é deste cliente — escolha da lista.");

  if (!d.meio) addErro(r, "meio", "Escolha o meio da entrega.");
  else if (!MEIOS_ENTREGA.some((m) => m.valor === d.meio)) addErro(r, "meio", "Meio inválido.");
  else if (d.meio === "outro" && normalizarEspacos(d.meioOutro).length < 3) addErro(r, "meioOutro", "Descreva o meio (ex.: “WeTransfer”, “entregue em mãos”).");

  if (normalizarEspacos(d.observacao).length > 1000) addErro(r, "observacao", "Observação longa demais (máx. 1000 caracteres).");

  for (const rep of entregasRepetidas(escolhidos, d.contatoId, c.anteriores)) {
    addAviso(r, "arquivos", `“${rep.nome}” já foi entregue a este contato em ${dataBrCompleta(rep.data)}.`);
  }
  return r;
}
