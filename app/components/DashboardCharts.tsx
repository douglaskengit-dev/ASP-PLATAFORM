"use client";

/** D24/D33: gráficos leves em SVG puro (sem dependência externa) para o
 * Dashboard — funil de conversão, ranking em barras, barras por mês e donut.
 * Cada um aceita um `renderPopover` opcional: quando passado, cada
 * barra/segmento vira um HoverCard mostrando os processos daquela categoria.
 * BarrasHorizontais também aceita escala fixa, formato do valor e clique
 * (drill-down acessível por teclado: cada barra vira um <button>). */
import { ReactNode } from "react";
import HoverCard from "./HoverCard";

interface ItemBase { rotulo: string; valor: number }

export function BarrasHorizontais<T extends ItemBase>({
  dados,
  cor = "var(--primaria)",
  vazio = "Sem dados para exibir.",
  renderPopover,
  max: maxFixo,
  formatar = (v: number) => v.toLocaleString("pt-BR"),
  aoClicar,
  selecionado,
  detalhe,
  rotuloAria,
}: {
  dados: T[];
  cor?: string;
  vazio?: string;
  renderPopover?: (item: T, i: number) => ReactNode;
  /** Escala fixa (ex.: 1 para taxas 0..1); sem ela, o maior valor. */
  max?: number;
  /** Texto do valor à direita (padrão: número pt-BR). */
  formatar?: (valor: number, item: T) => string;
  /** Torna cada barra um botão (drill-down). */
  aoClicar?: (item: T, i: number) => void;
  /** Índice da barra ativa (com aoClicar). */
  selecionado?: number | null;
  /** Texto pequeno abaixo do rótulo (ex.: "3 paradas"). */
  detalhe?: (item: T) => ReactNode;
  /** Resumo para leitores de tela. */
  rotuloAria?: string;
}) {
  const max = maxFixo ?? Math.max(1, ...dados.map((d) => d.valor));
  if (!dados.length) return <p className="vazio">{vazio}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role={rotuloAria ? "group" : undefined} aria-label={rotuloAria}>
      {dados.map((d, i) => {
        const ativo = selecionado === i;
        const conteudo = (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 2 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere", textAlign: "left" }}>{d.rotulo}</span>
              <strong style={{ whiteSpace: "nowrap" }}>{formatar(d.valor, d)}</strong>
            </div>
            <div style={{ height: 10, background: "var(--track)", borderRadius: 5, overflow: "hidden" }} aria-hidden="true">
              <div style={{ height: "100%", width: `${Math.min(100, (d.valor / (max || 1)) * 100)}%`, background: cor, borderRadius: 5, transition: "width .3s" }} />
            </div>
            {detalhe && <div style={{ fontSize: 11, color: "var(--cinza)", marginTop: 2, textAlign: "left" }}>{detalhe(d)}</div>}
          </>
        );
        const barra = aoClicar ? (
          <button type="button" onClick={() => aoClicar(d, i)} aria-pressed={ativo}
            style={{
              display: "block", width: "100%", background: ativo ? "var(--primaria-claro)" : "transparent", color: "inherit",
              border: "1px solid", borderColor: ativo ? "var(--primaria)" : "transparent", borderRadius: 8,
              padding: "4px 6px", margin: "-4px -6px", boxSizing: "content-box", cursor: "pointer", font: "inherit",
            }}>
            {conteudo}
          </button>
        ) : <div>{conteudo}</div>;
        return renderPopover ? (
          <HoverCard key={i} conteudo={renderPopover(d, i)}>
            {barra}
          </HoverCard>
        ) : (
          <div key={i}>{barra}</div>
        );
      })}
    </div>
  );
}
