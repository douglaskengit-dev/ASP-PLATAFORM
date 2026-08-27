"use client";

/** ASP — Campos do tanque (dimensões, capacidade e material).
 *
 * Um só formulário para os dois lugares em que o tanque é cadastrado: a
 * criação da inspeção, dentro do projeto, e a correção depois, na própria
 * inspeção. O estado é todo texto (`TanqueForm`); quem salva é que converte,
 * com `erroDoTanque` + `normalizarTanque`. */

import { MATERIAIS_TANQUE } from "@/lib/asp/procedimentos";
import type { FormatoTanque, TanqueForm } from "@/lib/asp/tanque";

const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };

export default function FormularioTanque({
  valor, onChange, desabilitado = false,
}: {
  valor: TanqueForm;
  onChange: (t: TanqueForm) => void;
  desabilitado?: boolean;
}) {
  const set = (campo: keyof TanqueForm) => (e: { target: { value: string } }) =>
    onChange({ ...valor, [campo]: e.target.value });

  const circular = valor.formato === "circular";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label style={rotulo}>Formato</label>
        <select value={valor.formato} disabled={desabilitado}
          onChange={(e) => onChange({ ...valor, formato: e.target.value as FormatoTanque })}>
          <option value="circular">Circular (diâmetro)</option>
          <option value="retangular">Retangular (comprimento × largura)</option>
        </select>
      </div>

      {/* Dimensões: as do formato escolhido, sempre em metros. */}
      <div style={grade}>
        {circular ? (
          <div>
            <label style={rotulo}>Diâmetro (m)</label>
            <input value={valor.diametro} onChange={set("diametro")} disabled={desabilitado}
              inputMode="decimal" placeholder="ex.: 12,5" />
          </div>
        ) : (
          <>
            <div>
              <label style={rotulo}>Comprimento (m)</label>
              <input value={valor.comprimento} onChange={set("comprimento")} disabled={desabilitado}
                inputMode="decimal" placeholder="ex.: 10" />
            </div>
            <div>
              <label style={rotulo}>Largura (m)</label>
              <input value={valor.largura} onChange={set("largura")} disabled={desabilitado}
                inputMode="decimal" placeholder="ex.: 4" />
            </div>
          </>
        )}
        <div>
          <label style={rotulo}>Altura (m)</label>
          <input value={valor.altura} onChange={set("altura")} disabled={desabilitado}
            inputMode="decimal" placeholder="ex.: 8" />
        </div>
      </div>

      <div style={grade}>
        <div>
          <label style={rotulo}>Capacidade nominal (m³)</label>
          <input value={valor.capacidade} onChange={set("capacidade")} disabled={desabilitado}
            inputMode="decimal" placeholder="ex.: 1500" />
          <small style={{ color: "var(--cinza)" }}>Dado de placa do tanque.</small>
        </div>
        <div>
          <label style={rotulo}>Material</label>
          <select value={valor.material} onChange={set("material")} disabled={desabilitado}>
            <option value="">— Selecione o material —</option>
            {MATERIAIS_TANQUE.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
