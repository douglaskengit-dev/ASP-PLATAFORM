"use client";

/** Peças comuns às páginas dos Dashboards (Operações, Gerência, Comercial):
 * abas entre os Dashboards do perfil, filtros na URL com carregamento da API,
 * glossário e o gráfico de colunas por mês. */
import { ReactNode, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAINEIS, type PainelId } from "@/lib/asp/dashboard-acesso";
import type { ChavePeriodo, FiltrosDashboard } from "@/lib/asp/dashboard";
import { definicoesDo } from "./definicoes";
import s from "./dashboard.module.css";

export const PERIODOS: { chave: ChavePeriodo; rotulo: string }[] = [
  { chave: "7", rotulo: "Últimos 7 dias" },
  { chave: "30", rotulo: "Últimos 30 dias" },
  { chave: "90", rotulo: "Últimos 90 dias" },
  { chave: "ano", rotulo: "Este ano" },
  { chave: "personalizado", rotulo: "Personalizado" },
];

export const FILTROS_PADRAO: FiltrosDashboard = { periodo: "30", de: null, ate: null, cliente: null, procedimento: null, pessoa: null };

export function filtrosDaUrl(): FiltrosDashboard {
  if (typeof window === "undefined") return FILTROS_PADRAO;
  const sp = new URLSearchParams(window.location.search);
  const p = sp.get("periodo") as ChavePeriodo | null;
  return {
    periodo: p && PERIODOS.some((x) => x.chave === p) ? p : "30",
    de: sp.get("de"), ate: sp.get("ate"),
    cliente: sp.get("cliente"), procedimento: sp.get("procedimento"), pessoa: sp.get("pessoa"),
  };
}

export function queryFiltros(f: FiltrosDashboard): string {
  const sp = new URLSearchParams();
  if (f.periodo !== "30") sp.set("periodo", f.periodo);
  if (f.periodo === "personalizado") { if (f.de) sp.set("de", f.de); if (f.ate) sp.set("ate", f.ate); }
  if (f.cliente) sp.set("cliente", f.cliente);
  if (f.procedimento) sp.set("procedimento", f.procedimento);
  if (f.pessoa) sp.set("pessoa", f.pessoa);
  return sp.toString();
}

/** Filtros na URL + carga da API. 403 manda para o Dashboard do perfil. */
export function usePainel<T>(endpoint: string) {
  const router = useRouter();
  const [f, setF] = useState<FiltrosDashboard>(FILTROS_PADRAO);
  const [pronto, setPronto] = useState(false);
  const [painel, setPainel] = useState<T | null>(null);
  const [paineis, setPaineis] = useState<PainelId[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { setF(filtrosDaUrl()); setPronto(true); }, []);
  const personalizadoIncompleto = f.periodo === "personalizado" && (!f.de || !f.ate);

  const carregar = useCallback(async (filtros: FiltrosDashboard, sinal?: AbortSignal) => {
    setCarregando(true);
    setErro(null);
    try {
      const q = queryFiltros(filtros);
      const r = await fetch(`${endpoint}${q ? `?${q}` : ""}`, { signal: sinal, cache: "no-store" });
      if (r.status === 401) { window.location.href = "/login"; return; }
      const d = await r.json().catch(() => ({}));
      if (r.status === 403 && d.destino && d.destino !== window.location.pathname) { router.replace(d.destino); return; }
      if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
      setPainel(d.painel);
      setPaineis(Array.isArray(d.paineis) ? d.paineis : []);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setErro(e?.message || "Falha ao carregar.");
    } finally {
      if (!sinal?.aborted) setCarregando(false);
    }
  }, [endpoint, router]);

  useEffect(() => {
    if (!pronto || personalizadoIncompleto) return;
    const q = queryFiltros(f);
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
    const ctl = new AbortController();
    carregar(f, ctl.signal);
    return () => ctl.abort();
  }, [f, pronto, personalizadoIncompleto, carregar]);

  const muda = (k: keyof FiltrosDashboard) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value || null }));
  return { f, setF, muda, pronto, painel, paineis, carregando, erro, carregar, personalizadoIncompleto };
}

