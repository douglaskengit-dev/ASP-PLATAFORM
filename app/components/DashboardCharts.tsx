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

export function BarrasMensais<T extends ItemBase>({
  dados,
  renderPopover,
}: {
  dados: T[];
  renderPopover?: (item: T, i: number) => ReactNode;
}) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  if (!dados.length) return <p className="vazio">Sem processos no período.</p>;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140, padding: "4px 2px" }}>
      {dados.map((d, i) => {
        const coluna = (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--primaria)" }}>{d.valor || ""}</span>
            <div
              style={{
                width: "100%",
                maxWidth: 28,
                height: `${Math.max(4, (d.valor / max) * 100)}%`,
                background: "var(--primaria)",
                borderRadius: "4px 4px 0 0",
              }}
            />
            <span style={{ fontSize: 10, color: "var(--cinza)", whiteSpace: "nowrap" }}>{d.rotulo}</span>
          </div>
        );
        return renderPopover ? (
          <HoverCard key={i} largura={220} estiloTrigger={{ flex: 1, height: "100%" }} conteudo={renderPopover(d, i)}>
            {coluna}
          </HoverCard>
        ) : (
          <div key={i} style={{ flex: 1, height: "100%" }}>{coluna}</div>
        );
      })}
    </div>
  );
}

interface ItemDonut extends ItemBase { cor: string }

export function Donut<T extends ItemDonut>({
  dados,
  renderPopover,
}: {
  dados: T[];
  renderPopover?: (item: T, i: number) => ReactNode;
}) {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  if (!total) return <p className="vazio">Sem dados para exibir.</p>;

  const raio = 45;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={120} height={120} viewBox="0 0 120 120">
        <g transform="rotate(-90 60 60)">
          <circle cx={60} cy={60} r={raio} fill="none" stroke="var(--track)" strokeWidth={16} />
          {dados.map((d, i) => {
            const fracao = d.valor / total;
            const comprimento = fracao * circunferencia;
            const offset = acumulado;
            acumulado += comprimento;
            return (
              <circle
                key={i}
                cx={60}
                cy={60}
                r={raio}
                fill="none"
                stroke={d.cor}
                strokeWidth={16}
                strokeDasharray={`${comprimento} ${circunferencia - comprimento}`}
                strokeDashoffset={-offset}
              />
            );
          })}
        </g>
        <text x={60} y={64} textAnchor="middle" fontSize={20} fontWeight={800} fill="var(--texto)">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {dados.map((d, i) => {
          const linha = (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: d.cor, display: "inline-block" }} />
              <span>{d.rotulo}</span>
              <strong>{d.valor}</strong>
              <span className="detalhe">({total ? Math.round((d.valor / total) * 100) : 0}%)</span>
            </div>
          );
          return renderPopover ? (
            <HoverCard key={i} conteudo={renderPopover(d, i)}>
              {linha}
            </HoverCard>
          ) : (
            <div key={i}>{linha}</div>
          );
        })}
      </div>
    </div>
  );
}
