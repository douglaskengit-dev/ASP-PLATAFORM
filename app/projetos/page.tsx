"use client";

/** ASP — Lista de Projetos (fase 1, Comercial). Um projeto = 1 pedido de
 * compra e reúne N inspeções (tanques/pontos). Ver COWORK-ASP.md §2.
 * A abertura (cliente, contato, código, pedido…) fica em FormularioProjeto,
 * com as regras de lib/validacao/projeto.ts. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import FormularioProjeto from "@/app/components/FormularioProjeto";
import TituloPagina from "@/app/components/TituloPagina";

interface ClienteResumo {
  id: string;
  razao_social: string;
  cidade?: string | null;
  uf?: string | null;
}
interface InspecaoResumo { id: string; fase: number; encerrada_em?: string | null }
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
  /** Fase 10: todas as OSs ativas encerradas (preenchido pela API). */
  concluido_em?: string | null;
}

const ULTIMA_FASE = 10;

const rotFiltro: React.CSSProperties = {
  fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4,
};

/** Status do projeto: "Concluído" quando todas as OSs ativas foram
 *  ENCERRADAS (Fase 10 — concluido_em, gravado pela API); senão derivado
 *  das fases das suas OSs. Todas na fase 10 sem encerrar = "Em encerramento". */
function statusProjeto(inspecoes: InspecaoResumo[], concluidoEm?: string | null): { label: string; cor: string; pct: number; chave: string } {
  if (concluidoEm) return { label: "Concluído", cor: "#16a34a", pct: 100, chave: "concluido" };
  if (!inspecoes.length) return { label: "Sem OS", cor: "#5a6b7b", pct: 0, chave: "sem" };
  const media = inspecoes.reduce((a, i) => a + i.fase, 0) / inspecoes.length;
  const pct = Math.round(((media - 1) / (ULTIMA_FASE - 1)) * 100);
  if (inspecoes.every((i) => i.fase >= ULTIMA_FASE)) return { label: "Em encerramento", cor: "#0f766e", pct: 100, chave: "encerramento" };
  if (inspecoes.some((i) => i.fase === 5 || i.fase === 9)) return { label: "Aguardando aprovação", cor: "#c2410c", pct, chave: "aprovacao" };
  return { label: "Em andamento", cor: "var(--primaria)", pct, chave: "andamento" };
}

