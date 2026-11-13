"use client";

/** Documentos da oportunidade no Follow-up: TR → Proposta → Ofício (o Ofício
 * só depois de a Proposta ser aprovada), análise do TR com IA e, na Visita
 * técnica, o Medidor de Sedimento. Mesmo comportamento do card antigo. */
import { useState } from "react";
import Link from "next/link";
import Modal from "@/app/components/Modal";
import AnaliseTRConteudo from "@/app/components/AnaliseTRConteudo";
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
  const [gerando, setGerando] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [enviandoMedicao, setEnviandoMedicao] = useState(false);
  const [analise, setAnalise] = useState(false);
  const [medidor, setMedidor] = useState(false);
  const temTR = p.arquivos.includes("tr");
  const temProposta = p.arquivos.includes("proposta");
  const temOficio = !!p.documentos?.oficio;
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
  async function gerarProposta() {
    setGerando(true);
    try {
      const r = await fetch(`/api/processos/${p.id}/gerar`, { method: "POST" });
      if (!r.ok) alert(`❌ ${(await r.json().catch(() => ({}))).erro || "Falha na geração."}`);
    } finally { setGerando(false); onMudou(); }
  }
  async function aprovarProposta() {
    setAprovando(true);
    try {
      const r = await fetch(`/api/processos/${p.id}/aprovar`, { method: "POST" });
      if (!r.ok) alert(`❌ ${(await r.json().catch(() => ({}))).erro || "Falha ao aprovar a proposta."}`);
    } finally { setAprovando(false); onMudou(); }
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

      <div>
        <span className="detalhe">Documentos (TR → Proposta → Ofício):</span>
        <div className="downloads">
          {temTR ? (
            <>
              <a className="btn-dl btn-sec" href={`/api/processos/${p.id}/download/tr`} title="TR enviado — clique para baixar">📎 TR (enviado)</a>
              <label className="btn-doc" title="Enviar outro arquivo no lugar do TR atual">
                ↻ Substituir TR
                <input type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => e.target.files?.[0] && enviar("tr", e.target.files[0])} />
              </label>
              {p.orgao?.id ? (
                <button type="button" className={p.cadastro_tr_status === "em_analise" ? "btn-doc destaque" : "btn-doc"} onClick={() => setAnalise(true)}
                  title={p.cadastro_tr_status === "em_analise" ? "A IA já analisou este TR — falta revisar e gerar o relatório final" : "Auditar o TR com IA — os achados alimentam a geração da proposta"}>
                  {p.cadastro_tr_status === "em_analise" ? "📝 Pré-análise pronta" : `🔍 Analisar TR${p.cadastro_tr_status === "concluida" ? " ✓" : ""}`}
                </button>
              ) : <span className="btn-doc pendente">🔍 Análise exige cliente</span>}
            </>
          ) : (
            <label className="btn-doc pendente" title="Enviar o Termo de Referência (PDF, DOCX ou TXT)">
              ＋ Enviar TR
              <input type="file" hidden accept=".pdf,.docx,.txt,.md" onChange={(e) => e.target.files?.[0] && enviar("tr", e.target.files[0])} />
            </label>
          )}

          {temProposta ? (
            <>
              <a className="btn-dl btn-sec" href={`/api/processos/${p.id}/download/proposta`} title="Baixar a proposta gerada (.docx)">📎 Proposta</a>
              <a className="btn-dl btn-sec" href={`/api/processos/${p.id}/download/resumo`} title="Baixar o resumo executivo (.docx)">📎 Resumo</a>
              {!p.proposta_aprovada && (
                <button type="button" className="btn-doc" disabled={aprovando} onClick={aprovarProposta} title="Aprovar a Proposta — libera a emissão do Ofício">
                  {aprovando ? "Aprovando..." : "✅ Aprovar Proposta"}
                </button>
              )}
            </>
          ) : temTR ? (
            <button type="button" className="btn-doc" disabled={gerando} onClick={gerarProposta}
              title="Analisar o TR com IA e gerar Proposta + Resumo (30–90 s)">
              {gerando ? "⏳ Gerando... (30–90 s)" : "⚙ Gerar Proposta"}
            </button>
          ) : <span className="btn-doc pendente" title="Envie o TR primeiro">Proposta (envie o TR primeiro)</span>}

          {temOficio ? (
            <a className="btn-dl btn-sec" href={`/api/processos/${p.id}/download/oficio`} title="Baixar o ofício">📎 Ofício</a>
          ) : p.proposta_aprovada ? (
            <Link className="btn-doc" href={`/oficio?processo=${p.id}`} title="Emitir o Ofício — a Proposta já foi aprovada">📝 Gerar Ofício</Link>
          ) : <span className="btn-doc pendente" title="Aprove a Proposta para liberar o Ofício">Ofício liberado após aprovar a Proposta</span>}
        </div>
      </div>

      {analise && p.orgao?.id && (
        <Modal titulo="Análise de Termo de Referência" onFechar={() => setAnalise(false)} zIndex={220}>
          <AnaliseTRConteudo orgaoId={p.orgao.id} processoId={p.id} onFinalizado={onMudou} />
        </Modal>
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
