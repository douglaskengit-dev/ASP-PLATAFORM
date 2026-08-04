"use client";

/** Checklist dos equipamentos levados a campo, por etapa (inspeção/execução).
 *
 * É um CARD e não um modal de propósito: checklist é progresso, e progresso
 * precisa ficar visível sem clique — em campo a pessoa confere item a item
 * enquanto carrega a van, e um modal fecharia a cada toque fora. O modal
 * aparece só para COMPOR a lista (escolher do Catálogo), que aí sim é edição.
 *
 * A lista nasce do procedimento escolhido e aceita itens extras. Cada item
 * guarda quem conferiu, quando e uma observação (avaria, nº de série). */
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";

interface Item {
  slug?: string;
  nome: string;
  conferido: boolean;
  por?: string | null;
  em?: string | null;
  obs?: string;
}
interface Checklist { id: string; tipo: "inspecao" | "execucao"; procedimento: string | null; itens: Item[] }

const campo: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 13,
};

export default function ChecklistEquipamentos({ inspecaoId, etapa, nomeUsuario }: {
  inspecaoId: string;
  /** Etapa corrente da inspeção — define qual checklist é o principal. */
  etapa: "inspecao" | "execucao";
  nomeUsuario: string;
}) {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [procedimentos, setProcedimentos] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [compondo, setCompondo] = useState(false);
  const [procEscolhido, setProcEscolhido] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [extra, setExtra] = useState("");

  const carregar = useCallback(() => {
    fetch(`/api/checklist?inspecaoId=${inspecaoId}`).then((r) => r.ok ? r.json() : {})
      .then((d: any) => {
        setChecklists((d.checklists || []).map((c: any) => ({ ...c, itens: c.itens || [] })));
        setPodeEditar(!!d.podeEditar);
      }).catch(() => {});
  }, [inspecaoId]);

  useEffect(() => {
    carregar();
    fetch("/api/catalogo").then((r) => r.ok ? r.json() : {}).then((d: any) => {
      setProcedimentos(d.procedimentos || []);
      setEquipamentos(d.equipamentos || []);
    }).catch(() => {});
  }, [carregar]);

  const atual = useMemo(() => checklists.find((c) => c.tipo === etapa) || null, [checklists, etapa]);
  const outro = useMemo(() => checklists.find((c) => c.tipo !== etapa) || null, [checklists, etapa]);

  /** Ao escolher o procedimento, já marca os equipamentos previstos. */
  function escolherProcedimento(codigo: string) {
    setProcEscolhido(codigo);
    const p = procedimentos.find((x) => x.codigo === codigo);
    if (p) setSelecionados(p.equipamentos || []);
  }

  async function criarChecklist() {
    setSalvando(true); setErro(null);
    const itens: Item[] = equipamentos
      .filter((e) => selecionados.includes(e.slug))
      .map((e) => ({ slug: e.slug, nome: e.nome, conferido: false }));
    // itens digitados à mão, um por linha
    for (const linha of extra.split("\n").map((l) => l.trim()).filter(Boolean)) {
      itens.push({ nome: linha, conferido: false });
    }
    const res = await fetch("/api/checklist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspecaoId, tipo: etapa, procedimento: procEscolhido || null, itens }),
    });
    const d = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) { setErro(d?.erro || "Falha ao montar o checklist."); return; }
    setCompondo(false); setExtra(""); carregar();
  }

  async function gravarItens(c: Checklist, itens: Item[]) {
    setChecklists((p) => p.map((x) => x.id === c.id ? { ...x, itens } : x));   // otimista
    const res = await fetch("/api/checklist", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, itens }),
    });
    if (!res.ok) { setErro("Falha ao salvar o checklist."); carregar(); }
  }

  function alternar(c: Checklist, i: number) {
    const itens = c.itens.map((it, k) => k !== i ? it : (
      it.conferido
        ? { ...it, conferido: false, por: null, em: null }
        : { ...it, conferido: true, por: nomeUsuario, em: new Date().toISOString() }
    ));
    gravarItens(c, itens);
  }

  function anotar(c: Checklist, i: number, obs: string) {
    gravarItens(c, c.itens.map((it, k) => k === i ? { ...it, obs } : it));
  }

  function render(c: Checklist, principal: boolean) {
    const feitos = c.itens.filter((i) => i.conferido).length;
    const total = c.itens.length;
    const completo = total > 0 && feitos === total;
    return (
      <div key={c.id} style={{ marginTop: principal ? 8 : 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13.5, textTransform: "capitalize" }}>{c.tipo}</strong>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            background: completo ? "#dcfce7" : "#fef3c7", color: completo ? "#166534" : "#92400e",
          }}>
            {feitos} de {total} conferido(s)
          </span>
          {c.procedimento && <span className="detalhe" style={{ margin: 0 }}>· {c.procedimento}</span>}
        </div>

        {c.itens.map((it, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--borda)", padding: "8px 0" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: podeEditar ? "pointer" : "default" }}>
              <input type="checkbox" checked={it.conferido} disabled={!podeEditar} style={{ marginTop: 3, width: 18, height: 18 }}
                onChange={() => alternar(c, i)} />
              <span style={{ flex: 1 }}>
                <span style={{
                  color: "var(--texto)", fontWeight: 600,
                  textDecoration: it.conferido ? "line-through" : "none",
                  opacity: it.conferido ? 0.65 : 1,
                }}>{it.nome}</span>
                {it.conferido && it.por && (
                  <span className="detalhe" style={{ display: "block" }}>
                    Conferido por {it.por} em {it.em ? new Date(it.em).toLocaleString("pt-BR") : "—"}
                  </span>
                )}
              </span>
            </label>
            {podeEditar && (
              <input style={{ ...campo, marginTop: 6 }} placeholder="Observação (avaria, substituição, nº de série)"
                defaultValue={it.obs || ""} onBlur={(e) => { if (e.target.value !== (it.obs || "")) anotar(c, i, e.target.value); }} />
            )}
            {!podeEditar && it.obs && <span className="detalhe" style={{ display: "block" }}>{it.obs}</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Checklist de equipamentos</h3>
        {podeEditar && (
          <button className="btn-azul" onClick={() => { setCompondo(true); setSelecionados(atual?.itens.map((i) => i.slug || "").filter(Boolean) || []); }}>
            {atual ? "Refazer lista" : "Montar lista"}
          </button>
        )}
      </div>
      <p className="detalhe" style={{ marginTop: 6 }}>
        Conferência dos equipamentos levados a campo, uma para cada etapa. A lista nasce do
        procedimento e aceita itens avulsos.
      </p>
      {erro && <p className="erro-texto" style={{ margin: "6px 0 0" }}>{erro}</p>}

      {!atual && !outro && <p className="vazio" style={{ margin: "8px 0 0" }}>Nenhum checklist montado.</p>}
      {atual && render(atual, true)}
      {outro && render(outro, false)}

      {compondo && (
        <Modal titulo={`Montar checklist — ${etapa}`} onFechar={() => setCompondo(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 }}>Procedimento</label>
              <select style={campo} value={procEscolhido} onChange={(e) => escolherProcedimento(e.target.value)}>
                <option value="">— escolher (marca os equipamentos previstos) —</option>
                {procedimentos.map((p) => <option key={p.id} value={p.codigo}>{p.codigo} — {p.nome}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 }}>Equipamentos do catálogo</label>
              {equipamentos.length === 0 ? (
                <p className="vazio" style={{ margin: 0 }}>Nenhum equipamento no catálogo.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
                  {equipamentos.map((e) => (
                    <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={selecionados.includes(e.slug)}
                        onChange={(ev) => setSelecionados((p) => ev.target.checked ? [...p, e.slug] : p.filter((s) => s !== e.slug))} />
                      <span>{e.nome}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 }}>Itens avulsos (um por linha)</label>
              <textarea style={{ ...campo, minHeight: 70 }} value={extra} onChange={(e) => setExtra(e.target.value)}
                placeholder={"Ex.: Cabo reserva 50 m\nGerador portátil"} />
            </div>
            {atual && (
              <p className="detalhe" style={{ margin: 0, color: "#c2410c" }}>
                ⚠ Refazer a lista substitui o checklist atual desta etapa e perde as conferências já feitas.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn-azul btn-sec" onClick={() => setCompondo(false)}>Cancelar</button>
              <button className="btn-azul" disabled={salvando} onClick={criarChecklist}>
                {salvando ? "Salvando…" : "Salvar lista"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