/** Abas entre os Dashboards que o perfil pode ver (some com um só). */
export function AbasDashboard({ atual, paineis }: { atual: PainelId; paineis: PainelId[] }) {
  if (paineis.length < 2) return null;
  return (
    <nav className={s.abasPainel} aria-label="Dashboards">
      {PAINEIS.filter((p) => paineis.includes(p.id)).map((p) => (
        <Link key={p.id} href={p.href} className={s.abaPainel} aria-current={p.id === atual ? "page" : undefined}>{p.rotulo}</Link>
      ))}
    </nav>
  );
}

/** Seletor de período (com "De"/"Até" no personalizado). */
export function CamposPeriodo({ f, setF, muda }: Pick<ReturnType<typeof usePainel>, "f" | "setF" | "muda">) {
  return (
    <>
      <div className={s.campo}>
        <label htmlFor="f-periodo">Período</label>
        <select id="f-periodo" value={f.periodo} onChange={(e) => setF((v) => ({ ...v, periodo: e.target.value as ChavePeriodo }))}>
          {PERIODOS.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
        </select>
      </div>
      {f.periodo === "personalizado" && (
        <>
          <div className={s.campo}>
            <label htmlFor="f-de">De</label>
            <input id="f-de" type="date" value={f.de || ""} onChange={muda("de")} />
          </div>
          <div className={s.campo}>
            <label htmlFor="f-ate">Até</label>
            <input id="f-ate" type="date" value={f.ate || ""} onChange={muda("ate")} />
          </div>
        </>
      )}
    </>
  );
}

export function Glossario({ painel, rodape }: { painel: PainelId; rodape?: ReactNode }) {
  return (
    <details className={`${s.secao} ${s.glossario}`}>
      <summary>Como cada indicador é calculado</summary>
      <dl>
        {definicoesDo(painel).map((d) => (
          <div key={d.titulo} style={{ display: "contents" }}>
            <dt>{d.titulo}</dt>
            <dd>{d.texto}</dd>
          </div>
        ))}
      </dl>
      {rodape && <p className={s.sub} style={{ marginTop: 10 }}>{rodape}</p>}
    </details>
  );
}

/** Colunas por mês, com uma segunda série opcional de comparação (ao lado,
 *  em cinza). Valores ao passar o mouse; a página oferece a tabela. */
export function ColunasMensais({ dados, nome, nomeComparacao, formatar = (v) => v.toLocaleString("pt-BR"), cor = "var(--primaria)", rotuloAria }: {
  dados: { rotulo: string; valor: number | null; comparacao?: number | null }[];
  nome: string;
  nomeComparacao?: string;
  formatar?: (v: number) => string;
  cor?: string;
  rotuloAria: string;
}) {
  const max = Math.max(1, ...dados.flatMap((d) => [d.valor ?? 0, d.comparacao ?? 0]));
  const comp = !!nomeComparacao;
  const altura = (v: number | null | undefined) => (v ? `${Math.max(2, (v / max) * 100)}%` : "0");
  return (
    <div>
      {comp && (
        <div className={s.legenda} aria-hidden="true">
          <span><i style={{ background: cor }} />{nome}</span>
          <span><i style={{ background: "var(--cinza)", opacity: 0.45 }} />{nomeComparacao}</span>
        </div>
      )}
      <div className={s.colunas} role="img" aria-label={`${rotuloAria}: ${dados.map((d) => `${d.rotulo} ${d.valor == null ? "sem dado" : formatar(d.valor)}`).join("; ")}`}>
        {dados.map((d) => (
          <div key={d.rotulo} className={s.colunaMes}
            title={`${d.rotulo} — ${nome}: ${d.valor == null ? "sem dado" : formatar(d.valor)}${comp ? ` · ${nomeComparacao}: ${d.comparacao == null ? "sem dado" : formatar(d.comparacao)}` : ""}`}>
            <div className={s.colunaBarras}>
              {comp && <span className={s.barraComp} style={{ height: altura(d.comparacao) }} />}
              <span className={s.barra} style={{ height: altura(d.valor), background: cor }} />
            </div>
            <span className={s.colunaRotulo}>{d.rotulo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
