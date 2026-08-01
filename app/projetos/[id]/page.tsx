"use client";

/** ASP — Detalhe do Projeto: informações + lista de inspeções (tanques/pontos).
 * Criar inspeção nasce na fase 2 (Agendamento). Ver COWORK-ASP.md §2. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { descreverAcaoFase, tituloFase, ULTIMA_FASE } from "@/lib/asp/fases";
import { podeExcluirProjeto } from "@/lib/asp/permissoes";

interface Cliente {
  id: string;
  razao_social: string;
  cidade?: string | null;
  uf?: string | null;
  cnpj?: string | null;
}
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco: string | null;
  responsavel_projeto: string | null;
  data_abertura: string;
  cliente: Cliente | null;
}
/** Um arquivo do projeto, já classificado para exibição agrupada. */
interface ArquivoProjeto {
  grupo: "inspecao" | "execucao" | "medicao";
  inspecao: string;
  rotulo: string;
  data?: string | null;
  href: string;
}

interface Inspecao {
  id: string;
  identificacao: string;
  fase: number;
  ferramenta_coleta: string;
  agendamentos?: { data_visita: string | null; hora: string | null; tipo: string }[];
  ultima_acao?: {
    acao: string; fase_de: number; fase_para: number;
    data_autenticacao: string | null; criado_em: string;
    autor_perfil: { nome_completo: string | null; email: string | null } | null;
  } | null;
}

function proximaData(ins: Inspecao): string | null {
  const datas = (ins.agendamentos || []).filter((a) => a.data_visita).sort((a, b) => (a.data_visita! < b.data_visita! ? -1 : 1));
  if (datas.length === 0) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  const futura = datas.find((a) => (a.data_visita || "") >= hoje) || datas[datas.length - 1];
  const d = new Date(`${futura.data_visita}T00:00:00`).toLocaleDateString("pt-BR");
  return `${d}${futura.hora ? " às " + futura.hora : ""}`;
}

