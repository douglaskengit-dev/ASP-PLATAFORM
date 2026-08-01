"use client";

/** ASP — Detalhe da Inspeção: barra de progresso das fases (2..10), ações
 * conforme o perfil (avançar / aprovar / reprovar-"Ajustar"), coleta (medidor
 * de sedimento), agendamento (checklist jsonb), relatórios versionados e
 * histórico de autenticação. As fases correm por inspeção. Ver COWORK-ASP §2. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Modal from "@/app/components/Modal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { acoesDisponiveis, definicaoFase, descreverAcaoFase, tituloFase, ULTIMA_FASE, OpcaoAcao } from "@/lib/asp/fases";
import { enviarJson, enviarArquivo } from "@/lib/pwa/sync";
import { lerArquivoParaMatriz, extrairBatimetria, montarEstadoMedidor, gerarModeloXlsx } from "@/lib/asp/batimetria";
import EntradaBatimetria from "@/app/components/EntradaBatimetria";
import GerarRelatorio from "@/app/components/GerarRelatorio";

interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco: string | null;
  cliente: { razao_social: string } | null;
}
interface Inspecao {
  id: string;
  identificacao: string;
  fase: number;
  ferramenta_coleta: string;
  status_relatorio_inspecao: string;
  status_relatorio_execucao: string;
  projeto: Projeto | null;
}
interface Historico {
  id: string;
  fase_de: number;
  fase_para: number;
  acao: string;
  motivo: string | null;
  data_autenticacao: string | null;
  criado_em: string;
  autor_perfil: { nome_completo: string | null; email: string | null } | null;
}
interface Coleta { id: string; tipo: string; pdf_path: string | null; dados: any; criado_em: string }
interface Relatorio { id: string; tipo: string; versao: number; status: string; motivo_ajuste: string | null; enviado_em: string | null }
interface MembroEquipe { id: string; nome: string }
interface Agendamento {
  id: string; tipo: string; data_visita: string | null; data_execucao: string | null; hora: string | null;
  equipe: MembroEquipe[]; equipamentos: string[]; checklist: { item: string; ok?: boolean }[];
  criado_em: string;
}
interface UsuarioOpcao { id: string; nome: string; perfil: string; funcao: string | null }

// Fase 1 é nível-projeto (abertura); as demais correm na inspeção.
const TODAS_FASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
function nomeFase(n: number) {
  return n === 1 ? "Abertura do Projeto" : tituloFase(n);
}

// Ferramentas de coleta: só o medidor de sedimento está ativo (COWORK-ASP §2.5).
const FERRAMENTAS_FUTURAS = ["Ultrassom", "Drone", "MFL"];
// Itens iniciais do checklist de campo (extensível) — COWORK-ASP §3.2.
const CHECKLIST_PADRAO = ["NR-33 (espaço confinado)", "NR-10 (elétrica)", "EPIs", "Permissão de Trabalho (PT)"];

// Botões compactos da barra de Coletas (cabem melhor no card).
const btnColeta: React.CSSProperties = { padding: "5px 9px", fontSize: 12, lineHeight: 1.2 };

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};

export default function InspecaoDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [insp, setInsp] = useState<Inspecao | null>(null);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [coletas, setColetas] = useState<Coleta[]>([]);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [perfil, setPerfil] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [reprovar, setReprovar] = useState<OpcaoAcao | null>(null);
  const [motivo, setMotivo] = useState("");

  // Coleta
  const [modalMedidor, setModalMedidor] = useState(false);
  const [enviandoColeta, setEnviandoColeta] = useState(false);
  const coletaInputRef = useRef<HTMLInputElement>(null);
  // Medidor: salvar/editar medição (registro editável = Relatório Técnico interno)
  const medidorRef = useRef<HTMLIFrameElement>(null);
  const [coletaEditando, setColetaEditando] = useState<string | null>(null);
  const editandoRef = useRef<string | null>(null);
  const dadosCarregarRef = useRef<any>(null);
  const [salvandoMedicao, setSalvandoMedicao] = useState(false);
  // Importação de batimetria (CSV/XLSX no layout da planilha)
  const [modalImport, setModalImport] = useState(false);
  const [impDiametro, setImpDiametro] = useState("");
  const [impAltura, setImpAltura] = useState("");
  const [excluindoColeta, setExcluindoColeta] = useState<string | null>(null);
  const [impFormato, setImpFormato] = useState<"circulo" | "quadrado" | "retangulo" | "ngon" | "custom">("circulo");
  const [impLargura, setImpLargura] = useState("");
  const [impLados, setImpLados] = useState("6");
  const [impVertices, setImpVertices] = useState("");
  const [impUnidade, setImpUnidade] = useState<"m" | "cm">("m");
  const [impArquivo, setImpArquivo] = useState<File | null>(null);
  const [importando, setImportando] = useState(false);
  const [impErro, setImpErro] = useState<string | null>(null);
  const [modalEntrada, setModalEntrada] = useState(false);
  const [modalModelo, setModalModelo] = useState(false);
  const [modN, setModN] = useState("5");
  const [modM, setModM] = useState("11");
  const [gerandoModelo, setGerandoModelo] = useState(false);
  // Relatório
  const [enviandoRelatorio, setEnviandoRelatorio] = useState(false);
  const [modalRelatorio, setModalRelatorio] = useState(false);
  const relatorioInputRef = useRef<HTMLInputElement>(null);
  // Agendamento
  const [modalAgenda, setModalAgenda] = useState(false);
  const [agendaEditando, setAgendaEditando] = useState<string | null>(null);
  const [agData, setAgData] = useState("");
  const [agDataExec, setAgDataExec] = useState("");
  const [agHora, setAgHora] = useState("");
  const [agEquipeIds, setAgEquipeIds] = useState<string[]>([]);
  const [agEquipamentos, setAgEquipamentos] = useState<string[]>([]);
  const [agEquipInput, setAgEquipInput] = useState("");
  const [agChecklist, setAgChecklist] = useState<{ item: string; ok: boolean }[]>([]);
  const [agNovoItem, setAgNovoItem] = useState("");
  const [salvandoAgenda, setSalvandoAgenda] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioOpcao[]>([]);

  const carregar = useCallback(() => {
    fetch(`/api/inspecoes/${id}`)
      .then(async (r) => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        if (r.status === 404) { setNaoEncontrado(true); return; }
        const d = await r.json();
        setInsp(d.inspecao);
        setHistorico(d.historico || []);
        setColetas(d.coletas || []);
        setRelatorios(d.relatorios || []);
        setAgendamentos(d.agendamentos || []);
      })
      .finally(() => setCarregando(false));
  }, [id]);

  useEffect(() => {
    carregar();
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase.from("gp_profiles").select("perfil").eq("id", data.user.id).single();
      setPerfil(p?.perfil ?? null);
    });
    fetch("/api/usuarios").then((r) => r.ok ? r.json() : { usuarios: [] }).then((d) => setUsuarios(d.usuarios || [])).catch(() => {});
  }, [carregar]);

  const acoes = useMemo(() => (insp ? acoesDisponiveis(perfil, insp.fase) : []), [insp, perfil]);

  /** Pré-preenchimento do relatório: puxa o que o sistema já sabe — projeto,
   *  cliente, última medição salva (volume, altura, diâmetro) e a equipe do
   *  agendamento. O usuário revisa tudo no formulário antes de gerar. */
  const dadosIniciaisRelatorio = useMemo(() => {
    const proj = insp?.projeto;
    const medicao = coletas.find((c) => c.dados && Object.keys(c.dados).length > 0)?.dados as any;
    const res = medicao?.resultado;
    const un = medicao?.unit === "cm" ? "cm" : "m";
    const num = (v: any, casas = 2) =>
      v == null || isNaN(Number(v)) ? "" : Number(v).toFixed(casas).replace(".", ",");
    // A data de execução vem do agendamento do MESMO tipo do relatório:
    // até a fase 5 o relatório é de inspeção; a partir daí, de execução.
    const tipoRelatorio: "inspecao" | "execucao" = insp && insp.fase > 5 ? "execucao" : "inspecao";
    const ag = agendamentos.find((a) => a.tipo === tipoRelatorio) || agendamentos[0];
    const dataServico = tipoRelatorio === "execucao"
      ? (ag?.data_execucao || ag?.data_visita)
      : (ag?.data_visita || ag?.data_execucao);
    const hoje = new Date().toLocaleDateString("pt-BR");
    // Revisão: começa em 0 e incrementa a cada reprovação ("Ajustar") já
    // registrada nos relatórios desta inspeção.
    const reprovacoes = relatorios.filter((r) => r.status === "ajustar").length;
    return {
      titulo: insp ? `Batimetria — ${insp.identificacao}` : "",
      cliente: proj?.cliente?.razao_social || "",
      endereco: proj?.endereco || "",
      revisao: String(reprovacoes),
      dataRevisao: hoje,
      // Campo "Relatório" da capa segue o padrão do modelo: "37/MG/26 Rev1".
      codigoProjeto: proj?.codigo_projeto || proj?.pedido_compra || "",
      relatorioCodigo: (proj?.codigo_projeto || proj?.pedido_compra)
        ? `${proj?.codigo_projeto || proj?.pedido_compra} Rev${reprovacoes}`
        : "",
      dataExecucao: formatarData(dataServico) || "",
      dataRelatorio: hoje,
      tag: insp?.identificacao || "",
      alturaTanque: medicao?.height ? `${num(medicao.height)} ${un}` : "",
      diametro: medicao?.dimValue ? `${num(medicao.dimValue)} ${un}` : "",
      // Capacidade nominal é dado de placa (manual). Aqui vai o volume
      // calculado do tanque, que alimenta o quadro do tópico 6.
      capacidadeTanque: res?.volTankM3 ? `${num(res.volTankM3)} m³` : "",
      volumeSedimento: res?.volSedM3 != null ? `${num(res.volSedM3, 3)} m³` : "",
      // Faixa de ±5% sobre o volume medido (texto do tópico 7).
      volumeMin: res?.volSedM3 != null ? num(res.volSedM3 * 0.95, 2) : "",
      volumeMax: res?.volSedM3 != null ? num(res.volSedM3 * 1.05, 2) : "",
      equipe: (ag?.equipe || []).map((m) => m.nome).join(", "),
    };
  }, [insp, coletas, agendamentos, relatorios]);
  const bloco: "inspecao" | "execucao" = insp && insp.fase > 5 ? "execucao" : "inspecao";
  const podeColeta = ["admin", "operacoes", "gerencia"].includes(perfil || "");
  const podeAgenda = ["admin", "comercial", "gerencia"].includes(perfil || "");
  const podeRelatorio = ["admin", "operacoes", "gerencia"].includes(perfil || "");

  async function aplicar(acao: string, motivoTexto?: string) {
    setErro(null);
    setProcessando(true);
    try {
      const res = await enviarJson(`/api/inspecoes/${id}/fase`, "POST", { acao, motivo: motivoTexto }, "Ação de fase");
      if (res.queued) { setReprovar(null); setMotivo(""); alert("Sem conexão — ação salva offline e aplicada ao reconectar."); return; }
      if (!res.ok) { setErro(res.data?.erro || "Não foi possível aplicar a ação."); return; }
      setReprovar(null);
      setMotivo("");
      carregar();
    } finally {
      setProcessando(false);
    }
  }

  function clicarAcao(opcao: OpcaoAcao) {
    if (opcao.exigeMotivo) { setMotivo(""); setReprovar(opcao); }
    else aplicar(opcao.acao);
  }

  async function anexarColeta(arquivo: File) {
    setEnviandoColeta(true);
    setErro(null);
    try {
      const res = await enviarArquivo("/api/coletas", { inspecaoId: id, tipo: "sedimento" }, arquivo, "Coleta (PDF)");
      if (res.queued) { alert("Sem conexão — PDF salvo offline e enviado ao reconectar."); return; }
      if (!res.ok) { setErro(res.data?.erro || "Falha ao anexar a coleta."); return; }
      carregar();
    } finally {
      setEnviandoColeta(false);
      if (coletaInputRef.current) coletaInputRef.current.value = "";
    }
  }

  /** Exclui a medição — vai para a lixeira, recuperável por 30 dias. */
  async function excluirColeta(c: Coleta) {
    const temMedicao = c.dados && Object.keys(c.dados).length > 0;
    const rotulo = temMedicao ? "esta medição (Relatório Técnico interno)" : `este anexo (${c.tipo})`;
    if (!confirm(`Excluir ${rotulo}?\n\nEla sai da lista, mas fica recuperável por 30 dias antes de ser apagada definitivamente.`)) return;
    setExcluindoColeta(c.id);
    setErro(null);
    try {
      const res = await fetch(`/api/coletas/${c.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(data?.erro || "Falha ao excluir a medição."); return; }
      setColetas((prev) => prev.filter((x) => x.id !== c.id));
    } catch {
      setErro("Sem conexão — tente novamente quando estiver online.");
    } finally {
      setExcluindoColeta(null);
    }
  }

  // Salva/atualiza a medição (registro editável = Relatório Técnico interno).
  const salvarMedicao = useCallback(async (dados: any) => {
    setSalvandoMedicao(true);
    setErro(null);
    try {
      const editId = editandoRef.current;
      const res = await enviarJson(
        editId ? `/api/coletas/${editId}` : "/api/coletas",
        editId ? "PATCH" : "POST",
        editId ? { dados } : { inspecaoId: id, tipo: "sedimento", dados },
        "Coleta / medição"
      );
      if (!res.queued && !res.ok) { setErro(res.data?.erro || "Falha ao salvar a medição."); return; }
      setModalMedidor(false);
      setColetaEditando(null); editandoRef.current = null; dadosCarregarRef.current = null;
      if (res.queued) alert("Sem conexão — medição salva offline e enviada ao reconectar.");
      else carregar();
    } finally {
      setSalvandoMedicao(false);
    }
  }, [id, carregar]);

  // Ponte com o iframe do medidor: recebe o snapshot ao salvar e envia os
  // dados salvos ao abrir (asp:ready) para editar.
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const msg = (ev.data || {}) as { type?: string; dados?: any };
      if (msg.type === "asp:ready") {
        if (dadosCarregarRef.current && medidorRef.current?.contentWindow) {
          medidorRef.current.contentWindow.postMessage({ type: "asp:load", dados: dadosCarregarRef.current }, "*");
        }
      } else if (msg.type === "asp:save") {
        salvarMedicao(msg.dados);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [salvarMedicao]);

  function abrirMedidorNovo() {
    setColetaEditando(null); editandoRef.current = null; dadosCarregarRef.current = null;
    setErro(null); setModalMedidor(true);
  }
  function abrirMedidorEdicao(c: Coleta) {
    setColetaEditando(c.id); editandoRef.current = c.id; dadosCarregarRef.current = c.dados || null;
    setErro(null); setModalMedidor(true);
  }
  function pedirSalvarMedicao() {
    medidorRef.current?.contentWindow?.postMessage({ type: "asp:requestSave" }, "*");
  }

  function carregarNoMedidor(estado: Record<string, unknown>) {
    if (modalMedidor) {
      medidorRef.current?.contentWindow?.postMessage({ type: "asp:load", dados: estado }, "*");
    } else {
      dadosCarregarRef.current = estado;
      setColetaEditando(null); editandoRef.current = null;
      setModalMedidor(true);
    }
  }
  function abrirImport() {
    setImpDiametro(""); setImpAltura(""); setImpUnidade("m"); setImpArquivo(null); setImpErro(null);
    setModalImport(true);
  }
  async function baixarModelo() {
    const N = Math.max(1, Math.min(24, parseInt(modN, 10) || 1));
    const M = Math.max(1, Math.min(60, parseInt(modM, 10) || 1));
    setGerandoModelo(true);
    try {
      const blob = await gerarModeloXlsx(N, M);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelo-batimetria-${N}vetores-${M}pontos.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setModalModelo(false);
    } finally {
      setGerandoModelo(false);
    }
  }
  async function importarBatimetria() {
    setImpErro(null);
    if (!impArquivo) { setImpErro("Selecione o arquivo (CSV ou XLSX)."); return; }
    const diam = parseFloat((impDiametro || "").replace(",", "."));
    const ehRetangular = impFormato === "quadrado" || impFormato === "retangulo";
    if (!diam || diam <= 0) {
      setImpErro(ehRetangular ? "Informe o comprimento do tanque (m)." : "Informe o diâmetro do tanque (m).");
      return;
    }
    const larg = parseFloat((impLargura || "").replace(",", "."));
    if (impFormato === "retangulo" && (!larg || larg <= 0)) { setImpErro("Informe a largura do tanque (m)."); return; }
    if (impFormato === "custom" && !(impVertices || "").trim()) { setImpErro("Informe os vértices do tanque (x,y; x,y; …)."); return; }
    setImportando(true);
    try {
      const rows = await lerArquivoParaMatriz(impArquivo);
      const dados = extrairBatimetria(rows);
      const alertas: string[] = [];
      if (dados.invalidos > 0) {
        alertas.push(`${dados.invalidos} de ${dados.totalValidacao} leituras estão INCORRETO na validação (régua × sonar).`);
      }
      if (dados.negativos > 0) {
        alertas.push(`${dados.negativos} leitura(s) com espessura negativa (sonar corrigido maior que a régua corrigida) — essas ficarão FORA do cálculo.`);
      }
      if (alertas.length > 0) {
        const ok = confirm(`Atenção:\n\n• ${alertas.join("\n• ")}\n\nImportar mesmo assim?`);
        if (!ok) { setImportando(false); return; }
      }
      const maxVal = Math.max(0, ...dados.valores.flat().map((v) => (typeof v === "number" ? v : 0)));
      const alturaInput = parseFloat((impAltura || "").replace(",", "."));
      const altura = alturaInput > 0 ? alturaInput : (dados.alturaSugerida && dados.alturaSugerida > 0 ? dados.alturaSugerida : maxVal + 0.5);
      const estado = montarEstadoMedidor(dados, {
        diametro: diam, altura, unidade: impUnidade,
        tanque: {
          formato: impFormato,
          largura: impFormato === "retangulo" ? larg : null,
          ngonLados: impFormato === "ngon" ? (parseInt(impLados, 10) || 6) : 6,
          vertices: impFormato === "custom" ? impVertices.trim() : "",
        },
      });
      setModalImport(false);
      carregarNoMedidor(estado);
    } catch (e) {
      setImpErro(e instanceof Error ? e.message : "Falha ao importar o arquivo.");
    } finally {
      setImportando(false);
    }
  }

  async function enviarRelatorio(arquivo: File) {
    setEnviandoRelatorio(true);
    setErro(null);
    try {
      const res = await enviarArquivo("/api/relatorios", { inspecaoId: id, tipo: bloco }, arquivo, "Relatório");
      if (res.queued) { alert("Sem conexão — relatório salvo offline e enviado ao reconectar."); return; }
      if (!res.ok) { setErro(res.data?.erro || "Falha ao enviar o relatório."); return; }
      carregar();
    } finally {
      setEnviandoRelatorio(false);
      if (relatorioInputRef.current) relatorioInputRef.current.value = "";
    }
  }

  function abrirAgenda() {
    setAgendaEditando(null);
    setAgData(""); setAgHora(""); setAgDataExec("");
    setAgEquipeIds([]); setAgEquipamentos([]); setAgEquipInput("");
    setAgChecklist(CHECKLIST_PADRAO.map((item) => ({ item, ok: false })));
    setAgNovoItem("");
    setErro(null);
    setModalAgenda(true);
  }

  function abrirAgendaEdicao(a: Agendamento) {
    setAgendaEditando(a.id);
    setAgData(a.data_visita || ""); setAgHora(a.hora || ""); setAgDataExec(a.data_execucao || "");
    setAgEquipeIds((a.equipe || []).map((m) => m.id));
    setAgEquipamentos(a.equipamentos || []);
    setAgEquipInput("");
    setAgChecklist((a.checklist || []).map((c) => ({ item: c.item, ok: !!c.ok })));
    setAgNovoItem("");
    setErro(null);
    setModalAgenda(true);
  }

  async function removerAgenda(a: Agendamento) {
    if (!confirm("Excluir este agendamento?")) return;
    const r = await fetch(`/api/agendamentos/${a.id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json(); setErro(d.erro || "Falha ao excluir."); return; }
    carregar();
  }

  async function salvarAgenda() {
    setErro(null);
    if (!agData) { setErro("Informe a data da visita."); return; }
    setSalvandoAgenda(true);
    try {
      const equipe = usuarios.filter((u) => agEquipeIds.includes(u.id)).map((u) => ({ id: u.id, nome: u.nome }));
      const payload = { dataVisita: agData, dataExecucao: agDataExec || undefined, hora: agHora || undefined, equipe, equipamentos: agEquipamentos, checklist: agChecklist };
      const res = await enviarJson(
        agendaEditando ? `/api/agendamentos/${agendaEditando}` : "/api/agendamentos",
        agendaEditando ? "PATCH" : "POST",
        agendaEditando ? payload : { inspecaoId: id, tipo: bloco, ...payload },
        "Agendamento"
      );
      if (!res.queued && !res.ok) { setErro(res.data?.erro || "Falha ao salvar o agendamento."); return; }
      setModalAgenda(false);
      setAgendaEditando(null);
      if (res.queued) alert("Sem conexão — agendamento salvo offline e enviado ao reconectar.");
      else carregar();
    } finally {
      setSalvandoAgenda(false);
    }
  }

  function toggleEquipe(uid: string) {
    setAgEquipeIds((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  }
  function addEquipamento() {
    const v = agEquipInput.trim();
    if (v && !agEquipamentos.includes(v)) setAgEquipamentos((p) => [...p, v]);
    setAgEquipInput("");
  }

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;
  if (naoEncontrado || !insp)
    return (
      <div className="page-larga">
        <p className="vazio">Inspeção não encontrada.</p>
        <Link href="/projetos" style={{ color: "var(--primaria)" }}>← Voltar aos projetos</Link>
      </div>
    );

  const def = definicaoFase(insp.fase);
  const pct = Math.round(((insp.fase - 1) / (ULTIMA_FASE - 1)) * 100);

  return (
    <div className="page-larga">
      {insp.projeto && (
        <Link href={`/projetos/${insp.projeto.id}`} style={{ color: "var(--primaria)", textDecoration: "none", fontSize: 13 }}>
          ← {insp.projeto.codigo_projeto || insp.projeto.pedido_compra || "Projeto"}
        </Link>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>{insp.identificacao}</h2>
            <p className="detalhe" style={{ marginTop: 4 }}>
              {insp.projeto?.cliente?.razao_social || ""}
              {insp.projeto?.endereco ? ` · ${insp.projeto.endereco}` : ""}
            </p>
          </div>
          <span className={`fu-badge ${def?.bloco === "execucao" ? "manual" : "auto"}`}>
            Fase {insp.fase} · {def?.area || "—"}
          </span>
        </div>

        <div className="fu-progresso" style={{ marginTop: 14 }} title={`Fase ${insp.fase} de ${ULTIMA_FASE}`}>
          <div className="fu-barra" style={{ width: `${pct}%` }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 16 }}>
          {TODAS_FASES.map((n) => {
            const estado = n < insp.fase ? "feita" : n === insp.fase ? "atual" : "futura";
            return (
              <div key={n} className="fase-linha" style={{ opacity: estado === "futura" ? 0.5 : 1 }}>
                <span
                  style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                    background: estado === "feita" ? "#16a34a" : estado === "atual" ? "var(--primaria)" : "var(--track)",
                    color: estado === "futura" ? "var(--cinza)" : "#fff",
                  }}
                >
                  {estado === "feita" ? "✓" : n}
                </span>
                <span className="fase-nome" style={{ fontWeight: estado === "atual" ? 700 : 500, color: "var(--texto)" }}>
                  {nomeFase(n)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Ações desta fase</h3>
        {acoes.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>
            {insp.fase >= ULTIMA_FASE ? "Inspeção encerrada." : "Nenhuma ação disponível para o seu perfil nesta fase."}
          </p>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {acoes.map((o) => (
              <button key={o.acao} className={`btn-azul ${o.acao === "reprovar" ? "btn-sec" : ""}`} onClick={() => clicarAcao(o)} disabled={processando}>
                {o.rotulo}
              </button>
            ))}
          </div>
        )}
        {erro && <p className="erro-texto" style={{ marginBottom: 0 }}>{erro}</p>}
      </div>

      {/* Coleta (Operações) + Agendamento (Comercial) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Coletas ({coletas.length})</h3>
            {podeColeta && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: "1 1 auto" }}>
                <button className="btn-azul" style={btnColeta} onClick={abrirMedidorNovo}>📐 Nova medição</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={() => setModalEntrada(true)}>✍ Digitar batimetria</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={abrirImport}>⬆ Importar batimetria</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={() => setModalModelo(true)}>⬇ Modelo vazio</button>
                <button className="btn-azul btn-sec" style={btnColeta} onClick={() => coletaInputRef.current?.click()} disabled={enviandoColeta}>
                  {enviandoColeta ? "Enviando…" : "Anexar PDF"}
                </button>
                <input ref={coletaInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) anexarColeta(f); }} />
              </div>
            )}
          </div>
          <p className="detalhe" style={{ marginTop: 6 }}>Medidor de sedimento: a medição vira um Relatório Técnico interno editável.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {FERRAMENTAS_FUTURAS.map((f) => (
              <span key={f} className="fu-badge manual" style={{ opacity: 0.75 }}>{f} · em desenvolvimento</span>
            ))}
          </div>
          {coletas.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhuma coleta registrada.</p>
          ) : (
            coletas.map((c) => {
              const temMedicao = c.dados && Object.keys(c.dados).length > 0;
              return (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span className="detalhe" style={{ margin: 0 }}>
                    {temMedicao ? "📋 Relatório Técnico interno" : `📎 ${c.tipo}`} · {formatar(c.criado_em)}
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {podeColeta && temMedicao && (
                      <button className="btn-dl btn-sec" onClick={() => abrirMedidorEdicao(c)}>Editar</button>
                    )}
                    {c.pdf_path && (
                      <a className="btn-dl btn-sec" href={`/api/coletas/${c.id}/download`} target="_blank" rel="noopener noreferrer">PDF</a>
                    )}
                    {podeColeta && (
                      <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                        title="Excluir medição (lixeira de 30 dias)"
                        disabled={excluindoColeta === c.id} onClick={() => excluirColeta(c)}>
                        {excluindoColeta === c.id ? "Excluindo…" : "Excluir"}
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Agendamentos ({agendamentos.length})</h3>
            {podeAgenda && <button className="btn-azul" onClick={abrirAgenda}>+ Agendar ({bloco})</button>}
          </div>
          {agendamentos.length === 0 ? (
            <p className="vazio" style={{ margin: "8px 0 0" }}>Nenhum agendamento.</p>
          ) : (
            agendamentos.map((a) => (
              <div key={a.id} style={{ borderLeft: "3px solid var(--primaria)", paddingLeft: 12, marginTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div style={{ color: "var(--texto)", fontWeight: 700 }}>
                    📅 {a.data_visita ? formatarData(a.data_visita) : "sem data"}{a.hora ? ` às ${a.hora}` : ""}
                    <span className="detalhe" style={{ margin: "0 0 0 8px", textTransform: "capitalize", fontWeight: 400 }}>({a.tipo})</span>
                  </div>
                  {podeAgenda && (
                    <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className="fu-icone-btn" title="Editar agendamento" onClick={() => abrirAgendaEdicao(a)}>✎</button>
                      <button className="fu-icone-btn lixeira" title="Excluir agendamento" onClick={() => removerAgenda(a)}>🗑</button>
                    </span>
                  )}
                </div>
                {a.data_execucao && <div className="detalhe" style={{ margin: 0 }}>🛠 Execução prevista: {formatarData(a.data_execucao)}</div>}
                {a.equipe?.length > 0 && <div className="detalhe" style={{ margin: 0 }}>Equipe: {a.equipe.map((m) => m.nome).join(", ")}</div>}
                {a.equipamentos?.length > 0 && <div className="detalhe" style={{ margin: 0 }}>Equipamentos: {a.equipamentos.join(", ")}</div>}
                {a.checklist?.length > 0 && (
                  <div className="detalhe" style={{ margin: "2px 0 0" }}>
                    {a.checklist.map((i) => `${i.ok ? "✓" : "✗"} ${i.item}`).join(" · ")}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Relatórios (Operações envia; Gerência aprova nas fases 5/9) */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Relatórios ({relatorios.length})</h3>
          {podeRelatorio && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalRelatorio(true)}>📄 Gerar relatório</button>
              <button className="btn-azul" onClick={() => relatorioInputRef.current?.click()} disabled={enviandoRelatorio}>
                {enviandoRelatorio ? "Enviando…" : `Enviar relatório (${bloco})`}
              </button>
              <input ref={relatorioInputRef} type="file" accept=".pdf,.docx" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarRelatorio(f); }} />
            </div>
          )}
        </div>
        <p className="detalhe" style={{ marginTop: 6 }}>Cada envio gera uma nova versão. Envio manual (PDF/DOCX); a Gerência aprova ou marca “Ajustar”.</p>
        {relatorios.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>Nenhum relatório enviado.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {relatorios.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderLeft: "3px solid var(--borda)", paddingLeft: 12 }}>
                <div>
                  <div style={{ color: "var(--texto)" }}>
                    <strong style={{ textTransform: "capitalize" }}>{r.tipo}</strong> v{r.versao} —{" "}
                    <span style={{ color: corStatus(r.status) }}>{rotuloStatus(r.status)}</span>
                  </div>
                  {r.motivo_ajuste && <div className="detalhe" style={{ margin: 0 }}>Ajuste: {r.motivo_ajuste}</div>}
                  {r.enviado_em && <div className="detalhe" style={{ margin: 0 }}>Enviado em {formatar(r.enviado_em)}</div>}
                </div>
                <a className="btn-dl btn-sec" href={`/api/relatorios/${r.id}/download`} target="_blank" rel="noopener noreferrer">Baixar</a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Histórico de fases</h3>
        {historico.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>Sem movimentações ainda.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {historico.map((h) => (
              <div key={h.id} style={{ borderLeft: "3px solid var(--borda)", paddingLeft: 12 }}>
                <div style={{ fontSize: 14, color: "var(--texto)", fontWeight: 600 }}>
                  {descreverAcaoFase(h.acao, h.fase_de, h.fase_para)}
                </div>
                {h.motivo && <div className="detalhe" style={{ margin: 0 }}>Motivo: {h.motivo}</div>}
                <div className="detalhe" style={{ margin: 0 }}>
                  Por {h.autor_perfil?.nome_completo || h.autor_perfil?.email || "usuário"} · {formatar(h.data_autenticacao || h.criado_em)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: baixar modelo vazio (N vetores × m pontos) */}
      {modalModelo && (
        <Modal titulo="⬇ Baixar modelo de batimetria" onFechar={() => setModalModelo(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Gera uma planilha vazia com a quantidade exata de vetores e pontos, já com as fórmulas
              (ALTURA REAL, Altura sedimento e VALIDAÇÃO). Preencha as leituras e depois use “Importar”.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Vetores</label>
                <input type="number" min={1} max={24} style={inputStyle} value={modN} onChange={(e) => setModN(e.target.value)} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Pontos por vetor</label>
                <input type="number" min={1} max={60} style={inputStyle} value={modM} onChange={(e) => setModM(e.target.value)} />
              </div>
            </div>
            <p className="detalhe" style={{ margin: 0 }}>
              Dica: mantenha a distância entre pontos ≤ 2 m — a quantidade de pontos depende do diâmetro do tanque.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalModelo(false)} disabled={gerandoModelo}>Cancelar</button>
              <button className="btn-azul" onClick={baixarModelo} disabled={gerandoModelo}>{gerandoModelo ? "Gerando…" : "Baixar .xlsx"}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: digitar batimetria (mesma matemática da importação) */}
      {modalEntrada && (
        <EntradaBatimetria
          onFechar={() => setModalEntrada(false)}
          onGerar={(estado) => { setModalEntrada(false); carregarNoMedidor(estado); }}
        />
      )}

      {/* Modal: importar batimetria (CSV/XLSX no layout da planilha) */}
      {modalImport && (
        <Modal titulo="⬆ Importar batimetria" zIndex={200} onFechar={() => setModalImport(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="detalhe" style={{ margin: 0 }}>
              Envie a planilha no layout atual (blocos v1..vN com Esquerda/Centro/Direita e a linha “Altura sedimento”).
              Cada lateral vira um vetor paralelo atravessando o tanque — todas as leituras entram no cálculo.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Formato do tanque</label>
                <select style={inputStyle} value={impFormato} onChange={(e) => setImpFormato(e.target.value as any)}>
                  <option value="circulo">Cilíndrico (círculo)</option>
                  <option value="quadrado">Quadrado</option>
                  <option value="retangulo">Retângulo</option>
                  <option value="ngon">N-ágono (cilindro)</option>
                  <option value="custom">Personalizado (vértices)</option>
                </select>
              </div>
              {impFormato === "retangulo" && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Largura *</label>
                  <input style={inputStyle} value={impLargura} onChange={(e) => setImpLargura(e.target.value)} placeholder="ex.: 4" inputMode="decimal" />
                </div>
              )}
              {impFormato === "ngon" && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Nº de lados</label>
                  <input style={inputStyle} value={impLados} onChange={(e) => setImpLados(e.target.value)} placeholder="6" inputMode="numeric" />
                </div>
              )}
              {impFormato === "custom" && (
                <div>
                  <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Vértices (x,y; …) *</label>
                  <input style={inputStyle} value={impVertices} onChange={(e) => setImpVertices(e.target.value)} placeholder="-3,-2; 3,-2; 3,2; -3,2" />
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>
                  {impFormato === "quadrado" || impFormato === "retangulo" ? "Comprimento (m) *" : "Diâmetro (m) *"}
                </label>
                <input style={inputStyle} value={impDiametro} onChange={(e) => setImpDiametro(e.target.value)} placeholder="ex.: 12" inputMode="decimal" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Altura do tanque</label>
                <input style={inputStyle} value={impAltura} onChange={(e) => setImpAltura(e.target.value)} placeholder="auto (planilha)" inputMode="decimal" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Unidade</label>
                <select style={inputStyle} value={impUnidade} onChange={(e) => setImpUnidade(e.target.value as "m" | "cm")}>
                  <option value="m">metros</option>
                  <option value="cm">centímetros</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Arquivo (CSV ou XLSX)</label>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setImpArquivo(e.target.files?.[0] || null)} />
            </div>
            {impErro && <p className="erro-texto" style={{ margin: 0 }}>{impErro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalImport(false)} disabled={importando}>Cancelar</button>
              <button className="btn-azul" onClick={importarBatimetria} disabled={importando}>{importando ? "Importando…" : "Importar e abrir medidor"}</button>
            </div>
          </div>
        </Modal>
      )}

      {modalRelatorio && (
        <GerarRelatorio
          onFechar={() => setModalRelatorio(false)}
          nomeArquivo={`Relatorio-${(insp?.identificacao || "inspecao").replace(/[^\w-]+/g, "-")}`}
          inicial={dadosIniciaisRelatorio}
          usuarios={usuarios}
          coletas={coletas.filter((c) => c.dados && Object.keys(c.dados).length > 0)}
          onSalvar={async (blob) => {
            const arquivo = new File([blob], `Relatorio-${insp?.identificacao || "inspecao"}.docx`, {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
            await enviarRelatorio(arquivo);
          }}
        />
      )}

      {/* Modal: medidor de sedimento (ferramenta de campo embutida por iframe) */}
      {modalMedidor && (
        <Modal titulo={coletaEditando ? "📐 Editar medição" : "📐 Medidor de Sedimento"}
          onFechar={() => { setModalMedidor(false); setColetaEditando(null); editandoRef.current = null; dadosCarregarRef.current = null; }}
          largo semPadding>
          <div className="medidor-shell">
            <div className="medidor-barra" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--borda)", background: "var(--bg-suave)", flexShrink: 0 }}>
              <span className="detalhe" style={{ margin: 0 }}>
                {coletaEditando ? "Editando o registro salvo." : "A medição é salva como Relatório Técnico interno (editável). Use “Exportar em PDF” dentro da ferramenta para o PDF."}
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="btn-azul btn-sec" onClick={() => setModalEntrada(true)}>✍ Digitar</button>
                <button className="btn-azul btn-sec" onClick={abrirImport}>⬆ Importar</button>
                <button className="btn-azul" onClick={pedirSalvarMedicao} disabled={salvandoMedicao}>
                  {salvandoMedicao ? "Salvando…" : "💾 Salvar medição"}
                </button>
              </span>
            </div>
            <iframe ref={medidorRef} src="/ferramentas/medidor-sedimento-asp.html" title="Medidor de Sedimento"
              style={{ flex: 1, width: "100%", border: "none", display: "block" }} />
          </div>
        </Modal>
      )}

      {/* Modal: agendamento com checklist extensível */}
      {modalAgenda && (
        <Modal titulo={agendaEditando ? `Editar agendamento (${bloco})` : `Agendar ${bloco}`} onFechar={() => { setModalAgenda(false); setAgendaEditando(null); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data da visita *</label>
                <input type="date" style={{ ...inputStyle, borderColor: erro && !agData ? "#dc2626" : "var(--borda)" }} value={agData} onChange={(e) => setAgData(e.target.value)} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Hora</label>
                <input type="time" style={inputStyle} value={agHora} onChange={(e) => setAgHora(e.target.value)} />
              </div>
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data prevista de execução</label>
              <input type="date" style={inputStyle} value={agDataExec} onChange={(e) => setAgDataExec(e.target.value)} />
              <small style={{ color: "var(--cinza)" }}>Opcional — quando já se sabe a data prevista da execução.</small>
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>Equipe (usuários notificados)</label>
              {usuarios.length === 0 ? (
                <p className="detalhe" style={{ margin: 0 }}>Nenhum usuário disponível.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto", border: "1px solid var(--borda)", borderRadius: 8, padding: 8 }}>
                  {usuarios.map((u) => {
                    const sel = agEquipeIds.includes(u.id);
                    return (
                      <button type="button" key={u.id} onClick={() => toggleEquipe(u.id)}
                        style={{ padding: "5px 10px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                          border: `1px solid ${sel ? "var(--primaria)" : "var(--borda)"}`,
                          background: sel ? "var(--primaria)" : "transparent", color: sel ? "#fff" : "var(--texto)" }}>
                        {sel ? "✓ " : ""}{u.nome}{u.funcao ? ` · ${u.funcao}` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Equipamentos</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={inputStyle} value={agEquipInput} onChange={(e) => setAgEquipInput(e.target.value)}
                  placeholder="ex.: Detector de gases" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEquipamento(); } }} />
                <button type="button" className="btn-azul btn-sec" onClick={addEquipamento}>+ Add</button>
              </div>
              {agEquipamentos.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {agEquipamentos.map((eq, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: "var(--bg-suave)", border: "1px solid var(--borda)", fontSize: 13 }}>
                      {eq}
                      <button type="button" onClick={() => setAgEquipamentos((p) => p.filter((_, idx) => idx !== i))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cinza)", padding: 0, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>Checklist</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {agChecklist.map((c, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--texto)" }}>
                    <input type="checkbox" checked={c.ok}
                      onChange={(e) => setAgChecklist((prev) => prev.map((x, idx) => idx === i ? { ...x, ok: e.target.checked } : x))} />
                    <span style={{ flex: 1 }}>{c.item}</span>
                    <button type="button" className="fu-icone-btn" title="Remover item"
                      onClick={() => setAgChecklist((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input style={inputStyle} value={agNovoItem} onChange={(e) => setAgNovoItem(e.target.value)}
                  placeholder="adicionar item ao checklist"
                  onKeyDown={(e) => { if (e.key === "Enter" && agNovoItem.trim()) { setAgChecklist((p) => [...p, { item: agNovoItem.trim(), ok: false }]); setAgNovoItem(""); } }} />
                <button type="button" className="btn-azul btn-sec" onClick={() => { if (agNovoItem.trim()) { setAgChecklist((p) => [...p, { item: agNovoItem.trim(), ok: false }]); setAgNovoItem(""); } }}>+ Item</button>
              </div>
            </div>
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalAgenda(false)} disabled={salvandoAgenda}>Cancelar</button>
              <button className="btn-azul" onClick={salvarAgenda} disabled={salvandoAgenda}>{salvandoAgenda ? "Salvando…" : "Salvar agendamento"}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: motivo do ajuste (reprovação) */}
      {reprovar && (
        <Modal titulo={reprovar.rotulo} onFechar={() => setReprovar(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, color: "var(--texto-suave)" }}>
              A inspeção volta para a fase {reprovar.destino} ({nomeFase(reprovar.destino)}) com a tag “Ajustar”. Informe o motivo:
            </p>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={4}
              placeholder="O que precisa ser ajustado no relatório?"
              style={{ ...inputStyle, resize: "vertical" }} autoFocus />
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setReprovar(null)} disabled={processando}>Cancelar</button>
              <button className="btn-azul" onClick={() => { if (!motivo.trim()) { setErro("Informe o motivo do ajuste."); return; } aplicar(reprovar.acao, motivo); }} disabled={processando}>
                {processando ? "Enviando…" : "Confirmar ajuste"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function formatar(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function formatarData(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("pt-BR");
}
function rotuloStatus(s: string) {
  return { rascunho: "Rascunho", em_aprovacao: "Em aprovação", aprovado: "Aprovado", ajustar: "Ajustar", assinado: "Assinado" }[s] || s;
}
function corStatus(s: string) {
  return { em_aprovacao: "#c2410c", aprovado: "#16a34a", ajustar: "#dc2626", assinado: "#7c3aed" }[s] || "var(--texto-suave)";
}
