"use client";

/** Personalização dos Dashboards, por usuário: quais KPIs e quadros aparecem
 * (lista "Personalizar"), quais estão fixados no topo (📌) e o que está
 * minimizado. Fica no banco (gp_dashboard_preferencias, cada um vê a sua) e
 * vale em qualquer aparelho. Sem a migração 20261125100000 (ou sem rede),
 * fica só neste navegador. Os KPIs e quadros se registram ao renderizar, então
 * a lista sempre mostra o que o Dashboard tem. Sem o provedor, tudo aparece. */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PainelId } from "@/lib/asp/dashboard-acesso";
import { DEFINICOES, type ChaveDef } from "./definicoes";
import s from "./dashboard.module.css";

/** KPIs que aparecem de início (o resto fica na lista "Personalizar"). */
export const KPIS_PADRAO: Record<PainelId, ChaveDef[]> = {
  operacoes: ["osAndamento", "leadTime", "aguardandoAprovacao", "encerramento"],
  gerencia: ["gConcluidas", "gPrazoTotal", "gCarteira", "gRetrabalho"],
  comercial: ["cPipeline", "cPrevisao", "cTaxaGanho", "cFollowups"],
};

type Tipo = "kpi" | "secao";
/** Id de fixado: o mesmo indicador pode ter KPI e quadro ("k:cFunil", "s:cFunil"). */
type IdFixado = `${"k" | "s"}:${ChaveDef}`;
const idDe = (def: ChaveDef, tipo: Tipo): IdFixado => `${tipo === "kpi" ? "k" : "s"}:${def}`;
interface Estado {
  /** KPIs visíveis; null = padrão do painel. */
  kpis: ChaveDef[] | null;
  /** Quadros escondidos. */
  secoesOcultas: ChaveDef[];
  /** KPIs e quadros fixados no topo, na ordem em que foram fixados. */
  fixados: IdFixado[];
  /** Quadros minimizados (só o título). */
  minimizadas: ChaveDef[];
  /** Faixa de KPIs minimizada. */
  kpisMinimizados: boolean;
}
const VAZIO: Estado = { kpis: null, secoesOcultas: [], fixados: [], minimizadas: [], kpisMinimizados: false };

/** Configuração gravada → estado, descartando chaves que não existem mais. */
function normalizar(e: any): Estado {
  if (!e || typeof e !== "object") return VAZIO;
  const lista = (v: unknown) => (Array.isArray(v) ? Array.from(new Set(v.filter((x): x is ChaveDef => typeof x === "string" && x in DEFINICOES))) : []);
  return {
    kpis: Array.isArray(e.kpis) ? lista(e.kpis) : null,
    secoesOcultas: lista(e.secoesOcultas), minimizadas: lista(e.minimizadas),
    fixados: Array.isArray(e.fixados)
      ? Array.from(new Set(e.fixados.filter((x: unknown): x is IdFixado => typeof x === "string" && /^[ks]:/.test(x) && x.slice(2) in DEFINICOES)))
      : [],
    kpisMinimizados: e.kpisMinimizados === true,
  };
}
const ehPadrao = (e: Estado) => JSON.stringify(e) === JSON.stringify(VAZIO);

interface Ctx {
  painel: PainelId;
  estado: Estado;
  itens: { def: ChaveDef; tipo: Tipo }[];
  registrar: (def: ChaveDef, tipo: Tipo) => void;
  visivel: (def: ChaveDef, tipo: Tipo) => boolean;
  fixado: (def: ChaveDef, tipo: Tipo) => boolean;
  minimizada: (def: ChaveDef) => boolean;
  alternarVisivel: (def: ChaveDef, tipo: Tipo) => void;
  alternarFixado: (def: ChaveDef, tipo: Tipo) => void;
  alternarMinimizada: (def: ChaveDef) => void;
  mudar: (f: (e: Estado) => Estado) => void;
  /** Onde os quadros fixados aparecem (topo do Dashboard). */
  alvoFixados: HTMLElement | null;
  setAlvoFixados: (el: HTMLElement | null) => void;
  /** Só neste navegador (sem a tabela no banco ou sem rede). */
  soLocal: boolean;
}
const Contexto = createContext<Ctx | null>(null);
export const usePersonalizacao = () => useContext(Contexto);

