"use client";

/** Faixa vermelha com o aviso do cliente.
 *
 * O aviso pertence ao CLIENTE, não ao projeto: exigências que valem para toda
 * ida a campo daquele contratante (crachá, horário de acesso, EPI específico).
 * Por isso aparece igual em todas as inspeções e projetos dele.
 *
 * Fica no topo — se precisasse rolar para ver, não cumpriria a função. A
 * edição é embutida na própria faixa, para quem descobre a exigência em campo
 * registrar na hora; o mesmo texto também é editável no cadastro do cliente. */
import { useCallback, useEffect, useState } from "react";

export default function AvisoCliente({ clienteId, compacto = false }: {
  clienteId?: string | null;
  /** Versão reduzida, para uso dentro de outro card. */
  compacto?: boolean;
}) {
  const [avisos, setAvisos] = useState("");
  const [podeEditar, setPodeEditar] = useState(false);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!clienteId) return;
    fetch(`/api/avisos?clienteId=${clienteId}`).then((r) => r.ok ? r.json() : {})
      .then((d: any) => { setAvisos(d.avisos || ""); setPodeEditar(!!d.podeEditar); })
      .catch(() => {});
  }, [clienteId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function salvar() {
    setSalvando(true); setErro(null);
    const res = await fetch("/api/avisos", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clienteId, avisos: rascunho }),
    });
    const d = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) { setErro(d?.erro || "Falha ao salvar o aviso."); return; }
    setAvisos(rascunho.trim());
    setEditando(false);
  }

  if (!clienteId) return null;
  // Sem aviso e sem permissão: não ocupa espaço na tela.
  if (!avisos && !podeEditar) return null;

  const moldura: React.CSSProperties = {
    border: "1px solid #dc2626",
    borderLeft: "5px solid #dc2626",
    background: "rgba(220, 38, 38, 0.07)",
    borderRadius: 10,
    padding: compacto ? "10px 12px" : "12px 14px",
    marginTop: compacto ? 10 : 16,
  };

  return (
    <div style={moldura}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ color: "#dc2626", fontSize: compacto ? 13 : 14 }}>
          ⚠ Avisos do cliente
        </strong>
        {podeEditar && !editando && (
          <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626", padding: "5px 10px", fontSize: 12 }}
            onClick={() => { setRascunho(avisos); setEditando(true); }}>
            {avisos ? "Editar" : "Adicionar aviso"}
          </button>
        )}
      </div>

      {editando ? (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            placeholder="Ex.: Entrada somente pelo portão 3. Exige crachá provisório na portaria. Trabalho em altura precisa de ASO válido."
            style={{
              width: "100%", minHeight: 90, padding: "9px 11px", borderRadius: 8,
              border: "1px solid #dc2626", background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
            }}
          />
          <p className="detalhe" style={{ margin: "4px 0 8px" }}>
            Este aviso vale para <strong>todos</strong> os projetos e inspeções deste cliente.
          </p>
          {erro && <p className="erro-texto" style={{ margin: "0 0 8px" }}>{erro}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn-azul btn-sec" disabled={salvando} onClick={() => setEditando(false)}>Cancelar</button>
            <button className="btn-azul" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando…" : "Salvar aviso"}
            </button>
          </div>
        </div>
      ) : avisos ? (
        <p style={{ margin: "6px 0 0", color: "var(--texto)", whiteSpace: "pre-wrap", fontSize: compacto ? 13 : 14 }}>
          {avisos}
        </p>
      ) : (
        <p className="detalhe" style={{ margin: "6px 0 0" }}>
          Nenhum aviso cadastrado para este cliente.
        </p>
      )}
    </div>
  );
}
