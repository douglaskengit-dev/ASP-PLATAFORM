"use client";

/** Painel de subetapas de revisão/aprovação de "Relatório" e "Relatório de
 * Limpeza": envio p/ revisão → revisão → aprovação → aprovado, com desvio
 * para "reenvio necessário" se a revisão reprovar. Ver lib/processos/subetapas.ts. */
import { useState } from "react";
import { AcaoSubetapa, GrupoSubetapas, SUBETAPAS, nomeSubetapa, podeExecutarAcao } from "@/lib/processos/subetapas";

function fmtData(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function SubetapaRelatorio({
  processoId,
  grupo,
  perfil,
  onAcao,
}: {
  processoId: string;
  grupo: GrupoSubetapas;
  perfil: "admin" | "editor" | "visualizador";
  onAcao: (id: string, acao: AcaoSubetapa, motivo?: string) => Promise<void>;
}) {
  const [executando, setExecutando] = useState<AcaoSubetapa | null>(null);
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function executar(acao: AcaoSubetapa, m?: string) {
    setExecutando(acao);
    try {
      await onAcao(processoId, acao, m);
      setReprovando(false);
      setMotivo("");
    } finally {
      setExecutando(null);
    }
  }

  const atual = grupo.atual;
  const indiceAtual = SUBETAPAS.findIndex((s) => s.chave === atual);
  const reenvioNecessario = atual === "reenvio_necessario";
  const bloqueado = executando !== null;

  return (
    <div
      style={{
        width: "100%",
        border: "1px solid var(--borda)",
        borderRadius: 8,
        padding: 10,
        background: "var(--bg-suave)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span className="detalhe" style={{ fontWeight: 700 }}>📝 Subetapas do relatório</span>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {SUBETAPAS.map((s, i) => {
          const passouOuAtual = i <= indiceAtual;
          return (
            <span
              key={s.chave}
              className="fu-badge manual"
              style={{ opacity: passouOuAtual ? 1 : 0.5, fontWeight: atual === s.chave ? 700 : 400 }}
            >
              {i + 1}. {s.nome}
            </span>
          );
        })}
        {reenvioNecessario && (
          <span className="fu-badge" style={{ background: "#f8d7da", color: "#842029" }}>
            🔁 Reenvio necessário
          </span>
        )}
        {!atual && <span className="detalhe">Ainda não enviado para revisão.</span>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(atual === null || reenvioNecessario) && podeExecutarAcao(perfil, "enviar") && (
          <button type="button" className="btn-doc" disabled={bloqueado} onClick={() => executar("enviar")}>
            {executando === "enviar" ? "Enviando..." : reenvioNecessario ? "↻ Reenviar para revisão" : "📤 Enviar para revisão"}
          </button>
        )}
        {atual === "envio" && podeExecutarAcao(perfil, "revisar_aprovar") && (
          <button type="button" className="btn-azul" disabled={bloqueado} onClick={() => executar("revisar_aprovar")}>
            {executando === "revisar_aprovar" ? "Salvando..." : "✓ Revisão OK — encaminhar p/ aprovação"}
          </button>
        )}
        {atual === "envio" && podeExecutarAcao(perfil, "revisar_reprovar") && !reprovando && (
          <button type="button" className="btn-doc" disabled={bloqueado} onClick={() => setReprovando(true)}>
            ✗ Reprovar
          </button>
        )}
        {atual === "aprovacao" && podeExecutarAcao(perfil, "aprovar") && (
          <button type="button" className="btn-azul" disabled={bloqueado} onClick={() => executar("aprovar")}>
            {executando === "aprovar" ? "Aprovando..." : "✅ Aprovar relatório"}
          </button>
        )}
      </div>

      {reprovando && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da reprovação *"
            style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
            autoFocus
          />
          <button
            type="button"
            className="btn-doc"
            disabled={bloqueado || !motivo.trim()}
            onClick={() => executar("revisar_reprovar", motivo)}
          >
            {executando === "revisar_reprovar" ? "Salvando..." : "Confirmar reprovação"}
          </button>
          <button type="button" className="btn-doc" onClick={() => { setReprovando(false); setMotivo(""); }}>
            Cancelar
          </button>
        </div>
      )}

      {grupo.historico.length > 0 && (
        <details>
          <summary className="detalhe" style={{ cursor: "pointer" }}>Histórico ({grupo.historico.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {grupo.historico.map((h, i) => (
              <span key={i} className="detalhe">
                {nomeSubetapa(h.para)} — {h.responsavel_nome} em {fmtData(h.em)}
                {h.motivo ? ` — "${h.motivo}"` : ""}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
