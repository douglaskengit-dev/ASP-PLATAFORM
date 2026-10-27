"use client";

/** Arquivos — documentos do novo fluxo (coletas do medidor + relatórios
 * versionados), agrupados por Projeto → Inspeção, com busca e filtros. Os
 * RDOs são do projeto (um por dia, podem cobrir várias inspeções) e aparecem
 * logo abaixo do cabeçalho do projeto. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TituloPagina from "@/app/components/TituloPagina";
import { tituloFase } from "@/lib/asp/fases";
import { dataBr, numeroRdo } from "@/lib/asp/rdo";

interface Coleta { id: string; tipo: string; pdf_path: string | null; criado_em: string }
interface LaudoArq { caminho: string; nome?: string; enviado_em?: string | null }
interface Relatorio {
  id: string; tipo: string; versao: number; status: string; arquivo_path: string | null; assinado_path?: string | null; enviado_em: string | null;
  /** PDF do laudo do laboratório (relatório de execução, Fase 8): o de
   *  antes da limpeza (ou o único, nas versões antigas) e o de após. */
  laudo?: LaudoArq | null;
  laudoDepois?: LaudoArq | null;
}
/** Laudo da OS (o mesmo PDF pode estar em várias versões do relatório):
 *  baixa pelo relatório mais recente que o usa. */
interface LaudoOS { relId: string; nome: string; enviado_em: string | null; versoes: number[]; qual: "laudo" | "laudo-depois" }

/** Laudos distintos (por arquivo) dos relatórios da OS. */
function laudosDa(relatorios: Relatorio[]): LaudoOS[] {
  const m = new Map<string, LaudoOS>();
  for (const r of [...relatorios].sort((a, b) => b.versao - a.versao)) {
    for (const [l, qual] of [[r.laudo, "laudo"], [r.laudoDepois, "laudo-depois"]] as const) {
      if (!l?.caminho) continue;
      const atual = m.get(l.caminho);
      if (atual) atual.versoes.push(r.versao);
      else m.set(l.caminho, { relId: r.id, nome: l.nome || "laudo.pdf", enviado_em: l.enviado_em || null, versoes: [r.versao], qual });
    }
  }
  return Array.from(m.values());
}
interface Inspecao { id: string; identificacao: string; fase: number; coletas: Coleta[]; relatorios: Relatorio[]; laudos?: LaudoOS[] }
/** RDO com arquivo gerado; `inspecoes` já vem com os nomes. */
interface Rdo { id: string; numero: number; data: string; arquivo_em: string | null; inspecoes: string[] }
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  cliente: { id: string; razao_social: string } | null;
  inspecoes: Inspecao[];
  rdos?: Rdo[];
}

type FiltroTipo = "todos" | "coletas" | "relatorio_inspecao" | "relatorio_execucao" | "laudo" | "rdo";