const chaveLocal = (p: PainelId) => `asp-dashboard-${p}-v1`;
function lerLocal(p: PainelId): Estado {
  try { return normalizar(JSON.parse(window.localStorage.getItem(chaveLocal(p)) || "null")); } catch { return VAZIO; }
}
function gravarLocal(p: PainelId, e: Estado) {
  try { window.localStorage.setItem(chaveLocal(p), JSON.stringify(e)); } catch { /* sem armazenamento */ }
}

export function Personalizacao({ painel, children }: { painel: PainelId; children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>(VAZIO);
  const [soLocal, setSoLocal] = useState(false);
  const [itens, setItens] = useState<{ def: ChaveDef; tipo: Tipo }[]>([]);
  const [alvoFixados, setAlvoFixados] = useState<HTMLElement | null>(null);
  const [pronto, setPronto] = useState(false);
  const modoLocal = useRef(false);
  /** O que está gravado (carregado ou salvo por último): não regrava igual. */
  const salvo = useRef("");

  // Carrega a configuração do usuário (banco); sem a tabela, a do navegador.
  useEffect(() => {
    let vivo = true;
    setPronto(false);
    const aplicar = (e: Estado, local: boolean) => {
      modoLocal.current = local; setSoLocal(local); salvo.current = JSON.stringify(e); setEstado(e); setPronto(true);
    };
    fetch(`/api/dashboard/preferencias?painel=${painel}`, { cache: "no-store" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!vivo) return;
        if (!ok || d.semTabela) aplicar(lerLocal(painel), true);
        else aplicar(normalizar(d.config), false);
      })
      .catch(() => { if (vivo) aplicar(lerLocal(painel), true); });
    return () => { vivo = false; };
  }, [painel]);

  // Grava 600 ms depois da última mudança.
  useEffect(() => {
    if (!pronto) return;
    const json = JSON.stringify(estado);
    if (json === salvo.current) return;
    salvo.current = json;
    if (modoLocal.current) { gravarLocal(painel, estado); return; }
    const t = setTimeout(() => {
      fetch("/api/dashboard/preferencias", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ painel, config: ehPadrao(estado) ? null : estado }),
      }).catch(() => gravarLocal(painel, estado));
    }, 600);
    return () => clearTimeout(t);
  }, [estado, painel, pronto]);

  const registrar = useCallback((def: ChaveDef, tipo: Tipo) => {
    setItens((l) => (l.some((x) => x.def === def && x.tipo === tipo) ? l : [...l, { def, tipo }]));
  }, []);
  const tira = <T extends string>(l: T[], d: T) => l.filter((x) => x !== d);
  const kpisVisiveis = estado.kpis ?? KPIS_PADRAO[painel];
  const valor = useMemo<Ctx>(() => ({
    painel, estado, itens, registrar, alvoFixados, setAlvoFixados, soLocal,
    visivel: (def, tipo) => (tipo === "kpi" ? kpisVisiveis.includes(def) : !estado.secoesOcultas.includes(def)),
    fixado: (def, tipo) => estado.fixados.includes(idDe(def, tipo)),
    minimizada: (def) => estado.minimizadas.includes(def),
    alternarVisivel: (def, tipo) => setEstado((e) => {
      if (tipo === "kpi") {
        const atual = e.kpis ?? KPIS_PADRAO[painel];
        return atual.includes(def) ? { ...e, kpis: tira(atual, def), fixados: tira(e.fixados, idDe(def, tipo)) } : { ...e, kpis: [...atual, def] };
      }
      return e.secoesOcultas.includes(def)
        ? { ...e, secoesOcultas: tira(e.secoesOcultas, def) }
        : { ...e, secoesOcultas: [...e.secoesOcultas, def], fixados: tira(e.fixados, idDe(def, tipo)) };
    }),
    // Fixar também mostra (KPI escondido ou quadro oculto).
    alternarFixado: (def, tipo) => setEstado((e) => {
      const id = idDe(def, tipo);
      if (e.fixados.includes(id)) return { ...e, fixados: tira(e.fixados, id) };
      const atual = e.kpis ?? KPIS_PADRAO[painel];
      return {
        ...e, fixados: [...e.fixados, id],
        kpis: tipo === "kpi" && !atual.includes(def) ? [...atual, def] : e.kpis,
        secoesOcultas: tipo === "secao" ? tira(e.secoesOcultas, def) : e.secoesOcultas,
        minimizadas: tipo === "secao" ? tira(e.minimizadas, def) : e.minimizadas,
      };
    }),
    alternarMinimizada: (def) => setEstado((e) => ({
      ...e, minimizadas: e.minimizadas.includes(def) ? tira(e.minimizadas, def) : [...e.minimizadas, def],
    })),
    mudar: (f) => setEstado(f),
  }), [painel, estado, itens, registrar, kpisVisiveis, alvoFixados, soLocal]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Registra o KPI/quadro no catálogo e diz se aparece, se está fixado (e a
 *  ordem entre os fixados) e se está minimizado. Sem provedor: aparece. */
export function useItemPersonalizavel(def: ChaveDef, tipo: Tipo) {
  const ctx = usePersonalizacao();
  const registrar = ctx?.registrar;
  useEffect(() => { registrar?.(def, tipo); }, [registrar, def, tipo]);
  const ordemFixado = ctx ? ctx.estado.fixados.indexOf(idDe(def, tipo)) : -1;
  return {
    visivel: ctx ? ctx.visivel(def, tipo) : true,
    fixado: ordemFixado >= 0,
    ordemFixado,
    minimizada: ctx ? ctx.minimizada(def) : false,
    alternarMinimizada: ctx ? () => ctx.alternarMinimizada(def) : null,
    alternarFixado: ctx ? () => ctx.alternarFixado(def, tipo) : null,
    alvoFixados: ctx?.alvoFixados || null,
  };
}

/** Quadro fixado: vai para a área "Fixados" no topo (portal). */
export function NoTopoSeFixado({ fixado, ordem, alvo, children }: { fixado: boolean; ordem: number; alvo: HTMLElement | null; children: ReactNode }) {
  if (!fixado || !alvo) return <>{children}</>;
  return createPortal(<div style={{ order: ordem }}>{children}</div>, alvo);
}

/** Botão 📌 de fixar/desafixar. */
export function BotaoFixar({ fixado, nome, onClick }: { fixado: boolean; nome: string; onClick: () => void }) {
  return (
    <button type="button" className={`${s.botaoFixar}${fixado ? ` ${s.botaoFixarAtivo}` : ""}`} aria-pressed={fixado}
      aria-label={`${fixado ? "Desafixar" : "Fixar no topo"}: ${nome}`} title={fixado ? "Desafixar" : "Fixar no topo"} onClick={onClick}>
      📌
    </button>
  );
}

/** Faixa de KPIs com o cabeçalho "Indicadores" (minimizar e Personalizar)
 *  e, logo abaixo, a área dos quadros fixados. */
export function GradeKpis({ children }: { children: ReactNode }) {
  const ctx = usePersonalizacao();
  const kpis = ctx?.itens.filter((x) => x.tipo === "kpi") || [];
  const visiveis = kpis.filter((x) => ctx!.visivel(x.def, "kpi")).length;
  const min = !!ctx?.estado.kpisMinimizados;
  const secoesFixadas = ctx ? ctx.estado.fixados.filter((id) => id.startsWith("s:") && ctx.itens.some((x) => x.tipo === "secao" && `s:${x.def}` === id)).length : 0;
  return (
    <>
      <div className={s.faixaKpis}>
        {ctx && (
          <div className={s.faixaKpisTopo}>
            <button type="button" className={s.botaoMin} aria-expanded={!min}
              onClick={() => ctx.mudar((e) => ({ ...e, kpisMinimizados: !e.kpisMinimizados }))}>
              <span aria-hidden="true">{min ? "▸" : "▾"}</span> Indicadores
              <span className={s.chip}>{visiveis} de {kpis.length}</span>
            </button>
            <MenuPersonalizar />
          </div>
        )}
        {/* Minimizada: os KPIs continuam montados (escondidos) para a lista. */}
        <div className={s.kpis} hidden={min}>
          {children}
          {ctx && visiveis === 0 && (
            <p className={s.vazio} style={{ gridColumn: "1 / -1", margin: 0 }}>Nenhum KPI escolhido. Use “Personalizar” para mostrar alguns.</p>
          )}
        </div>
      </div>
      {ctx && (
        <div hidden={!secoesFixadas}>
          <h2 className={s.grupoTitulo}>📌 Fixados</h2>
          <div className={s.fixados} ref={ctx.setAlvoFixados} />
        </div>
      )}
    </>
  );
}

/** Lista suspensa com os KPIs e quadros do Dashboard. */
export function MenuPersonalizar() {
  const ctx = usePersonalizacao();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  if (!ctx) return null;
  const kpis = ctx.itens.filter((x) => x.tipo === "kpi");
  const secoes = ctx.itens.filter((x) => x.tipo === "secao");
  const titulo = (d: ChaveDef) => DEFINICOES[d].titulo;
  const grupo = (rotulo: string, l: typeof kpis, tipo: Tipo) => (
    <fieldset className={s.menuGrupo}>
      <legend>{rotulo}</legend>
      {l.map((x) => (
        <div key={x.def} className={s.menuLinha}>
          <label className={s.menuItem}>
            <input type="checkbox" checked={ctx.visivel(x.def, tipo)} onChange={() => ctx.alternarVisivel(x.def, tipo)} />
            {titulo(x.def)}
          </label>
          <BotaoFixar fixado={ctx.fixado(x.def, tipo)} nome={titulo(x.def)} onClick={() => ctx.alternarFixado(x.def, tipo)} />
        </div>
      ))}
    </fieldset>
  );
  return (
    <div className={s.menuWrap} ref={caixa}>
      <button type="button" className={s.botaoSec} aria-expanded={aberto} aria-haspopup="true" onClick={() => setAberto((v) => !v)}>
        ⚙ Personalizar ▾
      </button>
      {aberto && (
        <div className={s.menu} role="group" aria-label="Personalizar o Dashboard">
          <p className={s.sub} style={{ margin: 0 }}>
            Marque o que aparece; 📌 fixa no topo. {ctx.soLocal ? "Salvo só neste navegador." : "Salvo na sua conta, em qualquer aparelho."}
          </p>
          {grupo(`KPIs (${kpis.filter((x) => ctx.visivel(x.def, "kpi")).length} de ${kpis.length})`, kpis, "kpi")}
          {secoes.length > 0 && grupo(`Quadros (${secoes.filter((x) => ctx.visivel(x.def, "secao")).length} de ${secoes.length})`, secoes, "secao")}
          <div className={s.menuAcoes}>
            <button type="button" className={s.botaoSec} onClick={() => ctx.mudar((e) => ({ ...e, kpis: kpis.map((x) => x.def), secoesOcultas: [] }))}>Mostrar tudo</button>
            <button type="button" className={s.botaoSec}
              onClick={() => ctx.mudar((e) => ({ ...e, minimizadas: e.minimizadas.length ? [] : secoes.map((x) => x.def) }))}>
              {ctx.estado.minimizadas.length ? "Expandir quadros" : "Minimizar quadros"}
            </button>
            <button type="button" className={s.botaoSec} onClick={() => ctx.mudar(() => VAZIO)}>Voltar ao padrão</button>
          </div>
        </div>
      )}
    </div>
  );
}
