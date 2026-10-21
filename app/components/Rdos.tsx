"use client";

/** RDO — Registro Diário de Operação: lista + formulário.
 *
 * Um RDO por projeto por dia, cobrindo uma ou mais inspeções (um dia
 * limpando dois tanques é um RDO só). Nasce no bloco de Execução, mas pode
 * ser visto, corrigido e baixado depois. É um documento à parte — não entra
 * no Relatório de Execução.
 *
 * O formulário já vem preenchido com o que o sistema sabe: cabeçalho do
 * projeto, contato do cliente, procedimento, equipe do agendamento de
 * execução, equipamentos do checklist e o cloro medido na coleta de fotos.
 * Tudo segue editável. A frase do cloro (CVS 6) é gerada pelo valor — nunca
 * digitada —, para o texto não poder contradizer o número.
 *
 * Offline: os dados vão pela camada de sincronização (enviarJson) com o id
 * gerado no aparelho, e o .docx — gerado aqui mesmo, a partir do modelo em
 * /templates — vai pela fila logo atrás (enviarArquivo). Se o arquivo não
 * subir, a lista oferece "Gerar arquivo" depois.
 *
 * `somenteLeitura`: página do projeto — só a lista com download.
 * `embutido`: dentro de uma SecaoRecolhivel (página da inspeção). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { enviarArquivo, enviarJson } from "@/lib/pwa/sync";
import { valorDoSlot, numeroBr, lerNumero, type RegistroFotosExecucao } from "@/lib/asp/fotos-execucao";
import {
  CONTRATADA, FUNCOES_RDO, FRASES_RAPIDAS, OPCOES_TEMPO, PERIODOS,
  arquivoEmDia, assinanteAspPadrao, dadosRdoVazio, dataBr, fraseCloro, funcaoDoPerfil, gerarRdoDocx,
  hojeIso, horaValida, nomeArquivoRdo, normalizarDadosRdo, numeroLinha, numeroRdo, ordenarAtividades,
  semFraseCloro, textoAtividade, textoDaFrase, validarRdo,
  type AtividadeRdo, type DadosRdo, type MembroRdo, type RegistroRdo, type Tempo,
} from "@/lib/asp/rdo";

/** Inspeção do projeto, para marcar a cobertura do RDO. */
interface InspecaoOpcao { id: string; identificacao: string; fase: number; procedimento?: string | null }
interface Agendamento { tipo: string; data_visita: string | null; data_execucao: string | null; criado_em?: string; equipe: { id: string; nome: string }[] }

/** O que o sistema já sabe e alimenta as sugestões do formulário. */
interface Fontes {
  usuarios: { id: string; nome: string; funcao: string | null }[];
  procedimentos: { codigo: string; nome: string; equipamentos?: string[] }[];
  equipamentos: { slug?: string; id?: string; nome: string }[];
  contato: { nome: string; cargo: string } | null;
  /** Por inspeção — carregados conforme a cobertura muda. */
  agendamentos: Record<string, Agendamento[]>;
  checklists: Record<string, string[]>;
  fotos: Record<string, RegistroFotosExecucao | null>;
}
const FONTES_VAZIAS: Fontes = { usuarios: [], procedimentos: [], equipamentos: [], contato: null, agendamentos: {}, checklists: {}, fotos: {} };

