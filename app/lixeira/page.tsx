"use client";

/** ASP — Lixeira: tudo que foi excluído e ainda é recuperável.
 *
 * Reúne num lugar só o que antes estava espalhado (projetos, inspeções,
 * clientes, medições e relatórios). Cada item mostra quantos dias faltam
 * para a exclusão definitiva, que é de 30 dias após a remoção. */
import { useCallback, useEffect, useMemo, useState } from "react";

interface Item {
  tipo: "projeto" | "inspecao" | "cliente" | "medicao" | "relatorio";
  dados: any;
  excluido_em: string;
  diasRestantes: number;
}

const ROTULO: Record<Item["tipo"], string> = {
  projeto: "Projetos", inspecao: "Inspeções", cliente: "Clientes",
  medicao: "Medições", relatorio: "Relatórios",
};
const ORDEM: Item["tipo"][] = ["projeto", "inspecao", "cliente", "medicao", "relatorio"];

/** Texto que identifica o item na lista, conforme o tipo. */
function descrever(it: Item): string {
  const d = it.dados || {};
  switch (it.tipo) {
    case "projeto": return d.codigo_projeto || d.pedido_compra || "Projeto sem código";
    case "inspecao": return `${d.identificacao || "Inspeção"} · fase ${d.fase ?? "—"}`;
    case "cliente": return `${d.razao_social || "Cliente"}${d.cidade ? ` · ${d.cidade}/${d.uf || ""}` : ""}`;
    case "medicao": return `Medição (${d.tipo || "sedimento"})`;
    case "relatorio": return `Relatório ${d.tipo || ""} v${d.versao ?? "?"} — ${d.status || ""}`;
    default: return "Item";
  }
}

export default function LixeiraPage() {
  const [itens, setItens] = useState<Item[]>([]);
  const [podeGerenciar, setPodeGerenciar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetch("/api/lixeira").then((r) => r.ok ? r.json() : {})
      .then((d: any) => { setItens(d.itens || []); setPodeGerenciar(!!d.podeGerenciar); })
      .finally(() => setCarregando(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function restaurar(it: Item) {
    setOcupado(it.dados.id); setErro(null);
    const res = await fetch("/api/lixeira", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: it.tipo, id: it.dados.id }),
    });
    const d = await res.json().catch(() => ({}));
    setOcupado(null);
    if (!res.ok) { setErro(d?.erro || "Falha ao restaurar."); return; }
    carregar();
  }

  async function excluirDefinitivo(it: Item) {
    if (!confirm(`Excluir DEFINITIVAMENTE "${descrever(it)}"?\n\nEsta ação não pode ser desfeita.`)) return;
    setOcupado(it.dados.id); setErro(null);
    const res = await fetch(`/api/lixeira?tipo=${it.tipo}&id=${it.dados.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setOcupado(null);
    if (!res.ok) { setErro(d?.erro || "Falha ao excluir."); return; }
    carregar();
  }

  const grupos = useMemo(
    () => ORDEM.map((t) => ({ tipo: t, itens: itens.filter((i) => i.tipo === t) })).filter((g) => g.itens.length > 0),
    [itens]
  );

  if (carregando) return <div className="page-larga"><p className="vazio">Carregando…</p></div>;

  return (
    <div className="page-larga">
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Lixeira</h1>
        <p className="detalhe" style={{ margin: "4px 0 0" }}>
          Itens excluídos ficam aqui por 30 dias e podem ser restaurados. Depois desse prazo são
          apagados definitivamente.
        </p>
      </header>
      {erro && <p className="erro-texto">{erro}</p>}
      {!podeGerenciar && (
        <p className="detalhe">Somente consulta — restaurar e excluir é restrito a Comercial, Gerência, Admin ou Coordenador.</p>
      )}

      {itens.length === 0 ? (
        <div className="card"><p className="vazio" style={{ margin: 0 }}>A lixeira está vazia.</p></div>
      ) : grupos.map((g) => (
        <div className="card" key={g.tipo}>
          <h3 style={{ marginTop: 0 }}>{ROTULO[g.tipo]} ({g.itens.length})</h3>
          {g.itens.map((it) => (
            <div key={`${it.tipo}-${it.dados.id}`} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              padding: "10px 0", borderBottom: "1px solid var(--borda)", flexWrap: "wrap",
            }}>
              <div>
                <strong style={{ color: "var(--texto)" }}>{descrever(it)}</strong>
                <span className="detalhe" style={{ display: "block" }}>
                  Excluído em {new Date(it.excluido_em).toLocaleString("pt-BR")} ·{" "}
                  <span style={{ color: it.diasRestantes <= 5 ? "#c2410c" : undefined, fontWeight: it.diasRestantes <= 5 ? 700 : 400 }}>
                    {it.diasRestantes === 0 ? "será apagado a qualquer momento" : `${it.diasRestantes} dia(s) para a exclusão definitiva`}
                  </span>
                </span>
              </div>
              {podeGerenciar && (
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="btn-dl" disabled={ocupado === it.dados.id} onClick={() => restaurar(it)}>
                    {ocupado === it.dados.id ? "…" : "↺ Restaurar"}
                  </button>
                  <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }}
                    disabled={ocupado === it.dados.id} onClick={() => excluirDefinitivo(it)}>
                    Excluir definitivamente
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
