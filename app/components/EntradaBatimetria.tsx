"use client";

/** Digitação de batimetria no app (alternativa à importação da planilha).
 * Por vetor/ponto: água teórica, régua e sonar Esquerda/Central/Direita. Usa a
 * MESMA matemática e o mesmo montador da importação — garantindo resultado
 * idêntico. Gera o estado do medidor e devolve via onGerar. */
import { useMemo, useState } from "react";
import Modal from "./Modal";
import { montarDadosManuais, montarEstadoMedidor, GridManual } from "@/lib/asp/batimetria";

function num(v: string | undefined): number | null {
  if (!v || !v.trim()) return null;
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? null : n;
}
const cellStyle: React.CSSProperties = {
  width: 58, padding: "4px 5px", fontSize: 12, borderRadius: 6, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", textAlign: "center",
};
const paramStyle: React.CSSProperties = {
  width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};

export default function EntradaBatimetria({ onFechar, onGerar }: {
  onFechar: () => void;
  onGerar: (estado: Record<string, unknown>) => void;
}) {
  const [vetores, setVetores] = useState(5);
  const [pontos, setPontos] = useState(11);
  const [diametro, setDiametro] = useState("");
  const [unidade, setUnidade] = useState<"m" | "cm">("m");
  const [rov, setRov] = useState("0,26");
  const [peso, setPeso] = useState("0,15");
  const [agua, setAgua] = useState<Record<number, string>>({});
  const [regua, setRegua] = useState<Record<number, string>>({});
  const [sonar, setSonar] = useState<Record<string, string>>({}); // `${p}_${v}_${lat}`
  const [erro, setErro] = useState<string | null>(null);

  const rovN = num(rov) ?? 0.26;
  const pesoN = num(peso) ?? 0.15;

  function grid(): GridManual {
    const g: GridManual = {
      vetores, pontos,
      agua: Array.from({ length: vetores }, (_, v) => num(agua[v])),
      regua: Array.from({ length: pontos }, (_, p) => num(regua[p])),
      sonar: Array.from({ length: pontos }, (_, p) =>
        Array.from({ length: vetores }, (_, v) =>
          [0, 1, 2].map((lat) => num(sonar[`${p}_${v}_${lat}`]))
        )
      ),
    };
    return g;
  }

  const previa = useMemo(() => montarDadosManuais(grid(), { rov: rovN, peso: pesoN }), [vetores, pontos, agua, regua, sonar, rovN, pesoN]); // eslint-disable-line react-hooks/exhaustive-deps

  function gerar() {
    setErro(null);
    const diam = num(diametro);
    if (!diam || diam <= 0) { setErro("Informe o diâmetro do tanque."); return; }
    if (previa.invalidos > 0 && !confirm(`Atenção: ${previa.invalidos} de ${previa.totalValidacao} leituras estão INCORRETO na validação. Gerar mesmo assim?`)) return;
    const altura = previa.alturaSugerida || Math.max(0.5, ...previa.valores.flat().map((x) => (x || 0) + 0.5));
    const estado = montarEstadoMedidor(previa, { diametro: diam, altura, unidade });
    onGerar(estado);
  }

  const lats = ["E", "C", "D"];
  return (
    <Modal titulo="✍ Digitar batimetria" largo onFechar={onFechar}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Diâmetro *</label><input style={paramStyle} value={diametro} onChange={(e) => setDiametro(e.target.value)} inputMode="decimal" /></div>
          <div><label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Unidade</label>
            <select style={paramStyle} value={unidade} onChange={(e) => setUnidade(e.target.value as "m" | "cm")}><option value="m">m</option><option value="cm">cm</option></select>
          </div>
          <div><label className="detalhe" style={{ display: "block", marginBottom: 4 }}>ROV</label><input style={paramStyle} value={rov} onChange={(e) => setRov(e.target.value)} inputMode="decimal" /></div>
          <div><label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Peso régua</label><input style={paramStyle} value={peso} onChange={(e) => setPeso(e.target.value)} inputMode="decimal" /></div>
          <div><label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Vetores</label>
            <input type="number" min={1} max={24} style={paramStyle} value={vetores} onChange={(e) => setVetores(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} />
          </div>
          <div><label className="detalhe" style={{ display: "block", marginBottom: 4 }}>Pontos</label>
            <input type="number" min={1} max={60} style={paramStyle} value={pontos} onChange={(e) => setPontos(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          </div>
        </div>

        <p className="detalhe" style={{ margin: 0 }}>Espessura = (régua + peso) − (sonar + ROV). Célula vazia = ponto não medido. E/C/D = Esquerda/Central/Direita.</p>

        <div style={{ overflow: "auto", maxHeight: "50vh", border: "1px solid var(--borda)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "var(--escuro)", color: "#fff" }}>
                <th style={{ padding: 6 }}>Ponto</th>
                <th style={{ padding: 6 }}>Régua</th>
                {Array.from({ length: vetores }, (_, v) => (
                  <th key={v} colSpan={3} style={{ padding: 6, borderLeft: "2px solid var(--acento)" }}>
                    <div>v{v + 1}</div>
                    <input placeholder="água" value={agua[v] || ""} onChange={(e) => setAgua((a) => ({ ...a, [v]: e.target.value }))}
                      style={{ ...cellStyle, width: 150, marginTop: 4, background: "#ffffff22", color: "#fff", borderColor: "#ffffff55" }} inputMode="decimal" />
                  </th>
                ))}
              </tr>
              <tr style={{ position: "sticky", top: 54, background: "var(--bg-suave)" }}>
                <th></th><th></th>
                {Array.from({ length: vetores }, (_, v) => lats.map((l, li) => (
                  <th key={`${v}-${li}`} style={{ padding: 4, fontSize: 11, color: "var(--cinza)", borderLeft: li === 0 ? "2px solid var(--acento)" : undefined }}>{l}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: pontos }, (_, p) => (
                <tr key={p}>
                  <td style={{ padding: 4, textAlign: "center", fontWeight: 700, color: "var(--texto)" }}>{p}</td>
                  <td style={{ padding: 2 }}>
                    <input value={regua[p] || ""} onChange={(e) => setRegua((r) => ({ ...r, [p]: e.target.value }))} style={cellStyle} inputMode="decimal" />
                  </td>
                  {Array.from({ length: vetores }, (_, v) => lats.map((_l, lat) => (
                    <td key={`${v}-${lat}`} style={{ padding: 2, borderLeft: lat === 0 ? "2px solid var(--acento)" : undefined }}>
                      <input value={sonar[`${p}_${v}_${lat}`] || ""} onChange={(e) => setSonar((s) => ({ ...s, [`${p}_${v}_${lat}`]: e.target.value }))} style={cellStyle} inputMode="decimal" />
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="detalhe" style={{ margin: 0 }}>
            Validação: {previa.totalValidacao - previa.invalidos}/{previa.totalValidacao} corretas{previa.invalidos > 0 ? ` · ⚠️ ${previa.invalidos} incorretas` : ""}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            {erro && <span className="erro-texto" style={{ margin: 0 }}>{erro}</span>}
            <button className="btn-azul btn-sec" onClick={onFechar}>Cancelar</button>
            <button className="btn-azul" onClick={gerar}>Gerar e abrir no medidor</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
