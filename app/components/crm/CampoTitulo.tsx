"use client";

/** Título da oportunidade: um Procedimento do Catálogo (o título é o nome
 * dele) ou "Outros", que libera uma descrição livre. */
import { useEffect, useState } from "react";
import type { Procedimento } from "./tipos";
import s from "./crm.module.css";

const OUTROS = "__outros";

export default function CampoTitulo({ procedimentos, procedimentoId, titulo, onChange, autoFocus }: {
  procedimentos: Procedimento[];
  procedimentoId: string;
  titulo: string;
  onChange: (v: { procedimentoId: string; titulo: string }) => void;
  autoFocus?: boolean;
}) {
  const [outros, setOutros] = useState(!procedimentoId && !!titulo);
  const [focar, setFocar] = useState(false);
  // Desfazer/recarregar: o modo acompanha o valor recebido.
  useEffect(() => {
    if (procedimentoId) setOutros(false);
    else if (titulo) setOutros(true);
  }, [procedimentoId, titulo]);

  // Desativados somem das escolhas novas, mas o que já está escolhido fica.
  const opcoes = procedimentos.filter((p) => p.ativo !== false || p.id === procedimentoId);
  const valor = procedimentoId || (outros ? OUTROS : "");

  function escolher(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === OUTROS) { setOutros(true); setFocar(true); onChange({ procedimentoId: "", titulo: "" }); return; }
    setOutros(false);
    const p = procedimentos.find((x) => x.id === v);
    onChange({ procedimentoId: p?.id || "", titulo: p?.nome || "" });
  }

  return (
    <>
      <label className={s.campo} style={{ gridColumn: "1 / -1" }}>
        <span>Título (procedimento) *</span>
        <select value={valor} required onChange={escolher} autoFocus={autoFocus}>
          <option value="">— escolha —</option>
          {opcoes.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}{p.codigo ? ` (${p.codigo})` : ""}{p.ativo === false ? " — desativado" : ""}</option>
          ))}
          <option value={OUTROS}>Outros…</option>
        </select>
      </label>
      {outros && (
        <label className={s.campo} style={{ gridColumn: "1 / -1" }}>
          <span>Descrição *</span>
          <input value={titulo} maxLength={200} required autoFocus={focar}
            onChange={(e) => onChange({ procedimentoId: "", titulo: e.target.value })}
            placeholder="Ex.: Inspeção da adutora" />
        </label>
      )}
    </>
  );
}
