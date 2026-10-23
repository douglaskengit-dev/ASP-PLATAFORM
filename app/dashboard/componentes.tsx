"use client";

/** Peças do Dashboard de Operações: seção com definição (i), KPI, alternância
 * gráfico/tabela, esqueleto de carregamento e formatação pt-BR. */
import { ReactNode, useId, useState } from "react";
import Link from "next/link";
import type { RefOS } from "@/lib/asp/dashboard";
import { DEFINICOES, type ChaveDef } from "./definicoes";
import s from "./dashboard.module.css";

// ── Formatação ───────────────────────────────────────────────────────────────

const fmtInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export const num = (v: number | null | undefined) => (v == null ? "—" : fmtInt.format(v));
export const dec = (v: number | null | undefined) => (v == null ? "—" : fmt1.format(v));
export const pct = (v: number | null | undefined) => (v == null ? "—" : fmtPct.format(v));
/** "AAAA-MM-DD" → "dd/mm". */
export const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
/** "AAAA-MM-DD" → "dd/mm/aaaa". */
export const ddmmaa = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
export const dias = (n: number | null | undefined) => (n == null ? "—" : `${num(n)} dia${n === 1 ? "" : "s"}`);
export const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`;

export const ROT_TIPO: Record<string, string> = { inspecao: "inspeção", execucao: "execução" };

// ── Definição (i) ────────────────────────────────────────────────────────────

/** Botão (i) que abre a definição do indicador logo abaixo — funciona com
 *  toque e teclado (o HoverCard antigo dependia do mouse). */
export function useDefinicao(chave: ChaveDef) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  const def = DEFINICOES[chave];
  const botao = (
    <button type="button" className={s.info} aria-expanded={aberta} aria-controls={id}
      aria-label={`${aberta ? "Esconder" : "Mostrar"} a definição de ${def.titulo}`} onClick={() => setAberta((v) => !v)}>
      i
    </button>
  );
  const texto = aberta ? <p id={id} className={s.definicao}>{def.texto}</p> : <span id={id} hidden />;
  return { botao, texto };
}

export function Base({ periodo }: { periodo?: boolean }) {
  return <span className={s.base} title={periodo ? "Depende do período escolhido" : "Fotografia de agora; não depende do período"}>{periodo ? "No período" : "Agora"}</span>;
}

// ── KPI ──────────────────────────────────────────────────────────────────────

export function Kpi({ def, valor, unidade, sub, periodo, alerta }: {
  def: ChaveDef; valor: ReactNode; unidade?: string; sub?: ReactNode; periodo?: boolean; alerta?: boolean;
}) {
  const { botao, texto } = useDefinicao(def);
  return (
    <div className={`${s.kpi}${alerta ? ` ${s.kpiAlerta}` : ""}`}>
      <div className={s.kpiTopo}>
        <span className={s.kpiNome}>{DEFINICOES[def].titulo}</span>
        {botao}
      </div>
      <span className={s.kpiValor}>{valor}{unidade && <small>{unidade}</small>}</span>
      {sub && <span className={s.kpiSub}>{sub}</span>}
      <span><Base periodo={periodo} /></span>
      {texto}
    </div>
  );
}

// ── Seção ────────────────────────────────────────────────────────────────────

export function Secao({ def, titulo, periodo, acoes, children, contador }: {
  def: ChaveDef; titulo?: string; periodo?: boolean; acoes?: ReactNode; children: ReactNode; contador?: number;
}) {
  const { botao, texto } = useDefinicao(def);
  return (
    <section className={s.secao} aria-label={titulo || DEFINICOES[def].titulo}>
      <div className={s.secaoTopo}>
        <h2 className={s.secaoTitulo}>
          {titulo || DEFINICOES[def].titulo}
          {contador != null && <span className={s.chip}>{num(contador)}</span>}
          <Base periodo={periodo} />
        </h2>
        <div className={s.secaoAcoes}>{acoes}{botao}</div>
      </div>
      {texto}
      {children}
    </section>
  );
}

/** Alternância Gráfico/Tabela (texto alternativo dos gráficos). */
export function useVisao() {
  const [tabela, setTabela] = useState(false);
  const botao = (
    <button type="button" className={s.botaoSec} style={{ padding: "3px 8px", fontSize: 12 }} aria-pressed={tabela} onClick={() => setTabela((v) => !v)}>
      {tabela ? "Ver gráfico" : "Ver tabela"}
    </button>
  );
  return { tabela, botao };
}

export function Tabela({ legenda, colunas, linhas }: { legenda: string; colunas: string[]; linhas: ReactNode[][] }) {
  return (
    <div className={s.tabelaWrap}>
      <table className={s.tabela}>
        <caption>{legenda}</caption>
        <thead><tr>{colunas.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, j) => (j === 0 ? <th key={j} scope="row" style={{ fontWeight: 500, color: "inherit", fontSize: 13 }}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ── Links ────────────────────────────────────────────────────────────────────

export function LinkOS({ os, secao }: { os: RefOS; secao?: string }) {
  return (
    <span>
      <Link className={s.link} href={`/inspecoes/${os.id}${secao ? `#${secao}` : ""}`}>OS {os.identificacao}</Link>
      <span className={s.sub}>
        <Link className={s.link} style={{ fontWeight: 400 }} href={`/projetos/${os.projetoId}`}>{os.projeto}</Link>
        {os.cliente ? ` · ${os.cliente}` : ""} · fase {os.fase}
      </span>
    </span>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className={s.vazio}>{children}</p>;
}

/** Lista que mostra só as primeiras `inicial` e expande ("Ver todas"). */
export function ListaCurta<T>({ itens, total, inicial = 5, chave, render, className }: {
  itens: T[]; total?: number; inicial?: number; chave: (x: T) => string; render: (x: T) => ReactNode; className?: string;
}) {
  const [todas, setTodas] = useState(false);
  const vis = todas ? itens : itens.slice(0, inicial);
  return (
    <>
      <ul className={className ?? s.lista}>{vis.map((x) => <li key={chave(x)}>{render(x)}</li>)}</ul>
      {itens.length > inicial && (
        <button type="button" className={s.botaoSec} style={{ marginTop: 6, alignSelf: "flex-start", padding: "3px 10px", fontSize: 12 }}
          aria-expanded={todas} onClick={() => setTodas((v) => !v)}>
          {todas ? "Mostrar menos" : `Ver todas (${num(itens.length)})`}
        </button>
      )}
      {todas && total != null && <Mais mostrados={itens.length} total={total} />}
    </>
  );
}

export function Mais({ mostrados, total }: { mostrados: number; total: number }) {
  if (total <= mostrados) return null;
  return <p className={s.mais}>Mostrando {num(mostrados)} de {num(total)}.</p>;
}

// ── Carregamento ─────────────────────────────────────────────────────────────

export function Esqueleto() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className={s.srOnly}>Carregando o Dashboard…</span>
      <div className={s.kpis}>
        {Array.from({ length: 8 }, (_, i) => <div key={i} className={s.esqueleto} />)}
      </div>
      <div className={s.grade2}>
        <div className={`${s.esqueleto} ${s.esqueletoAlto}`} />
        <div className={`${s.esqueleto} ${s.esqueletoAlto}`} />
      </div>
      <div className={s.grade3}>
        <div className={`${s.esqueleto} ${s.esqueletoAlto}`} />
        <div className={`${s.esqueleto} ${s.esqueletoAlto}`} />
        <div className={`${s.esqueleto} ${s.esqueletoAlto}`} />
      </div>
    </div>
  );
}
