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
import { acoesDisponiveis, definicaoFase, tituloFase, ULTIMA_FASE, OpcaoAcao } from "@/lib/asp/fases";

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
  criado_em: string;
}
interface Coleta { id: string; tipo: string; pdf_path: string | null; criado_em: string }
interface Relatorio { id: string; tipo: string; versao: number; status: string; motivo_ajuste: string | null; enviado_em: string | null }
interface Agendamento {
  id: string; tipo: string; data_visita: string | null;
  equipe: string[]; equipamentos: string[]; checklist: { item: string; ok?: boolean }[];
  criado_em: string;
}

// Fase 1 é nível-projeto (abertura); as demais correm na inspeção.
const TODAS_FASES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
function nomeFase(n: number) {
  return n === 1 ? "Abertura do Projeto" : tituloFase(n);
}

// Ferramentas de coleta: só o medidor de sedimento está ativo (COWORK-ASP §2.5).
const FERRAMENTAS_FUTURAS = ["Ultrassom", "Drone", "MFL"];
// Itens iniciais do checklist de campo (extensível) — COWORK-ASP §3.2.
const CHECKLIST_PADRAO = ["NR-33 (espaço confinado)", "NR-10 (elétrica)", "EPIs", "Permissão de Trabalho (PT)"];

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
  // Relatório
  const [enviandoRelatorio, setEnviandoRelatorio] = useState(false);
  const relatorioInputRef = useRef<HTMLInputElement>(null);
  // Agendamento
  const [modalAgenda, setModalAgenda] = useState(false);
  const [agData, setAgData] = useState("");
  const [agEquipe, setAgEquipe] = useState("");
  const [agEquip, setAgEquip] = useState("");
  const [agChecklist, setAgChecklist] = useState<{ item: string; ok: boolean }[]>([]);
  const [agNovoItem, setAgNovoItem] = useState("");
  const [salvandoAgenda, setSalvandoAgenda] = useState(false);

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
  }, [carregar]);

  const acoes = useMemo(() => (insp ? acoesDisponiveis(perfil, insp.fase) : []), [insp, perfil]);
  const bloco: "inspecao" | "execucao" = insp && insp.fase > 5 ? "execucao" : "inspecao";
  const podeColeta = ["admin", "operacoes", "gerencia"].includes(perfil || "");
  const podeAgenda = ["admin", "comercial", "gerencia"].includes(perfil || "");
  const podeRelatorio = ["admin", "operacoes", "gerencia"].includes(perfil || "");

  async function aplicar(acao: string, motivoTexto?: string) {
    setErro(null);
    setProcessando(true);
    try {
      const r = await fetch(`/api/inspecoes/${id}/fase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, motivo: motivoTexto }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Não foi possível aplicar a ação."); return; }
      setReprovar(null);
      setMotivo("");
      carregar();
    } catch {
      setErro("Falha de rede.");
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
      const fd = new FormData();
      fd.append("inspecaoId", id);
      fd.append("tipo", "sedimento");
      fd.append("arquivo", arquivo);
      const r = await fetch("/api/coletas", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Falha ao anexar a coleta."); return; }
      carregar();
    } catch {
      setErro("Falha de rede ao anexar coleta.");
    } finally {
      setEnviandoColeta(false);
      if (coletaInputRef.current) coletaInputRef.current.value = "";
    }
  }

  async function enviarRelatorio(arquivo: File) {
    setEnviandoRelatorio(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("inspecaoId", id);
      fd.append("tipo", bloco);
      fd.append("arquivo", arquivo);
      const r = await fetch("/api/relatorios", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Falha ao enviar o relatório."); return; }
      carregar();
    } catch {
      setErro("Falha de rede ao enviar relatório.");
    } finally {
      setEnviandoRelatorio(false);
      if (relatorioInputRef.current) relatorioInputRef.current.value = "";
    }
  }

  function abrirAgenda() {
    setAgData("");
    setAgEquipe("");
    setAgEquip("");
    setAgChecklist(CHECKLIST_PADRAO.map((item) => ({ item, ok: false })));
    setAgNovoItem("");
    setErro(null);
    setModalAgenda(true);
  }

  async function salvarAgenda() {
    setSalvandoAgenda(true);
    setErro(null);
    try {
      const r = await fetch("/api/agendamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspecaoId: id,
          tipo: bloco,
          dataVisita: agData || undefined,
          equipe: agEquipe.split(",").map((s) => s.trim()).filter(Boolean),
          equipamentos: agEquip.split(",").map((s) => s.trim()).filter(Boolean),
          checklist: agChecklist,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Falha ao salvar o agendamento."); return; }
      setModalAgenda(false);
      carregar();
    } catch {
      setErro("Falha de rede ao salvar agendamento.");
    } finally {
      setSalvandoAgenda(false);
    }
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Coletas ({coletas.length})</h3>
            {podeColeta && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-azul btn-sec" onClick={() => setModalMedidor(true)}>📐 Medidor</button>
                <button className="btn-azul" onClick={() => coletaInputRef.current?.click()} disabled={enviandoColeta}>
                  {enviandoColeta ? "Enviando…" : "Anexar PDF"}
                </button>
                <input ref={coletaInputRef} type="file" accept="application/pdf" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) anexarColeta(f); }} />
              </div>
            )}
          </div>
          <p className="detalhe" style={{ marginTop: 6 }}>Ferramenta ativa: medidor de sedimento (cálculo local, exporta PDF).</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {FERRAMENTAS_FUTURAS.map((f) => (
              <span key={f} className="fu-badge manual" style={{ opacity: 0.75 }}>{f} · em desenvolvimento</span>
            ))}
          </div>
          {coletas.length === 0 ? (
            <p className="vazio" style={{ margin: 0 }}>Nenhuma coleta registrada.</p>
          ) : (
            coletas.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span className="detalhe" style={{ margin: 0 }}>{c.tipo} · {formatar(c.criado_em)}</span>
                {c.pdf_path && (
                  <a className="btn-dl btn-sec" href={`/api/coletas/${c.id}/download`} target="_blank" rel="noopener noreferrer">PDF</a>
                )}
              </div>
            ))
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
              <div key={a.id} style={{ borderLeft: "3px solid var(--borda)", paddingLeft: 12, marginTop: 10 }}>
                <div style={{ color: "var(--texto)", fontWeight: 600, textTransform: "capitalize" }}>
                  {a.tipo} {a.data_visita ? `· ${formatarData(a.data_visita)}` : ""}
                </div>
                {a.equipe?.length > 0 && <div className="detalhe" style={{ margin: 0 }}>Equipe: {a.equipe.join(", ")}</div>}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Relatórios ({relatorios.length})</h3>
          {podeRelatorio && (
            <div>
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
                <div style={{ fontSize: 14, color: "var(--texto)" }}>
                  <strong style={{ textTransform: "capitalize" }}>{h.acao}</strong>{" — "}fase {h.fase_de} → {h.fase_para}
                </div>
                {h.motivo && <div className="detalhe" style={{ margin: 0 }}>Motivo: {h.motivo}</div>}
                <div className="detalhe" style={{ margin: 0 }}>{formatar(h.criado_em)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: medidor de sedimento (ferramenta de campo embutida por iframe) */}
      {modalMedidor && (
        <Modal titulo="📐 Medidor de Sedimento" onFechar={() => setModalMedidor(false)} largo semPadding>
          <iframe src="/ferramentas/medidor-sedimento.html" title="Medidor de Sedimento"
            style={{ width: "100%", height: "80vh", border: "none", display: "block" }} />
        </Modal>
      )}

      {/* Modal: agendamento com checklist extensível */}
      {modalAgenda && (
        <Modal titulo={`Agendar ${bloco}`} onFechar={() => setModalAgenda(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data da visita</label>
              <input type="date" style={inputStyle} value={agData} onChange={(e) => setAgData(e.target.value)} />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Equipe (separe por vírgula)</label>
              <input style={inputStyle} value={agEquipe} onChange={(e) => setAgEquipe(e.target.value)} placeholder="ex.: João, Maria" />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Equipamentos (separe por vírgula)</label>
              <input style={inputStyle} value={agEquip} onChange={(e) => setAgEquip(e.target.value)} placeholder="ex.: Medidor, Detector de gases" />
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