function fmt(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function rotuloStatus(s: string) {
  return { rascunho: "Rascunho", em_aprovacao: "Em aprovação", aprovado: "Aprovado", ajustar: "Ajustar", assinado: "Assinado", substituido: "Substituído" }[s] || s;
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
  const [estrutura, setEstrutura] = useState<"cli/proj/insp" | "proj/insp" | "cli/proj/insp/tipo">("cli/proj/insp");
  const [baixando, setBaixando] = useState<null | "tudo" | "novos">(null);

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
            laudos: tipo === "todos" || tipo === "laudo" ? laudosDa(i.relatorios) : [],
          }))
          .filter((i) => {
            const temArquivo = i.coletas.length > 0 || i.relatorios.length > 0 || i.laudos.length > 0;
            if (!temArquivo) return false;
            if (!termo) return true;
            const alvo = `${p.codigo_projeto || ""} ${p.pedido_compra || ""} ${p.cliente?.razao_social || ""} ${i.identificacao}`.toLowerCase();
            return alvo.includes(termo);
          });
        const rdos = (tipo === "todos" || tipo === "rdo" ? p.rdos || [] : []).filter((r) => {
          if (!termo) return true;
          const alvo = `${p.codigo_projeto || ""} ${p.pedido_compra || ""} ${p.cliente?.razao_social || ""} rdo ${r.inspecoes.join(" ")}`.toLowerCase();
          return alvo.includes(termo);
        });
        return { ...p, inspecoes, rdos };
      })
      .filter((p) => p.inspecoes.length > 0 || p.rdos.length > 0);
  }, [projetos, cliente, tipo, termo]);

  function limpar(s?: string | null) {
    return (s || "").replace(/[\\/:*?"<>|]/g, "-").trim() || "sem-nome";
  }
  function caminhoArquivo(p: Projeto, i: Inspecao, item: any, kind: "coleta" | "relatorio" | "laudo") {
    const cli = limpar(p.cliente?.razao_social || "Sem cliente");
    const proj = limpar(p.codigo_projeto || p.pedido_compra || "Projeto");
    const insp = limpar(i.identificacao);
    let nome: string;
    if (kind === "coleta") nome = `Coleta-${limpar(item.tipo)}-${(item.criado_em || "").slice(0, 10)}.pdf`;
    else if (kind === "laudo") nome = `Laudo-${limpar(String(item.nome || "laudo").replace(/\.pdf$/i, ""))}.pdf`;
    else { const ext = !item.assinado_path && String(item.arquivo_path || "").endsWith(".docx") ? "docx" : "pdf"; nome = `Relatorio-${limpar(item.tipo)}-v${item.versao}${item.assinado_path ? "-assinado" : ""}.${ext}`; }
    let base: string;
    if (estrutura === "proj/insp") base = `${proj}/${insp}`;
    else if (estrutura === "cli/proj/insp/tipo") base = `${cli}/${proj}/${insp}/${kind === "coleta" ? "Coletas" : kind === "laudo" ? "Laudos" : "Relatorios"}`;
    else base = `${cli}/${proj}/${insp}`;
    return `${base}/${nome}`;
  }
  /** RDO é do projeto: vai numa pasta "RDOs" ao lado das inspeções. */
  function caminhoRdo(p: Projeto, r: Rdo) {
    const cli = limpar(p.cliente?.razao_social || "Sem cliente");
    const proj = limpar(p.codigo_projeto || p.pedido_compra || "Projeto");
    const nome = `RDO-${numeroRdo(r.numero)}-${r.data}.docx`;
    return estrutura === "proj/insp" ? `${proj}/RDOs/${nome}` : `${cli}/${proj}/RDOs/${nome}`;
  }

  const CHAVE_ULTIMO = "asp:arqUltimoDownload";
  async function baixarZip(apenasNovos: boolean) {
    setBaixando(apenasNovos ? "novos" : "tudo");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const corte = apenasNovos ? Number(localStorage.getItem(CHAVE_ULTIMO) || 0) : 0;
      let count = 0;
      for (const p of filtrados) {
        for (const r of p.rdos) {
          const dt = r.arquivo_em ? new Date(r.arquivo_em).getTime() : 0;
          if (apenasNovos && dt <= corte) continue;
          const resp = await fetch(`/api/rdos/${r.id}/download`);
          if (!resp.ok) continue;
          zip.file(caminhoRdo(p, r), await resp.blob());
          count++;
        }
        for (const i of p.inspecoes) {
          for (const c of i.coletas) {
            if (!c.pdf_path) continue;
            if (apenasNovos && new Date(c.criado_em).getTime() <= corte) continue;
            const resp = await fetch(`/api/coletas/${c.id}/download`);
            if (!resp.ok) continue;
            zip.file(caminhoArquivo(p, i, c, "coleta"), await resp.blob());
            count++;
          }
          for (const l of i.laudos || []) {
            const dt = l.enviado_em ? new Date(l.enviado_em).getTime() : 0;
            if (apenasNovos && dt <= corte) continue;
            const resp = await fetch(`/api/relatorios/${l.relId}/download?arquivo=${l.qual}`);
            if (!resp.ok) continue;
            zip.file(caminhoArquivo(p, i, l, "laudo"), await resp.blob());
            count++;
          }
          for (const r of i.relatorios) {
            if (!r.arquivo_path) continue;
            const dt = r.enviado_em ? new Date(r.enviado_em).getTime() : 0;
            if (apenasNovos && dt <= corte) continue;
            const resp = await fetch(`/api/relatorios/${r.id}/download${r.assinado_path ? "?arquivo=assinado&registrar=0" : "?registrar=0"}`);
            if (!resp.ok) continue;
            zip.file(caminhoArquivo(p, i, r, "relatorio"), await resp.blob());
            count++;
          }
        }
      }
      if (count === 0) { alert(apenasNovos ? "Nada novo para baixar desde o último download." : "Nenhum arquivo para baixar no filtro atual."); return; }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arquivos-asp-${new Date().toISOString().slice(0, 10)}${apenasNovos ? "-novidades" : ""}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      localStorage.setItem(CHAVE_ULTIMO, String(Date.now()));
    } catch {
      alert("Falha ao gerar o ZIP.");
    } finally {
      setBaixando(null);
    }
  }

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <TituloPagina titulo="Arquivos" subtitulo="Coletas, relatórios e RDOs, organizados por projeto e OS." />

      <div className="item" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Buscar</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="projeto, cliente ou OS…" style={inp} />
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
            <option value="laudo">Laudos (laboratório)</option>
            <option value="rdo">RDO (diário de operação)</option>
          </select>
        </div>
      </div>

      <div className="item" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Estrutura das pastas</label>
          <select value={estrutura} onChange={(e) => setEstrutura(e.target.value as typeof estrutura)} style={inp}>
            <option value="cli/proj/insp">Cliente / Projeto / OS</option>
            <option value="proj/insp">Projeto / OS</option>
            <option value="cli/proj/insp/tipo">Cliente / Projeto / OS / Tipo</option>
          </select>
        </div>
        <button className="btn-azul" onClick={() => baixarZip(false)} disabled={!!baixando}>
          {baixando === "tudo" ? "Baixando…" : "⬇ Baixar tudo (ZIP)"}
        </button>
        <button className="btn-azul btn-sec" onClick={() => baixarZip(true)} disabled={!!baixando} title="Somente arquivos novos desde o último download">
          {baixando === "novos" ? "Baixando…" : "⬇ Baixar novidades"}
        </button>
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

            {p.rdos.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
                <span style={{ fontWeight: 600, color: "var(--texto)" }}>RDOs — Registro Diário de Operação</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {p.rdos.map((r) => (
                    <div key={r.id} className="downloads" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <span className="detalhe" style={{ margin: 0 }}>
                        📋 RDO nº {numeroRdo(r.numero)} · {dataBr(r.data)}{r.inspecoes.length ? ` · ${r.inspecoes.join(", ")}` : ""}
                      </span>
                      <a className="btn-dl" href={`/api/rdos/${r.id}/download`} target="_blank" rel="noopener noreferrer">⬇ Baixar</a>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {r.assinado_path && (
                          <a className="btn-dl" href={`/api/relatorios/${r.id}/download?arquivo=assinado`} target="_blank" rel="noopener noreferrer">⬇ Assinado</a>
                        )}
                        <a className={`btn-dl${r.assinado_path ? " btn-sec" : ""}`} href={`/api/relatorios/${r.id}/download`} target="_blank" rel="noopener noreferrer">⬇ {r.assinado_path ? "Original" : "Baixar"}</a>
                      </span>
                    </div>
                  ))}
                  {(i.laudos || []).length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <span className="detalhe" style={{ margin: 0, fontWeight: 600 }}>Laudos</span>
                      {(i.laudos || []).map((l) => (
                        <div key={`${l.relId}-${l.qual}`} className="downloads" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                          <span className="detalhe" style={{ margin: 0, overflowWrap: "anywhere" }}>
                            🧪 {l.qual === "laudo-depois" ? "Após a limpeza: " : ""}{l.nome} · relatório de execução v{l.versoes.sort((a, b) => a - b).join(", v")}{l.enviado_em ? ` · ${fmt(l.enviado_em)}` : ""}
                          </span>
                          <a className="btn-dl btn-sec" href={`/api/relatorios/${l.relId}/download?arquivo=${l.qual}`} target="_blank" rel="noopener noreferrer">⬇ Laudo</a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