const campo: React.CSSProperties = {
  width: "100%", padding: "10px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14, minHeight: 44,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // navegador antigo / http: uuid v4 com Math.random (só identifica o rascunho)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** GET tolerante: falha de rede ou HTTP vira {} (a sugestão só fica vazia). */
const getJson = (url: string): Promise<any> => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

/** Hora atual "HH:MM" (sugestão para a próxima atividade, no dia de hoje). */
function horaAgora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Ordem da equipe no documento: coordenador, engenheiro, técnico, auxiliar. */
function ordemFuncao(f: string): number {
  const i = FUNCOES_RDO.findIndex((x) => x.toLowerCase() === f.trim().toLowerCase());
  return i === -1 ? FUNCOES_RDO.length : i;
}

/** Limpa o que vai ao banco: linhas vazias saem, frase de cloro digitada à
 *  mão sai quando há valor (a oficial é gerada). */
function limparDados(d: DadosRdo): DadosRdo {
  return {
    ...d,
    equipe: d.equipe.filter((m) => m.nome.trim() || m.funcao.trim()),
    atividades: d.atividades.map((a) => ({
      ...a, fim: a.fim || undefined,
      texto: a.cloro != null ? semFraseCloro(a.texto) : a.texto,
    })),
    fiscalizacao: d.fiscalizacao.map((s) => s.trim()).filter(Boolean),
    ddsms: d.ddsms.map((s) => s.trim()).filter(Boolean),
  };
}

export default function Rdos({
  projetoId, inspecaoId, codigoProjeto, cliente, clienteId,
  podeEditar, somenteLeitura, embutido, pedidoNovo, onMudar, onErro,
}: {
  projetoId: string;
  /** Página da inspeção: a lista mostra os RDOs que a cobrem, e ela é a
   *  cobertura padrão do RDO novo. */
  inspecaoId?: string;
  codigoProjeto?: string | null;
  cliente?: string | null;
  clienteId?: string | null;
  podeEditar?: boolean;
  somenteLeitura?: boolean;
  embutido?: boolean;
  /** Muda (incrementa) quando a página pede um RDO novo — o botão fica no
   *  cabeçalho da seção, fora deste componente. */
  pedidoNovo?: number;
  /** RDOs que a página mostra (os da inspeção, ou todos do projeto). */
  onMudar?: (rdos: RegistroRdo[]) => void;
  onErro?: (erro: string | null) => void;
}) {
  const [rdos, setRdos] = useState<RegistroRdo[]>([]);
  const [carregado, setCarregado] = useState(false);
  /** Falha ao LER a lista — aí a página não pode concluir "nenhum RDO". */
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Formulário
  const [form, setForm] = useState<{ id: string; novo: boolean; numero?: number } | null>(null);
  const [dados, setDados] = useState<DadosRdo>(dadosRdoVazio());
  const [data, setData] = useState(hojeIso());
  const [cobertas, setCobertas] = useState<string[]>([]);
  const [inspecoesProjeto, setInspecoesProjeto] = useState<InspecaoOpcao[]>([]);
  const [fontes, setFontes] = useState<Fontes>(FONTES_VAZIAS);
  const [preenchendo, setPreenchendo] = useState(false);
  const [salvando, setSalvando] = useState<null | "salvar" | "gerar">(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [mostrarAvisos, setMostrarAvisos] = useState(false);
  /** Fontes já carregadas — evita buscar de novo ao reabrir o formulário. */
  const fontesRef = useRef<Fontes>(FONTES_VAZIAS);
  /** As sugestões rodam logo depois de carregar as fontes, antes de as
   *  inspeções do projeto chegarem ao estado — daí a ref. */
  const inspecoesProjetoRef = useRef<InspecaoOpcao[]>([]);
  const definirInspecoesProjeto = useCallback((l: InspecaoOpcao[]) => {
    inspecoesProjetoRef.current = l;
    setInspecoesProjeto(l);
  }, []);

  const carregar = useCallback(() => {
    fetch(`/api/rdos?projetoId=${projetoId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErroCarga(d?.erro || "Não foi possível carregar os RDOs."); return; }
        setErroCarga(null);
        setRdos((d.rdos || []).map((x: any) => ({ ...x, dados: normalizarDadosRdo(x.dados), inspecoes: x.inspecoes || [] })));
      })
      .catch(() => setErroCarga("Sem conexão — os RDOs aparecem quando a rede voltar."))
      .finally(() => setCarregado(true));
  }, [projetoId]);
  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(
    () => (inspecaoId ? rdos.filter((r) => r.inspecoes.includes(inspecaoId)) : rdos),
    [rdos, inspecaoId],
  );
  useEffect(() => { if (carregado && !erroCarga) onMudar?.(visiveis); }, [visiveis, carregado, erroCarga]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onErro?.(erro || erroCarga); }, [erro, erroCarga]);                                       // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fontes de sugestão ─────────────────────────────────────────────────────

  /** Carrega o que é do projeto (uma vez) e o que é de cada inspeção coberta
   *  (agendamentos, checklist, fotos) que ainda não estiver em memória. */
  const carregarFontes = useCallback(async (ids: string[]): Promise<Fontes> => {
    let f = fontesRef.current;
    if (f.usuarios.length === 0 && f.procedimentos.length === 0) {
      const [proj, cat, usu, org] = await Promise.all([
        getJson(`/api/projetos/${projetoId}`),
        getJson("/api/catalogo"),
        getJson("/api/usuarios"),
        clienteId ? getJson(`/api/orgaos/${clienteId}`) : Promise.resolve({} as any),
      ]);
      definirInspecoesProjeto((proj.inspecoes || []).map((i: any) => ({
        id: i.id, identificacao: i.identificacao, fase: i.fase, procedimento: i.procedimento,
      })));
      const c = (org.orgao?.contatos || [])[0];
      f = {
        ...f,
        usuarios: usu.usuarios || [],
        procedimentos: cat.procedimentos || [],
        equipamentos: cat.equipamentos || [],
        contato: c ? { nome: c.nome_completo || c.nome || "", cargo: c.cargo || "" } : null,
      };
    }
    const faltam = ids.filter((id) => !(id in f.fotos));
    if (faltam.length > 0) {
      const porInsp = await Promise.all(faltam.map(async (id) => {
        const [ag, ck, ft] = await Promise.all([
          getJson(`/api/agendamentos?inspecaoId=${id}`),
          getJson(`/api/checklist?inspecaoId=${id}`),
          getJson(`/api/inspecoes/${id}/fotos`),
        ]);
        const exec = (ck.checklists || []).find((x: any) => x.tipo === "execucao");
        return {
          id, agendamentos: (ag.agendamentos || []) as Agendamento[],
          checklist: ((exec?.itens || []) as any[]).map((i) => String(i?.nome || "").trim()).filter(Boolean),
          fotos: (ft.registro || null) as RegistroFotosExecucao | null,
        };
      }));
      f = {
        ...f,
        agendamentos: { ...f.agendamentos, ...Object.fromEntries(porInsp.map((x) => [x.id, x.agendamentos])) },
        checklists: { ...f.checklists, ...Object.fromEntries(porInsp.map((x) => [x.id, x.checklist])) },
        fotos: { ...f.fotos, ...Object.fromEntries(porInsp.map((x) => [x.id, x.fotos])) },
      };
    }
    fontesRef.current = f;
    setFontes(f);
    return f;
  }, [projetoId, clienteId, definirInspecoesProjeto]);

  const nomeInspecao = useCallback((id: string) =>
    inspecoesProjeto.find((i) => i.id === id)?.identificacao || "inspeção", [inspecoesProjeto]);

  /** Equipe do agendamento de execução do dia (ou o mais recente), com a
   *  função do cadastro de cada usuário. */
  function equipeSugerida(f: Fontes, ids: string[], dia: string): MembroRdo[] {
    const vistos = new Set<string>();
    const lista: MembroRdo[] = [];
    for (const id of ids) {
      const execs = (f.agendamentos[id] || []).filter((a) => a.tipo === "execucao");
      const ag = execs.find((a) => a.data_visita === dia || a.data_execucao === dia)
        || [...execs].sort((a, b) => String(b.data_execucao || b.data_visita || "").localeCompare(String(a.data_execucao || a.data_visita || "")))[0];
      for (const m of ag?.equipe || []) {
        const chave = m.id || m.nome;
        if (!m.nome || vistos.has(chave)) continue;
        vistos.add(chave);
        lista.push({ nome: m.nome, funcao: funcaoDoPerfil(f.usuarios.find((u) => u.id === m.id)?.funcao) });
      }
    }
    return lista.sort((a, b) => ordemFuncao(a.funcao) - ordemFuncao(b.funcao));
  }

  /** Equipamentos do checklist de execução; sem checklist, os previstos no
   *  procedimento (Catálogo). */
  function equipamentosSugeridos(f: Fontes, ids: string[]): string {
    const nomes = new Set<string>();
    ids.forEach((id) => (f.checklists[id] || []).forEach((n) => nomes.add(n)));
    if (nomes.size === 0) {
      for (const id of ids) {
        const cod = inspecoesProjetoRef.current.find((i) => i.id === id)?.procedimento;
        const proc = f.procedimentos.find((p) => p.codigo === cod);
        (proc?.equipamentos || []).forEach((slug) => {
          const e = f.equipamentos.find((x) => (x.slug || x.id) === slug);
          if (e?.nome) nomes.add(e.nome);
        });
      }
    }
    return Array.from(nomes).join(", ");
  }

  function descricaoSugerida(f: Fontes, ids: string[]): string {
    const nomes = new Set<string>();
    for (const id of ids) {
      const cod = inspecoesProjetoRef.current.find((i) => i.id === id)?.procedimento;
      const proc = f.procedimentos.find((p) => p.codigo === cod);
      if (proc?.nome) nomes.add(proc.nome);
    }
    return Array.from(nomes).join(" / ");
  }

  /** Cloro medido na coleta de fotos das inspeções cobertas. */
  function cloroSugerido(momento: "antes" | "depois"): { valor: number; de: string } | null {
    for (const id of cobertas) {
      const v = valorDoSlot(fontes.fotos[id], momento === "antes" ? "agua_antes_cloro" : "agua_depois_cloro");
      if (v != null) return { valor: v, de: nomeInspecao(id) };
    }
    return null;
  }

  // ── Abrir / fechar ─────────────────────────────────────────────────────────

  async function abrirNovo() {
    const ids = inspecaoId ? [inspecaoId] : [];
    const dia = hojeIso();
    setForm({ id: novoId(), novo: true });
    setData(dia);
    setCobertas(ids);
    setDados({ ...dadosRdoVazio(), codigoProjeto: codigoProjeto || "", cliente: cliente || "" });
    setErroForm(null); setMostrarAvisos(false);
    setPreenchendo(true);
    try {
      const f = await carregarFontes(ids);
      // Preenche só o que continua vazio: a pessoa pode ter começado a digitar.
      setDados((d) => {
        const equipe = d.equipe.length ? d.equipe : equipeSugerida(f, ids, dia);
        return {
          ...d,
          responsavel: d.responsavel || f.contato?.nome || "",
          descricao: d.descricao || descricaoSugerida(f, ids),
          equipe,
          equipamentos: d.equipamentos || equipamentosSugeridos(f, ids),
          assinaturaAsp: d.assinaturaAsp.nome ? d.assinaturaAsp : assinanteAspPadrao(equipe),
          assinaturaCliente: d.assinaturaCliente.nome ? d.assinaturaCliente
            : { nome: f.contato?.nome || "", cargo: f.contato?.cargo || "" },
        };
      });
    } finally {
      setPreenchendo(false);
    }
  }

  function abrirEdicao(r: RegistroRdo, incluir?: string) {
    setForm({ id: r.id, novo: false, numero: r.numero });
    setData(r.data);
    setCobertas(incluir && !r.inspecoes.includes(incluir) ? [...r.inspecoes, incluir] : r.inspecoes);
    setDados(normalizarDadosRdo(r.dados));
    setErroForm(null); setMostrarAvisos(false);
    // as fontes (cloro da coleta de fotos…) chegam pelo efeito da cobertura
  }

  useEffect(() => {
    if (pedidoNovo && podeEditar && !somenteLeitura) abrirNovo();
  }, [pedidoNovo]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Cobertura mudou: busca as fontes das inspeções novas (cloro, checklist…).
  useEffect(() => {
    if (form && cobertas.length) carregarFontes(cobertas).catch(() => {});
  }, [cobertas, form, carregarFontes]);

  function fechar() {
    if (salvando) return;
    setForm(null);
  }

  // ── Edição dos dados ───────────────────────────────────────────────────────

  const mudar = (parcial: Partial<DadosRdo>) => setDados((d) => ({ ...d, ...parcial }));
  const mudarAtividade = (i: number, parcial: Partial<AtividadeRdo>) =>
    setDados((d) => ({ ...d, atividades: d.atividades.map((a, k) => (k === i ? { ...a, ...parcial } : a)) }));
  function moverAtividade(i: number, delta: number) {
    setDados((d) => {
      const l = [...d.atividades];
      const j = i + delta;
      if (j < 0 || j >= l.length) return d;
      [l[i], l[j]] = [l[j], l[i]];
      return { ...d, atividades: l };
    });
  }
  function proximaHora(d: DadosRdo): string {
    if (data === hojeIso()) return horaAgora();
    const ultima = d.atividades[d.atividades.length - 1];
    return ultima ? (ultima.fim || ultima.inicio) : "";
  }
  function inserirFrase(i: number) {
    const f = FRASES_RAPIDAS[i];
    setDados((d) => {
      const sug = f.momento ? cloroSugerido(f.momento) : null;
      const nova: AtividadeRdo = {
        inicio: f.inicio || proximaHora(d), fim: f.fim,
        texto: textoDaFrase(f, d.cliente), momento: f.momento || null, cloro: sug ? sug.valor : null,
      };
      return { ...d, atividades: [...d.atividades, nova] };
    });
  }

  function alternarCobertura(id: string) {
    setCobertas((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  const validacao = useMemo(() => validarRdo(dados, data, cobertas), [dados, data, cobertas]);
  const doMesmoDia = form ? rdos.find((r) => r.data === data && r.id !== form.id) : undefined;

  // ── Salvar / gerar ─────────────────────────────────────────────────────────

  /** Gera o .docx aqui, baixa no aparelho e envia (ou enfileira) o arquivo. */
  async function gerarEEnviar(id: string, d: DadosRdo, dia: string): Promise<boolean> {
    let blob: Blob;
    try {
      blob = (await gerarRdoDocx(d, dia)) as Blob;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o arquivo do RDO.");
      return false;
    }
    const nome = nomeArquivoRdo(d, dia);
    baixarBlob(blob, nome);
    const res = await enviarArquivo(`/api/rdos/${id}/arquivo`, {}, new File([blob], nome, { type: DOCX }), `RDO ${dataBr(dia)} (arquivo)`);
    if (!res.queued && !res.ok) {
      setErro(res.data?.erro || "O arquivo foi baixado, mas não subiu para o sistema. Use “Gerar arquivo” de novo.");
      return false;
    }
    return true;
  }

  async function salvar(gerar: boolean) {
    if (!form) return;
    setErroForm(null);
    if (gerar && validacao.erros.length > 0) {
      setErroForm("Corrija antes de gerar o arquivo:\n• " + validacao.erros.join("\n• "));
      return;
    }
    if (!data) { setErroForm("Informe a data do RDO."); return; }
    if (cobertas.length === 0) { setErroForm("Marque ao menos uma inspeção coberta por este RDO."); return; }
    const limpos = limparDados(dados);
    setSalvando(gerar ? "gerar" : "salvar");
    try {
      const res = form.novo
        ? await enviarJson("/api/rdos", "POST", { id: form.id, projetoId, data, inspecoes: cobertas, dados: limpos }, `RDO ${dataBr(data)}`)
        : await enviarJson(`/api/rdos/${form.id}`, "PATCH", { data, inspecoes: cobertas, dados: limpos }, `RDO ${dataBr(data)}`);
      if (!res.queued && !res.ok) {
        setErroForm(res.data?.erro || "Não foi possível salvar o RDO.");
        return;
      }
      if (gerar) await gerarEEnviar(form.id, limpos, data);
      setForm(null);
      if (res.queued) {
        alert("Sem conexão — RDO salvo offline e enviado ao reconectar." + (gerar ? " O arquivo já foi baixado neste aparelho." : ""));
      }
      carregar();
    } finally {
      setSalvando(null);
    }
  }

  async function gerarArquivo(r: RegistroRdo) {
    setOcupado(r.id);
    setErro(null);
    try {
      if (await gerarEEnviar(r.id, normalizarDadosRdo(r.dados), r.data)) carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function excluir(r: RegistroRdo) {
    if (!confirm(`Excluir o RDO nº ${numeroRdo(r.numero)} (${dataBr(r.data)})?\n\nEle sai da lista, mas fica recuperável por 30 dias.`)) return;
    setOcupado(r.id);
    try {
      const res = await enviarJson(`/api/rdos/${r.id}`, "DELETE", {}, `Excluir RDO ${dataBr(r.data)}`);
      if (!res.queued && !res.ok) { setErro(res.data?.erro || "Falha ao excluir o RDO."); return; }
      setRdos((l) => l.filter((x) => x.id !== r.id));
    } finally {
      setOcupado(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const nomesCobertos = (r: RegistroRdo) =>
    r.inspecoes.map((id) => inspecoesProjeto.find((i) => i.id === id)?.identificacao).filter(Boolean).join(", ");
  // Nomes das inspeções para a lista (sem abrir o formulário).
  useEffect(() => {
    if (rdos.length && inspecoesProjeto.length === 0) {
      getJson(`/api/projetos/${projetoId}`).then((proj: any) => {
        if (proj.inspecoes) definirInspecoesProjeto(proj.inspecoes.map((i: any) => ({
          id: i.id, identificacao: i.identificacao, fase: i.fase, procedimento: i.procedimento,
        })));
      });
    }
  }, [rdos.length, inspecoesProjeto.length, projetoId, definirInspecoesProjeto]);

  const lista = (
    <>
      {(erro || erroCarga) && <p className="erro-texto" style={{ margin: "0 0 8px" }}>{erro || erroCarga}</p>}
      {!carregado || (erroCarga && rdos.length === 0) ? (
        <p className="vazio" style={{ margin: 0 }}>{erroCarga ? "Lista indisponível no momento." : "Carregando…"}</p>
      ) : visiveis.length === 0 ? (
        <p className="vazio" style={{ margin: 0 }}>
          {inspecaoId ? "Nenhum RDO cobre esta inspeção ainda." : "Nenhum RDO neste projeto."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visiveis.map((r) => {
            const emDia = arquivoEmDia(r);
            const nomes = nomesCobertos(r);
            return (
              <div key={r.id} className="linha-item" style={{ borderLeft: "3px solid var(--borda)", paddingLeft: 12, marginTop: 0 }}>
                <div className="linha-texto">
                  <div style={{ color: "var(--texto)" }}>
                    <strong>RDO nº {numeroRdo(r.numero)}</strong> · {dataBr(r.data)}
                  </div>
                  <div className="detalhe" style={{ margin: 0 }}>
                    {nomes || `${r.inspecoes.length} inspeç${r.inspecoes.length === 1 ? "ão" : "ões"}`}
                    {" · "}{r.dados.atividades.length} atividade{r.dados.atividades.length === 1 ? "" : "s"}
                    {r.autor?.nome_completo ? ` · por ${r.autor.nome_completo}` : ""}
                  </div>
                  {!emDia && (
                    <div className="detalhe" style={{ margin: 0, color: "#92400e", fontWeight: 600 }}>
                      {r.arquivo_path ? "Arquivo desatualizado — gere de novo." : "Arquivo ainda não gerado."}
                    </div>
                  )}
                </div>
                <span className="linha-acoes">
                  {r.arquivo_path && (
                    <a className="btn-dl btn-sec" href={`/api/rdos/${r.id}/download`} target="_blank" rel="noopener noreferrer">Baixar</a>
                  )}
                  {podeEditar && !somenteLeitura && (
                    <>
                      {!emDia && (
                        <button className="btn-dl" disabled={ocupado === r.id} onClick={() => gerarArquivo(r)}>
                          {ocupado === r.id ? "Gerando…" : "Gerar arquivo"}
                        </button>
                      )}
                      <button className="btn-dl btn-sec" disabled={ocupado === r.id} onClick={() => abrirEdicao(r)}>Editar</button>
                      <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                        disabled={ocupado === r.id} onClick={() => excluir(r)}>Excluir</button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {inspecaoId && rdos.length > visiveis.length && (
        <p className="detalhe" style={{ margin: "8px 0 0" }}>
          O projeto tem {rdos.length} RDO{rdos.length === 1 ? "" : "s"} no total (os demais cobrem outras inspeções).
        </p>
      )}
    </>
  );

  return (
    <>
      {embutido ? lista : (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>RDOs — Registro Diário de Operação ({visiveis.length})</h3>
          {lista}
        </div>
      )}

      {form && (
        <Modal titulo={form.novo ? "📋 Novo RDO" : `📋 RDO nº ${numeroRdo(form.numero || 0)}`} largo onFechar={fechar}>
          <div className="rdo-form">
            {preenchendo && <p className="detalhe" style={{ margin: 0 }}>Buscando equipe, equipamentos e cloro já registrados…</p>}

            {/* 1. Cabeçalho */}
            <section className="rdo-bloco">
              <h4>Cabeçalho</h4>
              <div className="rdo-grade">
                <div><span style={rotulo}>Código do projeto</span><input style={campo} value={dados.codigoProjeto} readOnly /></div>
                <div><span style={rotulo}>Cliente</span><input style={campo} value={dados.cliente} readOnly /></div>
                <div><span style={rotulo}>Contratada</span><input style={campo} value={CONTRATADA} readOnly /></div>
                <div>
                  <label style={rotulo} htmlFor="rdo-data">Data</label>
                  <input id="rdo-data" type="date" style={campo} value={data} onChange={(e) => setData(e.target.value)} />
                </div>
                <div>
                  <label style={rotulo} htmlFor="rdo-resp">Responsável (cliente)</label>
                  <input id="rdo-resp" style={campo} value={dados.responsavel} onChange={(e) => mudar({ responsavel: e.target.value })} />
                </div>
                <div>
                  <label style={rotulo} htmlFor="rdo-desc">Projeto (descrição do serviço)</label>
                  <input id="rdo-desc" style={campo} value={dados.descricao} placeholder="Ex.: Limpeza em Tanque de água potável (VRO)"
                    onChange={(e) => mudar({ descricao: e.target.value })} />
                </div>
              </div>
              {doMesmoDia && (
                <div className="rdo-aviso">
                  Já existe o RDO nº {numeroRdo(doMesmoDia.numero)} neste dia — é um RDO por dia no projeto.
                  {" "}<button type="button" className="secao-link" onClick={() => abrirEdicao(doMesmoDia, inspecaoId)}>
                    Abrir esse RDO{inspecaoId && !doMesmoDia.inspecoes.includes(inspecaoId) ? " e incluir esta inspeção" : ""}
                  </button>
                </div>
              )}
              <fieldset className="rdo-cobertura">
                <legend style={rotulo}>Inspeções cobertas</legend>
                {inspecoesProjeto.length === 0 ? (
                  <p className="detalhe" style={{ margin: 0 }}>{cobertas.length} inspeção(ões) marcada(s).</p>
                ) : inspecoesProjeto.map((i) => {
                  const cedo = i.fase < 6 && !cobertas.includes(i.id);
                  return (
                    <label key={i.id} className="rdo-check" style={{ opacity: cedo ? 0.55 : 1 }}>
                      <input type="checkbox" checked={cobertas.includes(i.id)} disabled={cedo}
                        onChange={() => alternarCobertura(i.id)} />
                      <span>{i.identificacao}{cedo ? ` — fase ${i.fase}, ainda não está na execução` : ""}</span>
                    </label>
                  );
                })}
              </fieldset>
            </section>

            {/* 2. Equipe */}
            <section className="rdo-bloco">
              <div className="rdo-bloco-topo">
                <h4>Equipe</h4>
                <button type="button" className="secao-link"
                  onClick={() => { const eq = equipeSugerida(fontes, cobertas, data); if (eq.length) mudar({ equipe: eq }); else alert("Nenhum agendamento de execução com equipe para estas inspeções."); }}>
                  ↻ Puxar do agendamento
                </button>
              </div>
              <datalist id="rdo-funcoes">{FUNCOES_RDO.map((f) => <option key={f} value={f} />)}</datalist>
              {dados.equipe.map((m, i) => (
                <div key={i} className="rdo-membro">
                  <input style={campo} aria-label={`Nome ${i + 1}`} placeholder="Nome" value={m.nome}
                    onChange={(e) => mudar({ equipe: dados.equipe.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)) })} />
                  <input style={campo} aria-label={`Função ${i + 1}`} placeholder="Função" list="rdo-funcoes" value={m.funcao}
                    onChange={(e) => mudar({ equipe: dados.equipe.map((x, k) => (k === i ? { ...x, funcao: e.target.value } : x)) })} />
                  <button type="button" className="rdo-icone" title="Remover da equipe" aria-label={`Remover ${m.nome || "pessoa"}`}
                    onClick={() => mudar({ equipe: dados.equipe.filter((_, k) => k !== i) })}>✕</button>
                </div>
              ))}
              <button type="button" className="btn-azul btn-sec rdo-add"
                onClick={() => mudar({ equipe: [...dados.equipe, { nome: "", funcao: "" }] })}>+ Pessoa</button>
            </section>

            {/* 3. Tempo + 4. Equipamentos */}
            <section className="rdo-bloco">
              <h4>Condições do tempo</h4>
              <p className="detalhe" style={{ marginTop: 0 }}>Deixe “—” no período em que não houve operação.</p>
              {PERIODOS.map((p) => (
                <div key={p.id} className="rdo-tempo" role="group" aria-label={p.rotulo}>
                  <span className="rdo-tempo-rotulo">{p.rotulo}</span>
                  <div className="rdo-seg">
                    {([null, ...OPCOES_TEMPO.map((o) => o.id)] as (Tempo | null)[]).map((t) => (
                      <button key={t || "nada"} type="button" aria-pressed={dados.tempo[p.id] === t}
                        onClick={() => setDados((d) => ({ ...d, tempo: { ...d.tempo, [p.id]: t } }))}>
                        {t ? OPCOES_TEMPO.find((o) => o.id === t)!.rotulo : "—"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="rdo-bloco-topo" style={{ marginTop: 14 }}>
                <label style={{ ...rotulo, marginBottom: 0 }} htmlFor="rdo-equip">Equipamentos utilizados</label>
                <button type="button" className="secao-link"
                  onClick={() => { const t = equipamentosSugeridos(fontes, cobertas); if (t) mudar({ equipamentos: t }); else alert("Nenhum checklist de execução ou equipamento previsto no procedimento."); }}>
                  ↻ Puxar do checklist
                </button>
              </div>
              <textarea id="rdo-equip" rows={3} style={{ ...campo, resize: "vertical" }} value={dados.equipamentos}
                onChange={(e) => mudar({ equipamentos: e.target.value })} />
            </section>

            {/* 5. Atividades */}
            <section className="rdo-bloco">
              <div className="rdo-bloco-topo">
                <h4>Detalhamento dos serviços realizados</h4>
                {dados.atividades.length > 1 && (
                  <button type="button" className="secao-link" onClick={() => mudar({ atividades: ordenarAtividades(dados.atividades) })}>
                    Ordenar por horário
                  </button>
                )}
              </div>
              <p className="detalhe" style={{ marginTop: 0 }}>Toque numa frase para incluir a atividade; ajuste o horário e o texto.</p>
              <div className="rdo-chips">
                {FRASES_RAPIDAS.map((f, i) => (
                  <button key={f.rotulo} type="button" className="rdo-chip" title={textoDaFrase(f, dados.cliente)} onClick={() => inserirFrase(i)}>
                    + {f.rotulo}
                  </button>
                ))}
                <button type="button" className="rdo-chip"
                  onClick={() => setDados((d) => ({ ...d, atividades: [...d.atividades, { inicio: proximaHora(d), texto: "", momento: null, cloro: null }] }))}>
                  + Em branco
                </button>
              </div>
              {dados.atividades.map((a, i) => {
                const sug = a.momento ? cloroSugerido(a.momento) : null;
                return (
                  <div key={i} className="rdo-atividade">
                    <div className="rdo-atividade-topo">
                      <strong className="rdo-num">{numeroLinha(i)}</strong>
                      <label className="rdo-hora">
                        <span>Início</span>
                        <input type="time" style={campo} value={a.inicio} onChange={(e) => mudarAtividade(i, { inicio: e.target.value })} />
                      </label>
                      <label className="rdo-hora">
                        <span>Fim (opcional)</span>
                        <input type="time" style={campo} value={a.fim || ""} onChange={(e) => mudarAtividade(i, { fim: e.target.value || undefined })} />
                      </label>
                      <span className="rdo-atividade-acoes">
                        <button type="button" className="rdo-icone" title="Subir" aria-label={`Subir atividade ${numeroLinha(i)}`} disabled={i === 0} onClick={() => moverAtividade(i, -1)}>↑</button>
                        <button type="button" className="rdo-icone" title="Descer" aria-label={`Descer atividade ${numeroLinha(i)}`} disabled={i === dados.atividades.length - 1} onClick={() => moverAtividade(i, 1)}>↓</button>
                        <button type="button" className="rdo-icone" title="Remover" aria-label={`Remover atividade ${numeroLinha(i)}`}
                          onClick={() => mudar({ atividades: dados.atividades.filter((_, k) => k !== i) })}>✕</button>
                      </span>
                    </div>
                    <textarea rows={2} style={{ ...campo, resize: "vertical" }} aria-label={`Texto da atividade ${numeroLinha(i)}`}
                      value={a.texto} onChange={(e) => mudarAtividade(i, { texto: e.target.value })} />
                    <div className="rdo-agua">
                      <label>
                        <span>Amostra de água</span>
                        <select style={campo} value={a.momento || ""}
                          onChange={(e) => {
                            const m = (e.target.value || null) as AtividadeRdo["momento"];
                            const s = m ? cloroSugerido(m) : null;
                            mudarAtividade(i, { momento: m, cloro: m ? (a.cloro ?? s?.valor ?? null) : null });
                          }}>
                          <option value="">Não é coleta</option>
                          <option value="antes">Coleta antes da limpeza</option>
                          <option value="depois">Coleta após a limpeza</option>
                        </select>
                      </label>
                      {a.momento && (
                        <label>
                          <span>Cloro livre (PPM)</span>
                          <input inputMode="decimal" style={campo} placeholder="0,00"
                            defaultValue={a.cloro != null ? numeroBr(a.cloro) : ""}
                            key={`cloro-${i}-${a.cloro ?? "x"}`}
                            onBlur={(e) => { const n = lerNumero(e.target.value); mudarAtividade(i, { cloro: n != null && n >= 0 ? n : null }); }} />
                        </label>
                      )}
                    </div>
                    {a.momento && sug && sug.valor !== a.cloro && (
                      <p className="detalhe" style={{ margin: 0 }}>
                        Coleta de fotos ({sug.de}): {numeroBr(sug.valor)} PPM.{" "}
                        <button type="button" className="secao-link" onClick={() => mudarAtividade(i, { cloro: sug.valor })}>Usar este valor</button>
                      </p>
                    )}
                    {horaValida(a.inicio) && semFraseCloro(a.texto) ? (
                      <p className="detalhe rdo-previa" style={{ margin: 0 }}>No documento: {numeroLinha(i)} · {textoAtividade(a)}</p>
                    ) : a.cloro != null && (
                      <p className="detalhe rdo-previa" style={{ margin: 0 }}>Frase gerada: {fraseCloro(a.cloro)}</p>
                    )}
                  </div>
                );
              })}
            </section>

            {/* 6 e 7. Fiscalização e DDSMS */}
            {([["fiscalizacao", "Observação da fiscalização"], ["ddsms", "Anotações de DDSMS"]] as const).map(([chave, titulo]) => (
              <section key={chave} className="rdo-bloco">
                <h4>{titulo}</h4>
                {dados[chave].length === 0 && <p className="detalhe" style={{ marginTop: 0 }}>Sem anotações — sai a linha 01 em branco.</p>}
                {dados[chave].map((t, i) => (
                  <div key={i} className="rdo-membro rdo-nota">
                    <strong className="rdo-num">{numeroLinha(i)}</strong>
                    <textarea rows={2} style={{ ...campo, resize: "vertical" }} aria-label={`${titulo} ${numeroLinha(i)}`} value={t}
                      onChange={(e) => mudar({ [chave]: dados[chave].map((x, k) => (k === i ? e.target.value : x)) } as Partial<DadosRdo>)} />
                    <button type="button" className="rdo-icone" title="Remover" aria-label={`Remover ${titulo} ${numeroLinha(i)}`}
                      onClick={() => mudar({ [chave]: dados[chave].filter((_, k) => k !== i) } as Partial<DadosRdo>)}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn-azul btn-sec rdo-add"
                  onClick={() => mudar({ [chave]: [...dados[chave], ""] } as Partial<DadosRdo>)}>+ Anotação</button>
              </section>
            ))}

            {/* 8. Assinaturas */}
            <section className="rdo-bloco">
              <h4>Assinaturas</h4>
              <div className="rdo-grade">
                <div>
                  <label style={rotulo} htmlFor="rdo-ass-asp">Profissional ASP</label>
                  <select id="rdo-ass-asp" style={campo} value={dados.assinaturaAsp.nome}
                    onChange={(e) => {
                      const m = dados.equipe.find((x) => x.nome.trim() === e.target.value);
                      mudar({ assinaturaAsp: { nome: e.target.value, cargo: m?.funcao.trim() || dados.assinaturaAsp.cargo } });
                    }}>
                    <option value="">— escolha alguém da equipe —</option>
                    {dados.equipe.filter((m) => m.nome.trim()).map((m, i) => <option key={i} value={m.nome.trim()}>{m.nome.trim()}</option>)}
                    {dados.assinaturaAsp.nome && !dados.equipe.some((m) => m.nome.trim() === dados.assinaturaAsp.nome) && (
                      <option value={dados.assinaturaAsp.nome}>{dados.assinaturaAsp.nome} (fora da equipe)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label style={rotulo} htmlFor="rdo-ass-asp-cargo">Cargo (ASP)</label>
                  <input id="rdo-ass-asp-cargo" style={campo} list="rdo-funcoes" value={dados.assinaturaAsp.cargo}
                    onChange={(e) => mudar({ assinaturaAsp: { ...dados.assinaturaAsp, cargo: e.target.value } })} />
                </div>
                <div>
                  <label style={rotulo} htmlFor="rdo-ass-cli">Cliente — nome</label>
                  <input id="rdo-ass-cli" style={campo} value={dados.assinaturaCliente.nome}
                    onChange={(e) => mudar({ assinaturaCliente: { ...dados.assinaturaCliente, nome: e.target.value } })} />
                </div>
                <div>
                  <label style={rotulo} htmlFor="rdo-ass-cli-cargo">Cliente — cargo</label>
                  <input id="rdo-ass-cli-cargo" style={campo} value={dados.assinaturaCliente.cargo}
                    onChange={(e) => mudar({ assinaturaCliente: { ...dados.assinaturaCliente, cargo: e.target.value } })} />
                </div>
              </div>
            </section>

            {(validacao.erros.length > 0 || validacao.avisos.length > 0) && (
              <div className="rdo-pendencias">
                <button type="button" className="secao-link" aria-expanded={mostrarAvisos} onClick={() => setMostrarAvisos((v) => !v)}>
                  {validacao.erros.length > 0 ? `${validacao.erros.length} item(ns) a corrigir` : "Tudo certo para gerar"}
                  {validacao.avisos.length > 0 ? ` · ${validacao.avisos.length} aviso(s)` : ""} {mostrarAvisos ? "▴" : "▾"}
                </button>
                {mostrarAvisos && (
                  <ul>
                    {validacao.erros.map((t) => <li key={t} className="erro-texto">{t}</li>)}
                    {validacao.avisos.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                )}
              </div>
            )}
            {erroForm && <p className="erro-texto" style={{ margin: 0, whiteSpace: "pre-line" }}>{erroForm}</p>}

            <div className="rdo-rodape">
              <button type="button" className="btn-azul btn-sec" onClick={fechar} disabled={!!salvando}>Cancelar</button>
              <button type="button" className="btn-azul btn-sec" onClick={() => salvar(false)} disabled={!!salvando}>
                {salvando === "salvar" ? "Salvando…" : "Salvar"}
              </button>
              <button type="button" className="btn-azul" onClick={() => salvar(true)} disabled={!!salvando}>
                {salvando === "gerar" ? "Gerando…" : "Salvar e gerar .docx"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