/** Rótulos dos status, para o filtro. */
const STATUS_OPCOES = [
  { chave: "andamento", label: "Em andamento" },
  { chave: "aprovacao", label: "Aguardando aprovação" },
  { chave: "encerramento", label: "Em encerramento" },
  { chave: "concluido", label: "Concluído" },
  { chave: "sem", label: "Sem OS" },
];
export default function ProjetosPage() {
  const router = useRouter();
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verLixeira, setVerLixeira] = useState(false);
  // Filtros, ordenação e agrupamento da lista.
  const [busca, setBusca] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [ordem, setOrdem] = useState<"recentes" | "antigos" | "codigo" | "cliente" | "inspecoes">("recentes");
  const [agrupar, setAgrupar] = useState(true);
  const [podeExcluir, setPodeExcluir] = useState(false);

  function carregar(lixeira: boolean) {
    setCarregando(true);
    fetch(`/api/projetos${lixeira ? "?lixeira=1" : ""}`)
      .then(async (r) => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        const d = await r.json();
        setProjetos((d.projetos || []).map((p: Projeto) => ({ ...p, inspecoes: p.inspecoes || [] })));
        setPodeExcluir(!!d.podeExcluir);
      })
      .finally(() => setCarregando(false));
  }

  useEffect(() => { carregar(verLixeira); }, [verLixeira]);

  async function restaurar(pid: string) {
    const r = await fetch(`/api/projetos/${pid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurar: true }) });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao restaurar."); return; }
    carregar(true);
  }
  async function excluirDefinitivo(pid: string) {
    if (!confirm("Excluir DEFINITIVAMENTE este projeto? Não há como recuperar.")) return;
    const r = await fetch(`/api/projetos/${pid}?definitivo=1`, { method: "DELETE" });
    if (!r.ok) { setErro((await r.json()).erro || "Falha ao excluir."); return; }
    carregar(true);
  }

  function abrirModal() {
    setErro(null);
    setModalAberto(true);
  }

  /** Filtra, ordena e (opcionalmente) agrupa por cliente. Só vale para a
   *  lista normal — a lixeira mostra tudo, sem filtro. */
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = projetos.filter((p) => {
      if (filtroCliente && p.cliente?.id !== filtroCliente) return false;
      if (filtroStatus && statusProjeto(p.inspecoes, p.concluido_em).chave !== filtroStatus) return false;
      if (!termo) return true;
      return [p.codigo_projeto, p.pedido_compra, p.cliente?.razao_social, p.endereco, p.responsavel_projeto]
        .some((c) => (c || "").toLowerCase().includes(termo));
    });
    const cmp: Record<string, (a: Projeto, b: Projeto) => number> = {
      recentes: (a, b) => (b.data_abertura || "").localeCompare(a.data_abertura || ""),
      antigos: (a, b) => (a.data_abertura || "").localeCompare(b.data_abertura || ""),
      codigo: (a, b) => (a.codigo_projeto || a.pedido_compra || "").localeCompare(b.codigo_projeto || b.pedido_compra || "", "pt-BR"),
      cliente: (a, b) => (a.cliente?.razao_social || "").localeCompare(b.cliente?.razao_social || "", "pt-BR"),
      inspecoes: (a, b) => b.inspecoes_total - a.inspecoes_total,
    };
    return [...lista].sort(cmp[ordem]);
  }, [projetos, busca, filtroCliente, filtroStatus, ordem]);

  /** Projetos agrupados por cliente, mantendo a ordem escolhida dentro de
   *  cada grupo. Os grupos saem em ordem alfabética de cliente. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, { nome: string; itens: Projeto[] }>();
    for (const p of visiveis) {
      const chave = p.cliente?.id || "sem-cliente";
      const nome = p.cliente?.razao_social || "Cliente não informado";
      if (!mapa.has(chave)) mapa.set(chave, { nome, itens: [] });
      mapa.get(chave)!.itens.push(p);
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [visiveis]);

  /** Clientes que aparecem na lista — alimentam o filtro. */
  const clientesNaLista = useMemo(() => {
    const mapa = new Map<string, string>();
    projetos.forEach((p) => { if (p.cliente?.id) mapa.set(p.cliente.id, p.cliente.razao_social); });
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [projetos]);

  const filtrando = !!(busca.trim() || filtroCliente || filtroStatus);

  /** Cartão de um projeto. Chamado como função (não como componente) para o
   *  React não recriar o tipo a cada render — mesmo cuidado adotado no modal
   *  de relatório, onde isso custava o foco dos campos. */
  function CartaoProjeto(p: Projeto) {
    const st = statusProjeto(p.inspecoes, p.concluido_em);
    return (
      <Link key={p.id} href={`/projetos/${p.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{ display: "flex", width: "100%", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ color: "var(--texto)" }}>
              {p.codigo_projeto || p.pedido_compra || "Projeto sem código"}
            </strong>
            <span className="detalhe">
              {/* Agrupado por cliente, o nome já está no cabeçalho do grupo. */}
              {!agrupar && (p.cliente?.razao_social || "Cliente não informado")}
              {!agrupar && p.cliente?.cidade ? ` · ${p.cliente.cidade}${p.cliente.uf ? "/" + p.cliente.uf : ""}` : ""}
              {agrupar && p.cliente?.cidade ? `${p.cliente.cidade}${p.cliente.uf ? "/" + p.cliente.uf : ""}` : ""}
              {p.pedido_compra && p.codigo_projeto ? ` · Pedido ${p.pedido_compra}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
            <span className="fu-badge" style={{ background: st.cor, color: "#fff" }}>{st.label}</span>
            <span className="detalhe" style={{ margin: 0 }}>
              {p.inspecoes_total} OS{p.inspecoes_total === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="fu-progresso" style={{ marginTop: 10 }} title={`Progresso médio: ${st.pct}%`}>
          <div className="fu-barra" style={{ width: `${st.pct}%`, background: st.cor }} />
        </div>
      </Link>
    );
  }

  return (
    <div className="page-larga">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <TituloPagina titulo={verLixeira ? "Projetos — Lixeira" : "Projetos"} subtitulo={verLixeira ? "Excluídos recentemente. Podem ser restaurados por 30 dias; depois são apagados de vez." : "Cada projeto corresponde a um pedido de compra e reúne as Ordens de Serviço — OSs (tanques/pontos)."} />
        <div style={{ display: "flex", gap: 8 }}>
          {podeExcluir && (
            <button className="btn-azul btn-sec" onClick={() => setVerLixeira((v) => !v)}>
              {verLixeira ? "← Voltar aos projetos" : "🗑 Lixeira"}
            </button>
          )}
          {!verLixeira && <button className="btn-azul" onClick={abrirModal}>+ Novo projeto</button>}
        </div>
      </div>

      {erro && <p className="erro-texto">{erro}</p>}

      {!verLixeira && !carregando && projetos.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <div>
              <label style={rotFiltro}>Buscar</label>
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="código, pedido, cliente, endereço…" />
            </div>
            <div>
              <label style={rotFiltro}>Cliente</label>
              <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
                <option value="">Todos</option>
                {clientesNaLista.map(([cid, nome]) => <option key={cid} value={cid}>{nome}</option>)}
              </select>
            </div>
            <div>
              <label style={rotFiltro}>Status</label>
              <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                <option value="">Todos</option>
                {STATUS_OPCOES.map((o) => <option key={o.chave} value={o.chave}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={rotFiltro}>Ordenar por</label>
              <select value={ordem} onChange={(e) => setOrdem(e.target.value as any)}>
                <option value="recentes">Mais recentes</option>
                <option value="antigos">Mais antigos</option>
                <option value="codigo">Código do projeto</option>
                <option value="cliente">Cliente (A–Z)</option>
                <option value="inspecoes">Nº de OSs</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)}
                style={{ width: 16, height: 16 }} />
              Agrupar por cliente
            </label>
            <span className="detalhe" style={{ margin: 0 }}>
              {visiveis.length} de {projetos.length} projeto(s)
            </span>
            {filtrando && (
              <button className="btn-dl btn-sec"
                onClick={() => { setBusca(""); setFiltroCliente(""); setFiltroStatus(""); }}>
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {carregando ? (
        <p className="vazio">Carregando projetos…</p>
      ) : projetos.length === 0 ? (
        <p className="vazio">{verLixeira ? "A lixeira está vazia." : "Nenhum projeto ainda. Clique em “+ Novo projeto” para abrir o primeiro."}</p>
      ) : verLixeira ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projetos.map((p) => (
            <div key={p.id} className="item" style={{ justifyContent: "space-between" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ color: "var(--texto)" }}>{p.codigo_projeto || p.pedido_compra || "Projeto sem código"}</strong>
                <span className="detalhe">{p.cliente?.razao_social || "Cliente não informado"}</span>
              </div>
              <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-dl btn-sec" onClick={() => restaurar(p.id)}>↩ Restaurar</button>
                <button className="btn-dl" style={{ background: "#dc2626" }} onClick={() => excluirDefinitivo(p.id)}>Excluir definitivamente</button>
              </span>
            </div>
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <p className="vazio">Nenhum projeto corresponde aos filtros.</p>
      ) : agrupar ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {grupos.map((g) => (
            <div key={g.nome}>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
                borderBottom: "2px solid var(--borda)", paddingBottom: 6, marginBottom: 10,
              }}>
                <strong style={{ color: "var(--texto)", fontSize: 15 }}>{g.nome}</strong>
                <span className="detalhe" style={{ margin: 0 }}>
                  {g.itens.length} projeto{g.itens.length === 1 ? "" : "s"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.itens.map((p) => CartaoProjeto(p))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visiveis.map((p) => CartaoProjeto(p))}
        </div>
      )}

      {modalAberto && (
        <Modal titulo="Abrir novo projeto" onFechar={() => setModalAberto(false)}>
          <FormularioProjeto
            modo="novo"
            onCancelar={() => setModalAberto(false)}
            onSalvo={(projeto) => router.push(`/projetos/${projeto.id}`)}
          />
        </Modal>
      )}
    </div>
  );
}
