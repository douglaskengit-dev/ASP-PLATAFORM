"use client";

/** ASP — Catálogo: procedimentos e equipamentos usados no Relatório Técnico.
 *
 * Substitui a lista que antes era fixa no código. O procedimento sugere os
 * equipamentos e o texto de métodos; cada equipamento tem sua ficha de
 * especificações em pares rótulo/valor, que é como elas saem no relatório. */
import { useCallback, useEffect, useState } from "react";

interface Espec { rotulo: string; valor: string }
interface Equipamento { id: string; slug: string; nome: string; especificacoes: Espec[]; ordem: number }
interface Procedimento { id: string; codigo: string; nome: string; metodos: string | null; equipamentos: string[]; ordem: number }

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rot: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };

export default function CatalogoPage() {
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [procedimentos, setProcedimentos] = useState<Procedimento[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : { equipamentos: [], procedimentos: [] })
      .then((d) => {
        setEquipamentos(d.equipamentos || []);
        setProcedimentos(d.procedimentos || []);
        setPodeEditar(!!d.podeEditar);
      })
      .finally(() => setCarregando(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function api(metodo: string, corpo?: any, query = "") {
    setErro(null);
    const res = await fetch(`/api/catalogo${query}`, {
      method: metodo,
      ...(corpo ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {}),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErro(d?.erro || "Falha ao salvar."); return null; }
    return d;
  }

  async function salvarEquip(e: Equipamento) {
    setSalvando(e.id);
    await api("PATCH", { tipo: "equipamento", id: e.id, dados: { nome: e.nome, slug: e.slug, especificacoes: e.especificacoes, ordem: e.ordem } });
    setSalvando(null); carregar();
  }
  async function salvarProc(p: Procedimento) {
    setSalvando(p.id);
    await api("PATCH", { tipo: "procedimento", id: p.id, dados: { codigo: p.codigo, nome: p.nome, metodos: p.metodos, equipamentos: p.equipamentos, ordem: p.ordem } });
    setSalvando(null); carregar();
  }
  async function excluir(tipo: string, id: string, nome: string) {
    if (!confirm(`Excluir "${nome}" do catálogo?`)) return;
    await api("DELETE", undefined, `?tipo=${tipo}&id=${id}`);
    carregar();
  }
  async function novoEquip() {
    await api("POST", { tipo: "equipamento", dados: { slug: `equip-${Date.now()}`, nome: "Novo equipamento", especificacoes: [], ordem: equipamentos.length + 1 } });
    carregar();
  }
  async function novoProc() {
    await api("POST", { tipo: "procedimento", dados: { codigo: `PR-${Date.now().toString().slice(-5)}`, nome: "Novo procedimento", metodos: "", equipamentos: [], ordem: procedimentos.length + 1 } });
    carregar();
  }

  const mudaEquip = (id: string, patch: Partial<Equipamento>) =>
    setEquipamentos((p) => p.map((e) => e.id === id ? { ...e, ...patch } : e));
  const mudaProc = (id: string, patch: Partial<Procedimento>) =>
    setProcedimentos((p) => p.map((x) => x.id === id ? { ...x, ...patch } : x));

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <header className="topo" style={{ background: "none", padding: 0, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Catálogo</h1>
        <p className="detalhe" style={{ margin: "4px 0 0" }}>
          Procedimentos e equipamentos usados no Relatório Técnico. O procedimento sugere os
          equipamentos e o texto de métodos; as especificações saem no relatório em duas colunas.
        </p>
      </header>
      {erro && <p className="erro-texto">{erro}</p>}
      {!podeEditar && <p className="detalhe">Somente consulta — edição restrita a Operações, Gerência e Admin.</p>}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Procedimentos ({procedimentos.length})</h3>
          {podeEditar && <button className="btn-azul" onClick={novoProc}>+ Procedimento</button>}
        </div>
        {procedimentos.map((p) => (
          <div key={p.id} style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div><label style={rot}>Código</label>
                <input style={campo} value={p.codigo} disabled={!podeEditar}
                  onChange={(e) => mudaProc(p.id, { codigo: e.target.value })} /></div>
              <div><label style={rot}>Nome</label>
                <input style={campo} value={p.nome} disabled={!podeEditar}
                  onChange={(e) => mudaProc(p.id, { nome: e.target.value })} /></div>
            </div>
            <label style={{ ...rot, marginTop: 10 }}>Texto sugerido para “Métodos”</label>
            <textarea style={{ ...campo, minHeight: 90 }} value={p.metodos || ""} disabled={!podeEditar}
              onChange={(e) => mudaProc(p.id, { metodos: e.target.value })} />
            <label style={{ ...rot, marginTop: 10 }}>Equipamentos previstos</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
              {equipamentos.map((e) => (
                <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" disabled={!podeEditar} checked={(p.equipamentos || []).includes(e.slug)}
                    onChange={(ev) => mudaProc(p.id, {
                      equipamentos: ev.target.checked
                        ? [...(p.equipamentos || []), e.slug]
                        : (p.equipamentos || []).filter((s) => s !== e.slug),
                    })} />
                  <span>{e.nome}</span>
                </label>
              ))}
            </div>
            {podeEditar && (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                  onClick={() => excluir("procedimento", p.id, p.nome)}>Excluir</button>
                <button className="btn-azul" disabled={salvando === p.id} onClick={() => salvarProc(p)}>
                  {salvando === p.id ? "Salvando…" : "Salvar"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Equipamentos ({equipamentos.length})</h3>
          {podeEditar && <button className="btn-azul" onClick={novoEquip}>+ Equipamento</button>}
        </div>
        {equipamentos.map((e) => (
          <div key={e.id} style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div><label style={rot}>Nome</label>
                <input style={campo} value={e.nome} disabled={!podeEditar}
                  onChange={(ev) => mudaEquip(e.id, { nome: ev.target.value })} /></div>
              <div><label style={rot}>Identificador</label>
                <input style={campo} value={e.slug} disabled={!podeEditar}
                  onChange={(ev) => mudaEquip(e.id, { slug: ev.target.value })} /></div>
            </div>

            <label style={{ ...rot, marginTop: 10 }}>Especificações (rótulo e valor)</label>
            {(e.especificacoes || []).map((sp, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 6 }}>
                <input style={campo} placeholder="Rótulo (ex.: Profundidade máxima)" value={sp.rotulo} disabled={!podeEditar}
                  onChange={(ev) => mudaEquip(e.id, { especificacoes: e.especificacoes.map((x, k) => k === i ? { ...x, rotulo: ev.target.value } : x) })} />
                <input style={campo} placeholder="Valor (ex.: 152 m)" value={sp.valor} disabled={!podeEditar}
                  onChange={(ev) => mudaEquip(e.id, { especificacoes: e.especificacoes.map((x, k) => k === i ? { ...x, valor: ev.target.value } : x) })} />
                {podeEditar && (
                  <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626", maxWidth: 110 }}
                    onClick={() => mudaEquip(e.id, { especificacoes: e.especificacoes.filter((_, k) => k !== i) })}>Remover</button>
                )}
              </div>
            ))}
            {podeEditar && (
              <button className="btn-dl btn-sec"
                onClick={() => mudaEquip(e.id, { especificacoes: [...(e.especificacoes || []), { rotulo: "", valor: "" }] })}>
                + Linha de especificação
              </button>
            )}

            {podeEditar && (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                  onClick={() => excluir("equipamento", e.id, e.nome)}>Excluir</button>
                <button className="btn-azul" disabled={salvando === e.id} onClick={() => salvarEquip(e)}>
                  {salvando === e.id ? "Salvando…" : "Salvar"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
