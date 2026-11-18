"use client";

/** Anexos da oportunidade no Follow-up: na Visita técnica, o Medidor de
 * Sedimento (ferramenta + relatório PDF anexado). */
import { useState } from "react";
import Modal from "@/app/components/Modal";
import { etapaTemMedidorSedimento } from "@/lib/processos/etapas";

export interface ProcessoDocs {
  id: string;
  orgao: { id: string } | null;
  arquivos: string[];
  documentos: { oficio?: { nome: string } };
  cadastro_tr_status: "em_analise" | "concluida" | null;
  proposta_aprovada: boolean;
}

export default function DocumentosProcesso({ p, nomeEtapa, onMudou }: { p: ProcessoDocs; nomeEtapa: string; onMudou: () => void }) {
  const [enviandoMedicao, setEnviandoMedicao] = useState(false);
  const [medidor, setMedidor] = useState(false);
  const temMedicao = p.arquivos.includes("medicao_sedimento");

  async function enviar(rota: string, arquivo: File) {
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    const r = await fetch(`/api/processos/${p.id}/${rota}`, { method: "POST", body: fd });
    if (!r.ok) alert((await r.json().catch(() => ({}))).erro || "Erro ao enviar o arquivo.");
    onMudou();
  }
  async function enviarMedicao(arquivo: File) {
    setEnviandoMedicao(true);
    try { await enviar("medicao", arquivo); } finally { setEnviandoMedicao(false); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {etapaTemMedidorSedimento(nomeEtapa) && (
        <div style={{ border: "1px solid var(--borda)", borderRadius: 8, padding: 10, background: "var(--bg-suave)", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="detalhe" style={{ fontWeight: 700 }}>📐 Medidor de Sedimento</span>
          <div className="downloads">
            <button type="button" className="btn-doc" onClick={() => setMedidor(true)}
              title="Abrir a ferramenta de medição — cálculo local, exporte o PDF ao final">📐 Abrir ferramenta</button>
            {temMedicao ? (
              <>
                <a className="btn-dl btn-sec" href={`/api/processos/${p.id}/download/medicao_sedimento`}>📎 Relatório anexado</a>
                <label className="btn-doc" title="Substituir o relatório anexado por outro PDF">
                  ↻ Substituir relatório
                  <input type="file" hidden accept=".pdf" onChange={(e) => e.target.files?.[0] && enviarMedicao(e.target.files[0])} />
                </label>
              </>
            ) : (
              <label className="btn-doc pendente" title="Depois de exportar o PDF pela ferramenta, anexe-o aqui">
                {enviandoMedicao ? "Enviando..." : "＋ Anexar relatório (PDF)"}
                <input type="file" hidden accept=".pdf" disabled={enviandoMedicao}
                  onChange={(e) => e.target.files?.[0] && enviarMedicao(e.target.files[0])} />
              </label>
            )}
          </div>
        </div>
      )}

      {medidor && (
        <Modal titulo="📐 Medidor de Sedimento" onFechar={() => setMedidor(false)} largo semPadding zIndex={220}>
          <iframe src="/ferramentas/medidor-sedimento.html" title="Medidor de Sedimento"
            style={{ width: "100%", height: "80vh", border: "none", display: "block" }} />
        </Modal>
      )}
    </div>
  );
}
