"use client";

/** Dashboard ASP — visão de Projetos e Inspeções (substitui a antiga visão de
 * Processos). Filtros (cliente, período, status), KPIs com tooltips (HoverCard),
 * distribuição de inspeções por fase e projetos recentes. Dados de /api/projetos. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarrasHorizontais } from "@/app/components/DashboardCharts";
import HoverCard from "@/app/components/HoverCard";
import TituloPagina from "@/app/components/TituloPagina";
import CalendarioAgenda from "@/app/components/CalendarioAgenda";
import { tituloFase, ULTIMA_FASE } from "@/lib/asp/fases";

interface Cliente { id: string; razao_social: string }
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
type Status = "" | "andamento" | "aprovacao" | "execucao" | "encerrado";

function statusProjeto(insp: InspecaoResumo[]): Exclude<Status, ""> {
  if (insp.length > 0 && insp.every((i) => i.fase >= ULTIMA_FASE)) return "encerrado";
  if (insp.some((i) => i.fase === 5 || i.fase === 9)) return "aprovacao";
  if (insp.some((i) => i.fase >= 6 && i.fase <= 9)) return "execucao";
  return "andamento";
}
const ROTULO_STATUS: Record<Exclude<Status, "">, string> = {
  andamento: "Em andamento", aprovacao: "Aguardando aprovação", execucao: "Em execução", encerrado: "Encerrado",
};

const FILTROS_VAZIOS = { cliente: "", de: "", ate: "", status: "" as Status };

export default function DashboardPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [f, setF] = useState(FILTROS_VAZIOS);

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

  const projetosFiltrados = useMemo(() => projetos.filter((p) => {
    if (f.cliente && p.cliente?.id !== f.cliente) return false;
    if (f.de && (p.data_abertura || "") < f.de) return false;
    if (f.ate && (p.data_abertura || "") > f.ate) return false;
    if (f.status && statusProjeto(p.inspecoes) !== f.status) return false;
    return true;
  }), [projetos, f]);

  const inspecoes = useMemo(() => projetosFiltrados.flatMap((p) => p.inspecoes), [projetosFiltrados]);

  const k = useMemo(() => {
    const total = inspecoes.length;
    const andamento = inspecoes.filter((i) => i.fase < ULTIMA_FASE).length;
    const aprovacao = inspecoes.filter((i) => i.fase === 5 || i.fase === 9).length;
    const execucao = inspecoes.filter((i) => i.fase >= 6 && i.fase <= 9).length;
    const encerradas = inspecoes.filter((i) => i.fase >= ULTIMA_FASE).length;
    const coleta = inspecoes.filter((i) => i.fase === 3).length;
    const media = total ? inspecoes.reduce((a, i) => a + i.fase, 0) / total : 1;
    const progresso = Math.round(((media - 1) / (ULTIMA_FASE - 1)) * 100);
    const conclusao = total ? Math.round((encerradas / total) * 100) : 0;
    return { total, andamento, aprovacao, execucao, encerradas, coleta, progresso, conclusao };
  }, [inspecoes]);

  const statusCount = useMemo(() => {
    const c = { andamento: 0, aprovacao: 0, execucao: 0, encerrado: 0 };
    projetosFiltrados.forEach((p) => { c[statusProjeto(p.inspecoes)]++; });
    return c;
  }, [projetosFiltrados]);

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

  function limpar() { setF(FILTROS_VAZIOS); }
  const temFiltro = f.cliente || f.de || f.ate || f.status;

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <TituloPagina titulo="Dashboard" subtitulo="Visão geral de projetos e inspeções" />

      {/* Filtros */}
      <div className="item" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Cliente</label>
          <select value={f.cliente} onChange={(e) => setF((s) => ({ ...s, cliente: e.target.value }))} style={inp}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
        </div>
        <div>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Status</label>
          <select value={f.status} onChange={(e) => setF((s) => ({ ...s, status: e.target.value as Status }))} style={inp}>
            <option value="">Todos</option>
            <option value="andamento">Em andamento</option>
            <option value="aprovacao">Aguardando aprovação</option>
            <option value="execucao">Em execução</option>
            <option value="encerrado">Encerrado</option>
          </select>
        </div>
        <div>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Aberto de</label>
          <input type="date" value={f.de} onChange={(e) => setF((s) => ({ ...s, de: e.target.value }))} style={inp} />
        </div>
        <div>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Aberto até</label>
          <input type="date" value={f.ate} onChange={(e) => setF((s) => ({ ...s, ate: e.target.value }))} style={inp} />
        </div>
        {temFiltro && <button className="btn-azul btn-sec" onClick={limpar}>Limpar</button>}
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
            <Kpi valor={projetosFiltrados.length} nome="Projetos" desc="pedidos de compra"
              tip={<TipStatus c={statusCount} />} />
            <Kpi valor={k.total} nome="Inspeções" desc="tanques/pontos"
              tip={<span>Média de {projetosFiltrados.length ? (k.total / projetosFiltrados.length).toFixed(1) : 0} inspeções por projeto.</span>} />
            <Kpi valor={k.andamento} nome="Em andamento" desc="não encerradas"
              tip={<span>Inspeções ainda antes da fase {ULTIMA_FASE} (Encerramento).</span>} />
            <Kpi valor={k.aprovacao} cor={k.aprovacao ? "#c2410c" : undefined} nome="Aguardando aprovação" desc="fases 5 e 9 (Gerência)"
              tip={<span>Relatórios na fila da Gerência (fase 5 = inspeção, fase 9 = execução).</span>} />
            <Kpi valor={k.execucao} nome="Em execução" desc="fases 6–9"
              tip={<span>Inspeções no ciclo de execução.</span>} />
            <Kpi valor={k.encerradas} nome="Encerradas" desc="fase 10"
              tip={<span>Taxa de conclusão: {k.conclusao}% das inspeções.</span>} />
            <Kpi valor={`${k.progresso}%`} nome="Progresso médio" desc="avanço das inspeções"
              tip={<span>Média das fases das inspeções, normalizada de 0 a 100%.</span>} />
            <Kpi valor={k.coleta} nome="Em coleta" desc="fase 3 (Operações)"
              tip={<span>Inspeções na fase de coleta de dados de campo.</span>} />
          </div>

          <div className="dash-colunas" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginTop: 16 }}>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Inspeções por fase</h2>
              <BarrasHorizontais dados={porFase} vazio="Nenhuma inspeção ainda."
                renderPopover={(d) => <span>{d.valor} inspeç{d.valor === 1 ? "ão" : "ões"} em <strong>{d.rotulo}</strong>.</span>} />
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Projetos por cliente</h2>
              <BarrasHorizontais dados={porCliente} cor="#0f766e" vazio="Sem projetos."
                renderPopover={(d) => <span><strong>{d.valor}</strong> projeto(s) de {d.rotulo}.</span>} />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <CalendarioAgenda />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>Projetos recentes</h2>
            {recentes.length === 0 ? (
              <p className="vazio" style={{ margin: 0 }}>Nenhum projeto no filtro atual.</p>
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
                          {p.cliente?.razao_social || "Sem cliente"} · {ROTULO_STATUS[statusProjeto(p.inspecoes)]}
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

function Kpi({ valor, nome, desc, tip, cor }: { valor: number | string; nome: string; desc: string; tip: React.ReactNode; cor?: string }) {
  return (
    <HoverCard conteudo={tip}>
      <div className="kpi" style={{ cursor: "help", height: "100%" }}>
        <span className="kpi-valor" style={cor ? { color: cor } : undefined}>{valor}</span>
        <span className="kpi-nome">{nome}</span>
        <span className="kpi-desc">{desc}</span>
      </div>
    </HoverCard>
  );
}

function TipStatus({ c }: { c: { andamento: number; aprovacao: number; execucao: number; encerrado: number } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span>Em andamento: <strong>{c.andamento}</strong></span>
      <span>Aguardando aprovação: <strong>{c.aprovacao}</strong></span>
      <span>Em execução: <strong>{c.execucao}</strong></span>
      <span>Encerrado: <strong>{c.encerrado}</strong></span>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
