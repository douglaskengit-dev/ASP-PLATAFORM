"use client";

/** Dashboard ASP — visão de Projetos e Inspeções (substitui a antiga visão de
 * Processos). KPIs, distribuição de inspeções por fase e projetos recentes,
 * a partir de /api/projetos. O fluxo antigo (Follow-up/Processos) segue no
 * repo para reaproveitamento, mas fora da navegação. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarrasHorizontais } from "@/app/components/DashboardCharts";
import { tituloFase, ULTIMA_FASE } from "@/lib/asp/fases";

interface Cliente { id: string; razao_social: string; cidade?: string | null; uf?: string | null }
interface InspecaoResumo { id: string; fase: number }
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  data_abertura: string;
  criado_em: string;
  cliente: Cliente | null;
  inspecoes: InspecaoResumo[];
  inspecoes_total: number;
}

const FASES_INSPECAO = [2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function DashboardPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [clienteFiltro, setClienteFiltro] = useState("");

  useEffect(() => {
    fetch("/api/projetos")
      .then(async (r) => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        const d = await r.json();
        setProjetos((d.projetos || []).map((p: Projeto) => ({ ...p, inspecoes: p.inspecoes || [] })));
      })
      .finally(() => setCarregando(false));
  }, []);

  const clientes = useMemo(() => {
    const mapa = new Map<string, string>();
    projetos.forEach((p) => { if (p.cliente) mapa.set(p.cliente.id, p.cliente.razao_social); });
    return Array.from(mapa, ([id, razao_social]) => ({ id, razao_social })).sort((a, b) => a.razao_social.localeCompare(b.razao_social));
  }, [projetos]);

  const projetosFiltrados = useMemo(
    () => (clienteFiltro ? projetos.filter((p) => p.cliente?.id === clienteFiltro) : projetos),
    [projetos, clienteFiltro]
  );

  const inspecoes = useMemo(() => projetosFiltrados.flatMap((p) => p.inspecoes), [projetosFiltrados]);

  const kpis = useMemo(() => {
    const total = inspecoes.length;
    const emAndamento = inspecoes.filter((i) => i.fase < ULTIMA_FASE).length;
    const aguardando = inspecoes.filter((i) => i.fase === 5 || i.fase === 9).length;
    const execucao = inspecoes.filter((i) => i.fase >= 6 && i.fase <= 9).length;
    const encerradas = inspecoes.filter((i) => i.fase >= ULTIMA_FASE).length;
    return { total, emAndamento, aguardando, execucao, encerradas };
  }, [inspecoes]);

  const porFase = useMemo(
    () => FASES_INSPECAO.map((n) => ({ rotulo: `${n}. ${tituloFase(n)}`, valor: inspecoes.filter((i) => i.fase === n).length })),
    [inspecoes]
  );

  const porCliente = useMemo(() => {
    const mapa = new Map<string, number>();
    projetosFiltrados.forEach((p) => {
      const nome = p.cliente?.razao_social || "Sem cliente";
      mapa.set(nome, (mapa.get(nome) || 0) + 1);
    });
    return Array.from(mapa, ([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor).slice(0, 8);
  }, [projetosFiltrados]);

  const recentes = useMemo(
    () => [...projetosFiltrados].sort((a, b) => (b.criado_em || "").localeCompare(a.criado_em || "")).slice(0, 8),
    [projetosFiltrados]
  );

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--fonte-titulo)", color: "var(--texto)" }}>Dashboard</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label className="detalhe" style={{ margin: 0 }}>Cliente</label>
          <select value={clienteFiltro} onChange={(e) => setClienteFiltro(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
        </div>
      </div>

      {projetos.length === 0 ? (
        <div className="card">
          <p className="vazio" style={{ margin: 0 }}>
            Nenhum projeto ainda. Abra o primeiro em <Link href="/projetos" style={{ color: "var(--primaria)" }}>Projetos</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="dash-kpis">
            <div className="kpi">
              <span className="kpi-valor">{projetosFiltrados.length}</span>
              <span className="kpi-nome">Projetos</span>
              <span className="kpi-desc">pedidos de compra abertos</span>
            </div>
            <div className="kpi">
              <span className="kpi-valor">{kpis.total}</span>
              <span className="kpi-nome">Inspeções</span>
              <span className="kpi-desc">tanques/pontos no total</span>
            </div>
            <div className="kpi">
              <span className="kpi-valor">{kpis.emAndamento}</span>
              <span className="kpi-nome">Em andamento</span>
              <span className="kpi-desc">ainda não encerradas</span>
            </div>
            <div className="kpi">
              <span className="kpi-valor" style={kpis.aguardando ? { color: "#c2410c" } : undefined}>{kpis.aguardando}</span>
              <span className="kpi-nome">Aguardando aprovação</span>
              <span className="kpi-desc">nas fases 5 e 9 (Gerência)</span>
            </div>
            <div className="kpi">
              <span className="kpi-valor">{kpis.execucao}</span>
              <span className="kpi-nome">Em execução</span>
              <span className="kpi-desc">ciclo de execução (fases 6–9)</span>
            </div>
            <div className="kpi">
              <span className="kpi-valor">{kpis.encerradas}</span>
              <span className="kpi-nome">Encerradas</span>
              <span className="kpi-desc">inspeções concluídas (fase 10)</span>
            </div>
          </div>

          <div className="dash-colunas" style={{ gridTemplateColumns: "1.4fr 1fr", marginTop: 16 }}>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Inspeções por fase</h2>
              <BarrasHorizontais dados={porFase} vazio="Nenhuma inspeção ainda." />
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Projetos por cliente</h2>
              <BarrasHorizontais dados={porCliente} cor="#0f766e" vazio="Sem projetos." />
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>Projetos recentes</h2>
            {recentes.length === 0 ? (
              <p className="vazio" style={{ margin: 0 }}>Sem projetos.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {recentes.map((p) => {
                  const fases = p.inspecoes.map((i) => i.fase);
                  const media = fases.length ? fases.reduce((a, b) => a + b, 0) / fases.length : 1;
                  const pct = Math.round(((media - 1) / (ULTIMA_FASE - 1)) * 100);
                  return (
                    <Link key={p.id} href={`/projetos/${p.id}`} className="item item-col" style={{ textDecoration: "none", color: "inherit" }}>
                      <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <strong style={{ color: "var(--texto)" }}>{p.codigo_projeto || p.pedido_compra || "Projeto"}</strong>
                        <span className="detalhe" style={{ margin: 0 }}>
                          {p.cliente?.razao_social || "Sem cliente"} · {p.inspecoes.length} inspeç{p.inspecoes.length === 1 ? "ão" : "ões"}
                        </span>
                      </div>
                      <div className="fu-progresso" style={{ marginTop: 10 }} title={`Progresso médio: ${pct}%`}>
                        <div className="fu-barra" style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