export default function ProjetoDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [podeExcluir, setPodeExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [verLixeiraInsp, setVerLixeiraInsp] = useState(false);
  const [inspLixeira, setInspLixeira] = useState<Inspecao[]>([]);
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [inspecoes, setInspecoes] = useState<Inspecao[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoProjeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [identificacao, setIdentificacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Edição do projeto
  const [modalEdit, setModalEdit] = useState(false);
  const [orgaos, setOrgaos] = useState<{ id: string; razao_social: string }[]>([]);
  const [edForm, setEdForm] = useState({ clienteId: "", codigoProjeto: "", pedidoCompra: "", endereco: "", responsavelProjeto: "" });
  const [salvandoEdit, setSalvandoEdit] = useState(false);

  function carregar() {
    fetch(`/api/projetos/${id}`)
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (r.status === 404) {
          setNaoEncontrado(true);
          return;
        }
        const d = await r.json();
        setProjeto(d.projeto);
        setInspecoes(d.inspecoes || []);
      })
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
    // Arquivos do projeto: a rota devolve tudo agrupado por projeto/inspeção.
    fetch("/api/arquivos").then((r) => r.ok ? r.json() : { projetos: [] }).then((d: any) => {
      const proj = (d.projetos || []).find((p: any) => p.id === id);
      const lista: ArquivoProjeto[] = [];
      for (const insp of proj?.inspecoes || []) {
        for (const c of insp.coletas || []) {
          lista.push({
            grupo: "medicao", inspecao: insp.identificacao,
            rotulo: `Medição (${c.tipo || "sedimento"})`, data: c.criado_em,
            href: `/api/coletas/${c.id}/download`,
          });
        }
        for (const r of insp.relatorios || []) {
          lista.push({
            grupo: r.tipo === "execucao" ? "execucao" : "inspecao", inspecao: insp.identificacao,
            rotulo: `Relatório v${r.versao} — ${r.status}`, data: r.enviado_em,
            href: `/api/relatorios/${r.id}/download`,
          });
        }
      }
      setArquivos(lista);
    }).catch(() => {});

    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase.from("gp_profiles").select("perfil, funcao").eq("id", data.user.id).single();
      setPodeExcluir(podeExcluirProjeto(p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function excluirInspecao(iid: string) {
    if (!confirm("Enviar esta inspeção para a lixeira? Recuperável por 30 dias.")) return;
    const r = await fetch(`/api/inspecoes/${iid}`, { method: "DELETE" });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao excluir inspeção."); return; }
    carregar();
  }
  function abrirLixeiraInsp() {
    fetch(`/api/inspecoes?projetoId=${id}&lixeira=1`).then((r) => r.json()).then((d) => setInspLixeira(d.inspecoes || [])).catch(() => {});
    setVerLixeiraInsp(true);
  }
  async function restaurarInspecao(iid: string) {
    const r = await fetch(`/api/inspecoes/${iid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurar: true }) });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao restaurar."); return; }
    abrirLixeiraInsp(); carregar();
  }
  async function excluirInspDefinitivo(iid: string) {
    if (!confirm("Excluir DEFINITIVAMENTE esta inspeção?")) return;
    const r = await fetch(`/api/inspecoes/${iid}?definitivo=1`, { method: "DELETE" });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao excluir."); return; }
    abrirLixeiraInsp();
  }

  async function excluirProjeto() {
    if (!confirm("Enviar este projeto para a lixeira? Ele fica recuperável por 30 dias e depois é apagado de vez.")) return;
    setExcluindo(true);
    try {
      const r = await fetch(`/api/projetos/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Falha ao excluir."); return; }
      router.push("/projetos");
    } catch {
      setErro("Falha de rede ao excluir.");
    } finally {
      setExcluindo(false);
    }
  }

  async function criarInspecao() {
    setErro(null);
    if (!identificacao.trim()) {
      setErro("Informe a identificação (ex.: Tanque TQ-01).");
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch("/api/inspecoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projetoId: id, identificacao }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.erro || "Não foi possível criar a inspeção.");
        return;
      }
      setInspecoes((prev) => [...prev, d.inspecao]);
      setIdentificacao("");
      setModalAberto(false);
    } catch {
      setErro("Falha de rede ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao() {
    if (!projeto) return;
    setEdForm({
      clienteId: projeto.cliente?.id || "",
      codigoProjeto: projeto.codigo_projeto || "",
      pedidoCompra: projeto.pedido_compra || "",
      endereco: projeto.endereco || "",
      responsavelProjeto: projeto.responsavel_projeto || "",
    });
    setErro(null);
    setModalEdit(true);
    fetch("/api/orgaos").then((r) => r.json()).then((d) => setOrgaos(d.orgaos || [])).catch(() => {});
  }

  async function salvarEdicao() {
    setErro(null);
    setSalvandoEdit(true);
    try {
      const r = await fetch(`/api/projetos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edForm),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.erro || "Falha ao salvar o projeto."); return; }
      setModalEdit(false);
      carregar();
    } catch {
      setErro("Falha de rede ao salvar.");
    } finally {
      setSalvandoEdit(false);
    }
  }

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;
  if (naoEncontrado || !projeto)
    return (
      <div className="page-larga">
        <p className="vazio">Projeto não encontrado.</p>
        <Link href="/projetos" style={{ color: "var(--primaria)" }}>← Voltar aos projetos</Link>
      </div>
    );

  return (
    <div className="page-larga">
      <Link href="/projetos" style={{ color: "var(--primaria)", textDecoration: "none", fontSize: 13 }}>
        ← Projetos
      </Link>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>{projeto.codigo_projeto || projeto.pedido_compra || "Projeto"}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-azul btn-sec" onClick={abrirEdicao}>✎ Editar projeto</button>
            {podeExcluir && (
              <button className="btn-azul" style={{ background: "#dc2626" }} onClick={excluirProjeto} disabled={excluindo}>
                {excluindo ? "Excluindo…" : "🗑 Excluir"}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 14 }}>
          <Campo rotulo="Cliente" valor={projeto.cliente?.razao_social} />
          <Campo
            rotulo="Local"
            valor={projeto.cliente?.cidade ? `${projeto.cliente.cidade}${projeto.cliente.uf ? "/" + projeto.cliente.uf : ""}` : undefined}
          />
          <Campo rotulo="Pedido de compra" valor={projeto.pedido_compra} />
          <Campo rotulo="Endereço da obra" valor={projeto.endereco} />
          <Campo rotulo="Responsável" valor={projeto.responsavel_projeto} />
          <Campo rotulo="Aberto em" valor={formatarData(projeto.data_abertura)} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 0 12px", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--fonte-titulo)", color: "var(--texto)" }}>
          {verLixeiraInsp ? "Inspeções — Lixeira" : `Inspeções (${inspecoes.length})`}
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          {podeExcluir && (
            <button className="btn-azul btn-sec" onClick={() => (verLixeiraInsp ? setVerLixeiraInsp(false) : abrirLixeiraInsp())}>
              {verLixeiraInsp ? "← Voltar" : "🗑 Lixeira"}
            </button>
          )}
          {!verLixeiraInsp && (
            <button className="btn-azul" onClick={() => { setErro(null); setModalAberto(true); }}>+ Nova inspeção</button>
          )}
        </div>
      </div>

      {verLixeiraInsp ? (
        inspLixeira.length === 0 ? (
          <p className="vazio">A lixeira de inspeções está vazia.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {inspLixeira.map((i) => (
              <div key={i.id} className="item" style={{ justifyContent: "space-between" }}>
                <strong style={{ color: "var(--texto)" }}>{i.identificacao} <span className="detalhe" style={{ fontWeight: 400 }}>· fase {i.fase}</span></strong>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn-dl btn-sec" onClick={() => restaurarInspecao(i.id)}>↩ Restaurar</button>
                  <button className="btn-dl" style={{ background: "#dc2626" }} onClick={() => excluirInspDefinitivo(i.id)}>Excluir definitivamente</button>
                </span>
              </div>
            ))}
          </div>
        )
      ) : inspecoes.length === 0 ? (
        <p className="vazio">Nenhuma inspeção. Adicione um tanque/ponto para iniciar o fluxo.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {inspecoes.map((i) => {
            const pct = Math.round(((i.fase - 1) / (ULTIMA_FASE - 1)) * 100);
            const data = proximaData(i);
            return (
              <div key={i.id} style={{ position: "relative" }}>
                <Link href={`/inspecoes/${i.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingRight: podeExcluir ? 28 : 0 }}>
                    <strong style={{ color: "var(--texto)" }}>{i.identificacao}</strong>
                    <span className="detalhe" style={{ margin: 0 }}>Fase {i.fase} · {tituloFase(i.fase)}</span>
                  </div>
                  {data && <span className="detalhe" style={{ margin: "4px 0 0" }}>📅 Agendada: {data}</span>}
                  {i.ultima_acao && (
                    <span className="detalhe" style={{ margin: "2px 0 0" }}>
                      🕀 {descreverAcaoFase(i.ultima_acao.acao, i.ultima_acao.fase_de, i.ultima_acao.fase_para)} · por {i.ultima_acao.autor_perfil?.nome_completo || i.ultima_acao.autor_perfil?.email || "usuário"}
                      {" · "}{formatarDataHora(i.ultima_acao.data_autenticacao || i.ultima_acao.criado_em)}
                    </span>
                  )}
                  <div className="fu-progresso" style={{ marginTop: 10 }} title={`Fase ${i.fase} de ${ULTIMA_FASE}`}>
                    <div className="fu-barra" style={{ width: `${pct}%` }} />
                  </div>
                </Link>
                {podeExcluir && (
                  <button className="fu-icone-btn lixeira" title="Excluir inspeção (lixeira)"
                    onClick={() => excluirInspecao(i.id)}
                    style={{ position: "absolute", top: 12, right: 12 }}>🗑</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalEdit && (
        <Modal titulo="Editar projeto" onFechar={() => setModalEdit(false)}>
          <div className="form-projeto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Cliente</label>
              <select value={edForm.clienteId} onChange={(e) => setEdForm((f) => ({ ...f, clienteId: e.target.value }))}>
                <option value="">— Selecione o cliente —</option>
                {orgaos.map((o) => <option key={o.id} value={o.id}>{o.razao_social}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Código do projeto</label>
                <input value={edForm.codigoProjeto} onChange={(e) => setEdForm((f) => ({ ...f, codigoProjeto: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Pedido de compra</label>
                <input value={edForm.pedidoCompra} onChange={(e) => setEdForm((f) => ({ ...f, pedidoCompra: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Endereço da obra</label>
              <input value={edForm.endereco} onChange={(e) => setEdForm((f) => ({ ...f, endereco: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Responsável</label>
              <input value={edForm.responsavelProjeto} onChange={(e) => setEdForm((f) => ({ ...f, responsavelProjeto: e.target.value }))} />
            </div>
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalEdit(false)} disabled={salvandoEdit}>Cancelar</button>
              <button className="btn-azul" onClick={salvarEdicao} disabled={salvandoEdit}>{salvandoEdit ? "Salvando…" : "Salvar alterações"}</button>
            </div>
          </div>
        </Modal>
      )}

      {modalAberto && (
        <Modal titulo="Nova inspeção" onFechar={() => setModalAberto(false)}>
          <div className="form-projeto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Identificação</label>
              <input
                value={identificacao}
                onChange={(e) => setIdentificacao(e.target.value)}
                placeholder="ex.: Tanque TQ-01"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") criarInspecao(); }}
              />
              <small style={{ color: "var(--cinza)" }}>A inspeção começa na fase 2 (Agendamento). Coleta padrão: medidor de sedimento.</small>
            </div>
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-azul btn-sec" onClick={() => setModalAberto(false)} disabled={salvando}>Cancelar</button>
              <button className="btn-azul" onClick={criarInspecao} disabled={salvando}>{salvando ? "Criando…" : "Criar inspeção"}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Arquivos do projeto, ao final: agrupados por Inspeção, Execução e Medição. */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Arquivos do projeto ({arquivos.length})</h3>
        {arquivos.length === 0 ? (
          <p className="vazio" style={{ margin: 0 }}>Nenhum arquivo anexado neste projeto.</p>
        ) : (
          (["inspecao", "execucao", "medicao"] as const).map((grupo) => {
            const itens = arquivos.filter((a) => a.grupo === grupo);
            if (itens.length === 0) return null;
            const titulo = grupo === "inspecao" ? "Relatórios de inspeção"
              : grupo === "execucao" ? "Relatórios de execução" : "Medições";
            return (
              <div key={grupo} style={{ marginTop: 14 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 14, borderBottom: "1px solid var(--borda)", paddingBottom: 6 }}>
                  {titulo} ({itens.length})
                </h4>
                {itens.map((a) => (
                  <div key={a.href} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <span className="detalhe" style={{ margin: 0 }}>
                      <strong style={{ color: "var(--texto)" }}>{a.inspecao}</strong> · {a.rotulo}
                      {a.data ? ` · ${formatarDataHora(a.data)}` : ""}
                    </span>
                    <a className="btn-dl btn-sec" href={a.href} target="_blank" rel="noopener noreferrer">Baixar</a>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--cinza)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{rotulo}</span>
      <div style={{ color: "var(--texto)", fontWeight: 500 }}>{valor || "—"}</div>
    </div>
  );
}

function formatarData(iso?: string) {
  if (!iso) return undefined;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("pt-BR");
}

function formatarDataHora(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
