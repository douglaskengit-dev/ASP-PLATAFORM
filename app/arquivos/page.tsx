"use client";

/** Arquivos — documentos do novo fluxo (coletas do medidor + relatórios
 * versionados), agrupados por Projeto → Inspeção, com busca e filtros. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { tituloFase } from "@/lib/asp/fases";

interface Coleta { id: string; tipo: string; pdf_path: string | null; criado_em: string }
interface Relatorio { id: string; tipo: string; versao: number; status: string; arquivo_path: string | null; enviado_em: string | null }
interface Inspecao { id: string; identificacao: string; fase: number; coletas: Coleta[]; relatorios: Relatorio[] }
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  cliente: { id: string; razao_social: string } | null;
  inspecoes: Inspecao[];
}

type FiltroTipo = "todos" | "coletas" | "relatorio_inspecao" | "relatorio_execucao";

function fmt(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function rotuloStatus(s: string) {
  return { rascunho: "Rascunho", em_aprovacao: "Em aprovação", aprovado: "Aprovado", ajustar: "Ajustar", assinado: "Assinado" }[s] || s;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};

export default function ArquivosPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [q, setQ] = useState("");
  const [cliente, setCliente] = useState("");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");

  useEffect(() => {
    fetch("/api/arquivos")
      .then(async (r) => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        const d = await r.json();
        setProjetos(d.projetos || []);
      })
      .finally(() => setCarregando(false));
  }, []);

  const clientes = useMemo(() => {
    const mapa = new Map<string, string>();
    projetos.forEach((p) => { if (p.cliente) mapa.set(p.cliente.id, p.cliente.razao_social); });
    return Array.from(mapa, ([id, razao_social]) => ({ id, razao_social })).sort((a, b) => a.razao_social.localeCompare(b.razao_social));
  }, [projetos]);

  const termo = q.trim().toLowerCase();

  const filtrados = useMemo(() => {
    return projetos
      .filter((p) => !cliente || p.cliente?.id === cliente)
      .map((p) => {
        const inspecoes = p.inspecoes
          .map((i) => ({
            ...i,
            coletas: tipo === "todos" || tipo === "coletas" ? i.coletas : [],
            relatorios: i.relatorios.filter((r) =>
              tipo === "todos" ? true : tipo === "relatorio_inspecao" ? r.tipo === "inspecao" : tipo === "relatorio_execucao" ? r.tipo === "execucao" : false
            ),
          }))
          .filter((i) => {
            const temArquivo = i.coletas.length > 0 || i.relatorios.length > 0;
            if (!temArquivo) return false;
            if (!termo) return true;
            const alvo = `${p.codigo_projeto || ""} ${p.pedido_compra || ""} ${p.cliente?.razao_social || ""} ${i.identificacao}`.toLowerCase();
            return alvo.includes(termo);
          });
        return { ...p, inspecoes };
      })
      .filter((p) => p.inspecoes.length > 0);
  }, [projetos, cliente, tipo, termo]);

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontFamily: "var(--fonte-titulo)" }}>Arquivos</h1>
      <p className="detalhe" style={{ marginBottom: 16 }}>Coletas e relatórios, organizados por projeto e inspeção.</p>

      <div className="item" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Buscar</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="projeto, cliente ou inspeção…" style={inp} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Cliente</label>
          <select value={cliente} onChange={(e) => setCliente(e.target.value)} style={inp}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Tipo de documento</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as FiltroTipo)} style={inp}>
            <option value="todos">Todos</option>
            <option value="coletas">Coletas</option>
            <option value="relatorio_inspecao">Relatório de inspeção</option>
            <option value="relatorio_execucao">Relatório de execução</option>
          </select>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <p className="vazio">Nenhum documento encontrado.</p>
      ) : (
        filtrados.map((p) => (
          <div className="card" key={p.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <Link href={`/projetos/${p.id}`} style={{ fontWeight: 700, color: "var(--texto)", textDecoration: "none", fontSize: 16 }}>
                {p.codigo_projeto || p.pedido_compra || "Projeto"}
              </Link>
              <span className="detalhe" style={{ margin: 0 }}>{p.cliente?.razao_social || "Cliente não informado"}</span>
            </div>

            {p.inspecoes.map((i) => (
              <div key={i.id} style={{ marginTop: 14, borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
                <Link href={`/inspecoes/${i.id}`} style={{ fontWeight: 600, color: "var(--texto)", textDecoration: "none" }}>
                  {i.identificacao}
                </Link>
                <span className="detalhe" style={{ margin: "0 0 0 8px" }}>Fase {i.fase} · {tituloFase(i.fase)}</span>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {i.coletas.map((c) => (
                    <div key={c.id} className="downloads" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <span className="detalhe" style={{ margin: 0 }}>📐 Coleta · {c.tipo} · {fmt(c.criado_em)}</span>
                      <a className="btn-dl btn-sec" href={`/api/coletas/${c.id}/download`} target="_blank" rel="noopener noreferrer">⬇ PDF</a>
                    </div>
                  ))}
                  {i.relatorios.map((r) => (
                    <div key={r.id} className="downloads" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <span className="detalhe" style={{ margin: 0 }}>
                        📄 Relatório de {r.tipo} v{r.versao} · {rotuloStatus(r.status)}{r.enviado_em ? ` · ${fmt(r.enviado_em)}` : ""}
                      </span>
                      <a className="btn-dl" href={`/api/relatorios/${r.id}/download`} target="_blank" rel="noopener noreferrer">⬇ Baixar</a>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
