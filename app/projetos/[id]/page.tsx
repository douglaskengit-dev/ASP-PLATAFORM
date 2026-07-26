"use client";

/** ASP — Detalhe do Projeto: informações + lista de inspeções (tanques/pontos).
 * Criar inspeção nasce na fase 2 (Agendamento). Ver COWORK-ASP.md §2. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Modal from "@/app/components/Modal";
import { tituloFase, ULTIMA_FASE } from "@/lib/asp/fases";

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
interface Inspecao {
  id: string;
  identificacao: string;
  fase: number;
  ferramenta_coleta: string;
  agendamentos?: { data_visita: string | null; hora: string | null; tipo: string }[];
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
  const id = params.id;
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [inspecoes, setInspecoes] = useState<Inspecao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [identificacao, setIdentificacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
        <h2 style={{ marginTop: 0 }}>{projeto.codigo_projeto || projeto.pedido_compra || "Projeto"}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 0 12px" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--fonte-titulo)", color: "var(--texto)" }}>
          Inspeções ({inspecoes.length})
        </h3>
        <button className="btn-azul" onClick={() => { setErro(null); setModalAberto(true); }}>
          + Nova inspeção
        </button>
      </div>

      {inspecoes.length === 0 ? (
        <p className="vazio">Nenhuma inspeção. Adicione um tanque/ponto para iniciar o fluxo.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {inspecoes.map((i) => {
            const pct = Math.round(((i.fase - 1) / (ULTIMA_FASE - 1)) * 100);
            const data = proximaData(i);
            return (
              <Link key={i.id} href={`/inspecoes/${i.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <strong style={{ color: "var(--texto)" }}>{i.identificacao}</strong>
                  <span className="detalhe" style={{ margin: 0 }}>Fase {i.fase} · {tituloFase(i.fase)}</span>
                </div>
                {data && <span className="detalhe" style={{ margin: "4px 0 0" }}>📅 Agendada: {data}</span>}
                <div className="fu-progresso" style={{ marginTop: 10 }} title={`Fase ${i.fase} de ${ULTIMA_FASE}`}>
                  <div className="fu-barra" style={{ width: `${pct}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
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
