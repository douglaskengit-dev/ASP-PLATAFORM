"use client";

/** ASP — Lista de Projetos (fase 1, Comercial). Um projeto = 1 pedido de
 * compra e reúne N inspeções (tanques/pontos). Ver COWORK-ASP.md §2.
 * Reaproveita gp_orgaos (cliente) via FormularioOrgao inline. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import FormularioOrgao from "@/app/components/FormularioOrgao";

interface ClienteResumo {
  id: string;
  razao_social: string;
  cidade?: string | null;
  uf?: string | null;
}
interface InspecaoResumo { id: string; fase: number }
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  endereco: string | null;
  responsavel_projeto: string | null;
  data_abertura: string;
  cliente: ClienteResumo | null;
  inspecoes: InspecaoResumo[];
  inspecoes_total: number;
}

const ULTIMA_FASE = 10;

/** Status do projeto derivado das fases das suas inspeções. */
function statusProjeto(inspecoes: InspecaoResumo[]): { label: string; cor: string; pct: number } {
  if (!inspecoes.length) return { label: "Sem inspeções", cor: "#5a6b7b", pct: 0 };
  const media = inspecoes.reduce((a, i) => a + i.fase, 0) / inspecoes.length;
  const pct = Math.round(((media - 1) / (ULTIMA_FASE - 1)) * 100);
  if (inspecoes.every((i) => i.fase >= ULTIMA_FASE)) return { label: "Encerrado", cor: "#16a34a", pct: 100 };
  if (inspecoes.some((i) => i.fase === 5 || i.fase === 9)) return { label: "Aguardando aprovação", cor: "#c2410c", pct };
  return { label: "Em andamento", cor: "var(--primaria)", pct };
}
interface Orgao {
  id: string;
  razao_social: string;
  cidade?: string | null;
  uf?: string | null;
}

const FORM_VAZIO = {
  clienteId: "",
  codigoProjeto: "",
  pedidoCompra: "",
  endereco: "",
  responsavelProjeto: "",
  dataAbertura: "",
};

export default function ProjetosPage() {
  const router = useRouter();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [cadastrarOrgao, setCadastrarOrgao] = useState(false);
  const [orgaos, setOrgaos] = useState<Orgao[]>([]);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projetos")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        const d = await r.json();
        setProjetos((d.projetos || []).map((p: Projeto) => ({ ...p, inspecoes: p.inspecoes || [] })));
      })
      .finally(() => setCarregando(false));
  }, []);

  function abrirModal() {
    setForm(FORM_VAZIO);
    setErro(null);
    setModalAberto(true);
    fetch("/api/orgaos")
      .then((r) => r.json())
      .then((d) => setOrgaos(d.orgaos || []))
      .catch(() => {});
  }

  function atualizar(campo: keyof typeof FORM_VAZIO, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function salvar() {
    setErro(null);
    if (!form.pedidoCompra.trim() && !form.codigoProjeto.trim()) {
      setErro("Informe ao menos o pedido de compra ou o código do projeto.");
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch("/api/projetos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.erro || "Não foi possível abrir o projeto.");
        return;
      }
      router.push(`/projetos/${d.projeto.id}`);
    } catch {
      setErro("Falha de rede ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="page-larga">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--fonte-titulo)", color: "var(--texto)" }}>Projetos</h1>
          <p className="detalhe" style={{ marginTop: 4 }}>
            Cada projeto corresponde a um pedido de compra e reúne as inspeções (tanques/pontos).
          </p>
        </div>
        <button className="btn-azul" onClick={abrirModal}>
          + Novo projeto
        </button>
      </div>

      {carregando ? (
        <p className="vazio">Carregando projetos…</p>
      ) : projetos.length === 0 ? (
        <p className="vazio">Nenhum projeto ainda. Clique em “+ Novo projeto” para abrir o primeiro.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projetos.map((p) => {
            const st = statusProjeto(p.inspecoes);
            return (
            <Link key={p.id} href={`/projetos/${p.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ display: "flex", width: "100%", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ color: "var(--texto)" }}>
                    {p.codigo_projeto || p.pedido_compra || "Projeto sem código"}
                  </strong>
                  <span className="detalhe">
                    {p.cliente?.razao_social || "Cliente não informado"}
                    {p.cliente?.cidade ? ` · ${p.cliente.cidade}${p.cliente.uf ? "/" + p.cliente.uf : ""}` : ""}
                    {p.pedido_compra && p.codigo_projeto ? ` · Pedido ${p.pedido_compra}` : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <span className="fu-badge" style={{ background: st.cor, color: "#fff" }}>{st.label}</span>
                  <span className="detalhe" style={{ margin: 0 }}>
                    {p.inspecoes_total} inspeç{p.inspecoes_total === 1 ? "ão" : "ões"}
                  </span>
                </div>
              </div>
              <div className="fu-progresso" style={{ marginTop: 10 }} title={`Progresso médio: ${st.pct}%`}>
                <div className="fu-barra" style={{ width: `${st.pct}%`, background: st.cor }} />
              </div>
            </Link>
            );
          })}
        </div>
      )}

      {modalAberto && (
        <Modal titulo="Abrir novo projeto" onFechar={() => setModalAberto(false)}>
          <div className="form-projeto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Cliente</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={form.clienteId} onChange={(e) => atualizar("clienteId", e.target.value)}>
                  <option value="">— Selecione o cliente —</option>
                  {orgaos.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.razao_social}
                      {o.cidade ? ` (${o.cidade}${o.uf ? "/" + o.uf : ""})` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-azul btn-sec" style={{ whiteSpace: "nowrap" }} onClick={() => setCadastrarOrgao(true)}>
                  + Cadastrar
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Código do projeto</label>
                <input value={form.codigoProjeto} onChange={(e) => atualizar("codigoProjeto", e.target.value)} placeholder="ex.: ASP-2026-001" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Pedido de compra</label>
                <input value={form.pedidoCompra} onChange={(e) => atualizar("pedidoCompra", e.target.value)} placeholder="nº do pedido" />
              </div>
            </div>

            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Endereço da obra</label>
              <input value={form.endereco} onChange={(e) => atualizar("endereco", e.target.value)} placeholder="pode diferir do endereço do cliente" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Responsável</label>
                <input value={form.responsavelProjeto} onChange={(e) => atualizar("responsavelProjeto", e.target.value)} placeholder="responsável pelo projeto" />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data de abertura</label>
                <input type="date" value={form.dataAbertura} onChange={(e) => atualizar("dataAbertura", e.target.value)} />
              </div>
            </div>

            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn-azul btn-sec" onClick={() => setModalAberto(false)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn-azul" onClick={salvar} disabled={salvando}>
                {salvando ? "Abrindo…" : "Abrir projeto"}
              </button>
            </div>
          </div>

          {cadastrarOrgao && (
            <Modal titulo="Cadastrar órgão / cliente" zIndex={200} onFechar={() => setCadastrarOrgao(false)}>
              <FormularioOrgao
                onCancelar={() => setCadastrarOrgao(false)}
                onSucesso={(orgao) => {
                  setOrgaos((prev) => [{ id: orgao.id, razao_social: orgao.razao_social, cidade: orgao.cidade, uf: orgao.uf }, ...prev]);
                  atualizar("clienteId", orgao.id);
                  setCadastrarOrgao(false);
                }}
              />
            </Modal>
          )}
        </Modal>
      )}
    </div>
  );
}
