"use client";

/** Dashboard de Operações — visão de gestão do fluxo de OSs (fases 2 a 10):
 * KPIs, funil por fase com drill-down, tempo por fase, qualidade dos
 * relatórios, filas de aprovação/assinatura, pendências de encerramento,
 * agenda/ocupação/conflitos, qualidade de campo e clientes.
 *
 * Os dados vêm agregados de /api/dashboard (lib/asp/dashboard.ts); a página
 * só mostra. Filtros ficam na URL (?periodo=&cliente=&procedimento=&pessoa=)
 * para o link poder ser compartilhado. Cada indicador tem a definição exata
 * no botão (i) e no glossário do fim. */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TituloPagina from "@/app/components/TituloPagina";
import CalendarioAgenda from "@/app/components/CalendarioAgenda";
import { BarrasHorizontais } from "@/app/components/DashboardCharts";
import type { ChavePeriodo, Dashboard, FiltrosDashboard } from "@/lib/asp/dashboard";
import { DEFINICOES } from "./definicoes";
import {
  Base, ddmm, ddmmaa, dec, dias, Esqueleto, Kpi, LinkOS, ListaCurta, Mais, num, pct, plural, ROT_TIPO, Secao, Tabela, useVisao, Vazio,
} from "./componentes";
import { ROTULO_STATUS_RECORRENCIA } from "@/lib/validacao";
import s from "./dashboard.module.css";

const PERIODOS: { chave: ChavePeriodo; rotulo: string }[] = [
  { chave: "7", rotulo: "Últimos 7 dias" },
  { chave: "30", rotulo: "Últimos 30 dias" },
  { chave: "90", rotulo: "Últimos 90 dias" },
  { chave: "ano", rotulo: "Este ano" },
  { chave: "personalizado", rotulo: "Personalizado" },
];

const FILTROS_PADRAO: FiltrosDashboard = { periodo: "30", de: null, ate: null, cliente: null, procedimento: null, pessoa: null };

function filtrosDaUrl(): FiltrosDashboard {
  if (typeof window === "undefined") return FILTROS_PADRAO;
  const sp = new URLSearchParams(window.location.search);
  const p = sp.get("periodo") as ChavePeriodo | null;
  return {
    periodo: p && PERIODOS.some((x) => x.chave === p) ? p : "30",
    de: sp.get("de"), ate: sp.get("ate"),
    cliente: sp.get("cliente"), procedimento: sp.get("procedimento"), pessoa: sp.get("pessoa"),
  };
}

function query(f: FiltrosDashboard): string {
  const sp = new URLSearchParams();
  if (f.periodo !== "30") sp.set("periodo", f.periodo);
  if (f.periodo === "personalizado") { if (f.de) sp.set("de", f.de); if (f.ate) sp.set("ate", f.ate); }
  if (f.cliente) sp.set("cliente", f.cliente);
  if (f.procedimento) sp.set("procedimento", f.procedimento);
  if (f.pessoa) sp.set("pessoa", f.pessoa);
  return sp.toString();
}

const SECAO_FILA = "relatorios";

export default function DashboardPage() {
  const [f, setF] = useState<FiltrosDashboard>(FILTROS_PADRAO);
  const [pronto, setPronto] = useState(false);
  const [painel, setPainel] = useState<Dashboard | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { setF(filtrosDaUrl()); setPronto(true); }, []);

  const personalizadoIncompleto = f.periodo === "personalizado" && (!f.de || !f.ate);

  const carregar = useCallback(async (filtros: FiltrosDashboard, sinal?: AbortSignal) => {
    setCarregando(true);
    setErro(null);
    try {
      const q = query(filtros);
      const r = await fetch(`/api/dashboard${q ? `?${q}` : ""}`, { signal: sinal, cache: "no-store" });
      if (r.status === 401) { window.location.href = "/login"; return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);
      setPainel(d.painel);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setErro(e?.message || "Falha ao carregar.");
    } finally {
      if (!sinal?.aborted) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!pronto || personalizadoIncompleto) return;
    const q = query(f);
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    const ctl = new AbortController();
    carregar(f, ctl.signal);
    return () => ctl.abort();
  }, [f, pronto, personalizadoIncompleto, carregar]);

  const muda = (k: keyof FiltrosDashboard) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value || null }));
  const temFiltro = f.periodo !== "30" || !!(f.cliente || f.procedimento || f.pessoa);
  const op = painel?.opcoes;

  return (
    <div className="page-larga">
      <TituloPagina titulo="Dashboard de Operações" subtitulo="Fluxo das Ordens de Serviço (OS), relatórios, agenda e campo — horário de Brasília" />

      <form className={s.filtros} onSubmit={(e) => e.preventDefault()} aria-label="Filtros do Dashboard">
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
        <div className={s.campo}>
          <label htmlFor="f-cliente">Cliente</label>
          <select id="f-cliente" value={f.cliente || ""} onChange={muda("cliente")}>
            <option value="">Todos</option>
            {op?.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className={s.campo}>
          <label htmlFor="f-proc">Procedimento</label>
          <select id="f-proc" value={f.procedimento || ""} onChange={muda("procedimento")}>
            <option value="">Todos</option>
            {op?.procedimentos.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo === p.nome ? p.codigo : `${p.codigo} — ${p.nome}`}</option>)}
          </select>
        </div>
        <div className={s.campo}>
          <label htmlFor="f-pessoa">Equipe (pessoa)</label>
          <select id="f-pessoa" value={f.pessoa || ""} onChange={muda("pessoa")}>
            <option value="">Todas</option>
            {op?.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div className={s.acoesFiltro}>
          {temFiltro && <button type="button" className={s.botaoSec} onClick={() => setF(FILTROS_PADRAO)}>Limpar filtros</button>}
          <button type="button" className={s.botaoSec} onClick={() => carregar(f)} disabled={carregando || personalizadoIncompleto}>Atualizar</button>
        </div>
      </form>

      {personalizadoIncompleto && <p className={s.resumo}>Escolha as datas “De” e “Até” do período personalizado.</p>}

      {erro && (
        <div className={s.secao} role="alert" style={{ marginBottom: 14 }}>
          <strong>Não foi possível carregar o Dashboard.</strong>
          <span className={s.sub}>{erro}</span>
          <div style={{ marginTop: 8 }}><button type="button" className={s.botaoSec} onClick={() => carregar(f)}>Tentar de novo</button></div>
        </div>
      )}

      {!painel ? (carregando || !pronto ? <Esqueleto /> : null) : (
        <div className={carregando ? s.carregando : undefined} aria-busy={carregando}>
          <p className={s.resumo} aria-live="polite">
            <span>Período: <strong>{ddmmaa(painel.periodo.de)} a {ddmmaa(painel.periodo.ate)}</strong> (Brasília)</span>
            <span>Recorte: <strong>{plural(painel.base.oss, "OS", "OSs")}</strong> em <strong>{plural(painel.base.projetos, "projeto", "projetos")}</strong></span>
            <span>Atualizado às {new Date(painel.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</span>
          </p>
          {painel.base.oss === 0 ? (
            <div className={s.secao}>
              {temFiltro
                ? <Vazio>Nenhuma OS neste recorte. <button type="button" className={s.botaoSec} onClick={() => setF(FILTROS_PADRAO)}>Limpar filtros</button></Vazio>
                : <Vazio>Nenhuma OS ainda. Abra o primeiro projeto em <Link className={s.link} href="/projetos">Projetos</Link>.</Vazio>}
            </div>
          ) : <Conteudo p={painel} />}
        </div>
      )}

      <div className={s.cheio}>
        <CalendarioAgenda />
      </div>

      <details className={`${s.secao} ${s.glossario}`}>
        <summary>Como cada indicador é calculado</summary>
        <dl>
          {Object.values(DEFINICOES).map((d) => (
            <div key={d.titulo} style={{ display: "contents" }}>
              <dt>{d.titulo}</dt>
              <dd>{d.texto}</dd>
            </div>
          ))}
        </dl>
        <p className={s.sub} style={{ marginTop: 10 }}>
          Base comum: OSs e projetos fora da lixeira; agendamentos substituídos por remarcação não contam; “Agora” = estado atual,
          “No período” = eventos com data dentro do período. Datas e horas no fuso de Brasília. Filtros de cliente, procedimento e pessoa
          valem para todos os quadros.
        </p>
      </details>
    </div>
  );
}

// ── Conteúdo ─────────────────────────────────────────────────────────────────

function Conteudo({ p }: { p: Dashboard }) {
  const k = p.kpis;
  return (
    <>
      <div className={s.kpis}>
        <Kpi def="osAndamento" valor={num(k.osAndamento)}
          sub={<>{plural(k.osAbertasPeriodo, "aberta", "abertas")} no período · {plural(k.paradas, "parada", "paradas")}{k.osSemInspecao ? <> · {num(k.osSemInspecao)} sem inspeção</> : null}</>} />
        <Kpi def="osEncerradas" periodo valor={num(k.osEncerradasPeriodo)}
          sub={<>{plural(k.encerradasManualPeriodo, "manual", "manuais")} · {plural(k.entregasPeriodo, "entrega", "entregas")} no período</>} />
        <Kpi def="leadTime" periodo valor={k.leadTime ? dec(k.leadTime.media) : "—"} unidade={k.leadTime ? "dias" : undefined}
          sub={k.leadTime ? <>mediana {dec(k.leadTime.mediana)} d · {plural(k.leadTime.n, "OS", "OSs")}
            {k.leadTimePorTipo.semInspecao ? <> · com inspeção {dec(k.leadTimePorTipo.comInspecao?.media)} d · sem {dec(k.leadTimePorTipo.semInspecao.media)} d</> : null}</> : "nenhuma OS encerrada no período"} />
        <Kpi def="projetosConcluidos" periodo valor={num(k.projetosConcluidosPeriodo)} sub={<>{plural(k.projetosAtivos, "projeto ativo", "projetos ativos")}</>} />
        <Kpi def="reprovacao" periodo valor={pct(k.reprovacao.total.taxa)} alerta={(k.reprovacao.total.taxa ?? 0) >= 0.3}
          sub={<>Inspeção {pct(k.reprovacao.inspecao.taxa)} ({num(k.reprovacao.inspecao.reprovacoes)}/{num(k.reprovacao.inspecao.avaliacoes)}) · Execução {pct(k.reprovacao.execucao.taxa)} ({num(k.reprovacao.execucao.reprovacoes)}/{num(k.reprovacao.execucao.avaliacoes)})</>} />
        <Kpi def="aguardandoAprovacao" valor={num(k.aguardandoAprovacao.total)} alerta={(k.aguardandoAprovacao.maisAntigoDias ?? 0) > 3}
          sub={k.aguardandoAprovacao.total ? <>mais antigo há {dias(k.aguardandoAprovacao.maisAntigoDias)}</> : "fila vazia"} />
        <Kpi def="aguardandoAssinatura" valor={num(k.aguardandoAssinatura.total)} alerta={(k.aguardandoAssinatura.maisAntigoDias ?? 0) > 7}
          sub={k.aguardandoAssinatura.total ? <>mais antigo há {dias(k.aguardandoAssinatura.maisAntigoDias)}</> : "nada esperando"} />
        <Kpi def="encerramento" valor={num(k.encerramento.comPendencia)} alerta={k.encerramento.comPendencia > 0}
          sub={<>de {plural(k.encerramento.naFase10, "OS", "OSs")} na fase 10</>} />
      </div>

      <h2 className={s.grupoTitulo}>Fluxo das OSs</h2>
      <div className={s.grade2}>
        <Funil p={p} />
        <TempoFase p={p} />
      </div>

      <h2 className={s.grupoTitulo}>Relatórios</h2>
      <div className={s.grade2}>
        <Reprovacao p={p} />
        <Filas p={p} />
      </div>
      <div className={s.cheio}><Encerramento p={p} /></div>

      <h2 className={s.grupoTitulo}>Operação e agenda</h2>
      <div className={s.grade2}>
        <Agenda p={p} />
        <Ocupacao p={p} />
      </div>
      <div className={s.grade2}>
        <ADefinir p={p} />
        <Conflitos p={p} />
      </div>

      <h2 className={s.grupoTitulo}>Qualidade de campo</h2>
      <div className={s.grade4}>
        <Campo p={p} />
      </div>

      <h2 className={s.grupoTitulo}>Clientes</h2>
      <div className={s.cheio}><Recorrencia p={p} /></div>
      <div className={s.cheio}><Clientes p={p} /></div>
    </>
  );
}

function Funil({ p }: { p: Dashboard }) {
  const { tabela, botao } = useVisao();
  const [sel, setSel] = useState<number | null>(null);
  const dados = p.funil.map((x) => ({ rotulo: `${x.fase}. ${x.titulo}`, valor: x.abertas, x }));
  const ativo = sel != null ? p.funil[sel] : null;
  const total = p.funil.reduce((a, x) => a + x.abertas, 0);
  return (
    <Secao def="funil" acoes={botao} contador={total}>
      {tabela ? (
        <Tabela legenda="OSs não encerradas por fase" colunas={["Fase", "OSs", "Sem inspeção", "Paradas", "Idade mediana (dias)"]}
          linhas={p.funil.map((x) => [`${x.fase}. ${x.titulo}`, num(x.abertas), num(x.semInspecao), num(x.paradas), x.idadeMediana == null ? "—" : dec(x.idadeMediana)])} />
      ) : (
        <BarrasHorizontais dados={dados} rotuloAria="OSs não encerradas por fase" vazio="Nenhuma OS em andamento."
          selecionado={sel} aoClicar={(_, i) => setSel((v) => (v === i ? null : i))}
          detalhe={(d) => d.x.abertas ? <>{d.x.area !== "—" ? `${d.x.area} · ` : ""}mediana {dias(d.x.idadeMediana == null ? null : Math.round(d.x.idadeMediana))} na fase{d.x.semInspecao ? ` · ${num(d.x.semInspecao)} sem inspeção` : ""}{d.x.paradas ? <> · <strong style={{ color: "var(--cor-aviso)" }}>{plural(d.x.paradas, "parada", "paradas")}</strong></> : null}</> : (d.x.area !== "—" ? d.x.area : "nenhuma OS")} />
      )}
      {ativo && !tabela && (
        <div className={s.drill} aria-live="polite">
          <strong style={{ fontSize: 13 }}>Fase {ativo.fase} — {ativo.titulo}</strong>
          {ativo.oss.length === 0 ? <Vazio>Nenhuma OS nesta fase.</Vazio> : (
            <ul className={s.lista}>
              {ativo.oss.map((o) => (
                <li key={o.id} className={s.linha}>
                  <LinkOS os={o} />
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {!o.comInspecao && <span className={s.chip}>sem inspeção</span>}
                    <span className={`${s.chip}${o.dias > 15 ? ` ${s.chipAlerta}` : ""}`}>{dias(o.dias)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Mais mostrados={ativo.oss.length} total={ativo.abertas} />
        </div>
      )}
    </Secao>
  );
}

function TempoFase({ p }: { p: Dashboard }) {
  const { tabela, botao } = useVisao();
  const dados = p.duracaoFases.map((x) => ({ rotulo: `${x.fase}. ${x.titulo}`, valor: x.media ?? 0, x }));
  const algum = p.duracaoFases.some((x) => x.n > 0);
  return (
    <Secao def="duracao" periodo acoes={botao}>
      {!algum ? <Vazio>Nenhuma OS saiu de uma fase no período.</Vazio> : tabela ? (
        <Tabela legenda="Dias por fase (passagens encerradas no período)" colunas={["Fase", "Passagens", "Média (dias)", "Mediana (dias)"]}
          linhas={p.duracaoFases.map((x) => [`${x.fase}. ${x.titulo}`, num(x.n), dec(x.media), dec(x.mediana)])} />
      ) : (
        <BarrasHorizontais dados={dados} cor="#0f766e" rotuloAria="Tempo médio por fase, em dias"
          formatar={(v, d) => (d.x.n ? `${dec(v)} d` : "—")}
          detalhe={(d) => (d.x.n ? <>mediana {dec(d.x.mediana)} d · {plural(d.x.n, "passagem", "passagens")}</> : "sem passagens no período")} />
      )}
    </Secao>
  );
}

function Reprovacao({ p }: { p: Dashboard }) {
  const { tabela, botao } = useVisao();
  const r = p.kpis.reprovacao;
  return (
    <Secao def="motivos" titulo="Reprovação de relatórios" periodo acoes={botao}>
      <div className={s.duplo}>
        {(["inspecao", "execucao"] as const).map((t) => (
          <div key={t} className={s.mini}>
            <span className={s.sub}>Relatório de {ROT_TIPO[t]}</span>
            <span className={s.miniValor}>{pct(r[t].taxa)}</span>
            <span className={s.sub}>{num(r[t].reprovacoes)} reprovação(ões) em {plural(r[t].avaliacoes, "avaliação", "avaliações")}</span>
          </div>
        ))}
      </div>
      <strong style={{ fontSize: 13, marginBottom: 6 }}>Motivos (categorias)</strong>
      {p.motivos.length === 0 ? <Vazio>Nenhuma reprovação no período.</Vazio> : tabela ? (
        <Tabela legenda="Reprovações por categoria" colunas={["Categoria", "Inspeção", "Execução", "Total"]}
          linhas={p.motivos.map((m) => [m.rotulo, num(m.inspecao), num(m.execucao), num(m.total)])} />
      ) : (
        <BarrasHorizontais dados={p.motivos.map((m) => ({ rotulo: m.rotulo, valor: m.total, m }))} cor="#b45309"
          rotuloAria="Reprovações por categoria" detalhe={(d) => <>inspeção {num(d.m.inspecao)} · execução {num(d.m.execucao)}</>} />
      )}
    </Secao>
  );
}

function Filas({ p }: { p: Dashboard }) {
  const [aba, setAba] = useState<"aprovacao" | "assinatura">("aprovacao");
  const lista = p.filas[aba];
  const total = aba === "aprovacao" ? p.kpis.aguardandoAprovacao.total : p.kpis.aguardandoAssinatura.total;
  const limite = aba === "aprovacao" ? 3 : 7;
  return (
    <Secao def="filas" acoes={
      <div className={s.abas} role="group" aria-label="Fila">
        <button type="button" className={s.aba} aria-pressed={aba === "aprovacao"} onClick={() => setAba("aprovacao")}>Aprovação ({num(p.kpis.aguardandoAprovacao.total)})</button>
        <button type="button" className={s.aba} aria-pressed={aba === "assinatura"} onClick={() => setAba("assinatura")}>Assinatura ({num(p.kpis.aguardandoAssinatura.total)})</button>
      </div>
    }>
      {lista.length === 0 ? <Vazio>{aba === "aprovacao" ? "Nenhum relatório esperando a Gerência." : "Nenhum relatório aprovado sem a versão assinada."}</Vazio> : (
        <ListaCurta itens={lista} total={total} inicial={6} chave={(x) => x.relatorioId} render={(x) => (
          <div className={s.linha}>
            <span>
              <LinkOS os={x.os} secao={SECAO_FILA} />
              <span className={s.sub}>Relatório de {ROT_TIPO[x.tipo] || x.tipo} v{x.versao} · desde {ddmm(x.desde)}</span>
            </span>
            <span className={`${s.chip}${(x.dias ?? 0) > limite ? ` ${s.chipAlerta}` : ""}`}>{dias(x.dias)}</span>
          </div>
        )} />
      )}
    </Secao>
  );
}

function Encerramento({ p }: { p: Dashboard }) {
  const lista = p.encerramento;
  return (
    <Secao def="encerramento" titulo="Fase 10 — pendências de encerramento" contador={p.kpis.encerramento.naFase10}>
      {lista.length === 0 ? <Vazio>Nenhuma OS aguardando encerramento.</Vazio> : (
        <ul className={s.lista}>
          {lista.map((x) => (
            <li key={x.os.id}>
              <div className={s.linha}>
                <LinkOS os={x.os} secao={x.pendencias[0]?.secao || "entregas"} />
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <span className={`${s.chip}${x.pendencias.length ? ` ${s.chipAlerta}` : ""}`}>
                    {x.pendencias.length ? plural(x.pendencias.length, "pendência", "pendências") : "pronta para encerrar"}
                  </span>
                  <span className={s.chip}>{plural(x.entregas, "entrega", "entregas")}</span>
                  <span className={s.chip}>{dias(x.dias)} na fase</span>
                </span>
              </div>
              {x.pendencias.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--texto-suave)" }}>
                  {x.pendencias.slice(0, 3).map((pd, i) => (
                    <li key={i} style={{ border: 0, padding: "1px 0" }}>
                      <Link className={s.link} style={{ fontWeight: 400 }} href={`/inspecoes/${x.os.id}#${pd.secao}`}>{pd.texto}</Link>
                    </li>
                  ))}
                  {x.pendencias.length > 3 && <li style={{ border: 0, padding: "1px 0" }}>+ {num(x.pendencias.length - 3)} na OS</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Mais mostrados={lista.length} total={p.kpis.encerramento.naFase10} />
    </Secao>
  );
}

function Agenda({ p }: { p: Dashboard }) {
  const [janela, setJanela] = useState<7 | 30>(7);
  const lista = useMemo(() => p.agenda.proximos.filter((a) => janela === 30 || a.inicio <= p.agenda.ate7), [p, janela]);
  return (
    <Secao def="agenda" acoes={
      <div className={s.abas} role="group" aria-label="Janela da agenda">
        <button type="button" className={s.aba} aria-pressed={janela === 7} onClick={() => setJanela(7)}>7 dias</button>
        <button type="button" className={s.aba} aria-pressed={janela === 30} onClick={() => setJanela(30)}>30 dias</button>
      </div>
    }>
      {lista.length === 0 ? <Vazio>Nada agendado nos próximos {janela} dias.</Vazio> : (
        <ListaCurta itens={lista} inicial={8} chave={(a) => a.id} render={(a) => (
            <div className={s.linha}>
              <span>
                <LinkOS os={a.os} secao="agendamentos" />
                <span className={s.sub}>
                  {a.tipo === "execucao" ? "Execução" : "Inspeção"}{a.hora ? ` · ${a.hora}` : ""}
                  {a.equipe.length ? ` · ${a.equipe.join(", ")}` : " · sem equipe"}
                </span>
              </span>
              <span className={s.chip}>{a.inicio === a.fim ? ddmm(a.inicio) : `${ddmm(a.inicio)}–${ddmm(a.fim)}`}</span>
            </div>
        )} />
      )}
      {janela === 30 && <Mais mostrados={lista.length} total={p.agenda.proximosTotal} />}
    </Secao>
  );
}

function Ocupacao({ p }: { p: Dashboard }) {
  const [aba, setAba] = useState<"pessoas" | "equip">("pessoas");
  const { tabela, botao } = useVisao();
  const dados = (aba === "pessoas" ? p.agenda.ocupacaoPessoas : p.agenda.ocupacaoEquipamentos).map((x) => ({ rotulo: x.nome, valor: x.dias }));
  return (
    <Secao def="ocupacao" titulo="Ocupação — próximos 30 dias" acoes={
      <>
        <div className={s.abas} role="group" aria-label="Recurso">
          <button type="button" className={s.aba} aria-pressed={aba === "pessoas"} onClick={() => setAba("pessoas")}>Equipe</button>
          <button type="button" className={s.aba} aria-pressed={aba === "equip"} onClick={() => setAba("equip")}>Equip.</button>
        </div>
        {botao}
      </>
    }>
      {dados.length === 0 ? <Vazio>Ninguém alocado nos próximos 30 dias.</Vazio> : tabela ? (
        <Tabela legenda="Dias alocados nos próximos 30 dias" colunas={[aba === "pessoas" ? "Pessoa" : "Equipamento", "Dias", "% dos 30"]}
          linhas={dados.map((d) => [d.rotulo, num(d.valor), pct(d.valor / 30)])} />
      ) : (
        <BarrasHorizontais dados={dados} max={30} cor="#6d28d9" rotuloAria="Dias alocados nos próximos 30 dias"
          formatar={(v) => `${num(v)} d · ${pct(v / 30)}`} />
      )}
    </Secao>
  );
}

function ADefinir({ p }: { p: Dashboard }) {
  const a = p.agenda.aDefinir;
  return (
    <Secao def="aDefinir" contador={a.total}>
      {a.total === 0 ? <Vazio>Nenhum agendamento com data a definir.</Vazio> : (
        <>
          <p className={s.sub} style={{ margin: "0 0 6px" }}>
            {plural(a.vencidos, "vencido", "vencidos")} · {num(a.hoje)} para hoje · {num(a.semLembrete)} sem lembrete
          </p>
          <ul className={s.lista}>
            {a.itens.map((x) => {
              const venc = x.lembrar_em && x.lembrar_em < p.hoje, hoje = x.lembrar_em === p.hoje;
              return (
                <li key={x.id} className={s.linha}>
                  <span>
                    <LinkOS os={x.os} secao="agendamentos" />
                    <span className={s.sub}>{x.tipo === "execucao" ? "Execução" : "Inspeção"}</span>
                  </span>
                  <span className={`${s.chip}${venc || hoje ? ` ${s.chipAlerta}` : ""}`}>
                    {x.lembrar_em ? `${venc ? "venceu" : hoje ? "hoje" : "lembrar"} ${ddmm(x.lembrar_em)}` : "sem lembrete"}
                  </span>
                </li>
              );
            })}
          </ul>
          <Mais mostrados={a.itens.length} total={a.total} />
        </>
      )}
    </Secao>
  );
}

function Conflitos({ p }: { p: Dashboard }) {
  const c = p.agenda.conflitos;
  return (
    <Secao def="conflitos" contador={c.length}>
      {c.length === 0 ? <Vazio>Nenhum conflito de pessoa ou equipamento.</Vazio> : (
        <ul className={s.lista}>
          {c.map((x, i) => (
            <li key={i}>
              <div className={s.linha}>
                <strong style={{ fontSize: 13 }}>
                  {[...x.pessoas, ...x.equipamentos.map((e) => `“${e}”`)].join(", ")}
                </strong>
                <span className={`${s.chip} ${s.chipAlerta}`}>{x.inicio === x.fim ? ddmm(x.inicio) : `${ddmm(x.inicio)}–${ddmm(x.fim)}`}</span>
              </div>
              <span className={s.sub}>
                <Link className={s.link} href={`/inspecoes/${x.a.os.id}#agendamentos`}>OS {x.a.os.identificacao}</Link> ({ROT_TIPO[x.a.tipo]}, {x.a.os.projeto})
                {" × "}
                <Link className={s.link} href={`/inspecoes/${x.b.os.id}#agendamentos`}>OS {x.b.os.identificacao}</Link> ({ROT_TIPO[x.b.tipo]}, {x.b.os.projeto})
              </span>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

function Campo({ p }: { p: Dashboard }) {
  const c = p.campo;
  return (
    <>
      <Secao def="rdo" contador={c.totais.rdo}>
        {c.rdoFaltando.length === 0 ? <Vazio>Todas as execuções em andamento têm RDO em dia.</Vazio> : (
          <>
            <p className={s.sub} style={{ margin: "0 0 6px" }}>{plural(c.rdoDiasFaltando, "dia", "dias")} sem RDO no total</p>
            <ListaCurta itens={c.rdoFaltando} total={c.totais.rdo} chave={(x) => x.os.id} render={(x) => (
              <>
                <LinkOS os={x.os} secao="rdos" />
                <span className={s.sub}>{plural(x.dias.length, "dia", "dias")}: {x.dias.slice(0, 6).map(ddmm).join(", ")}{x.dias.length > 6 ? ` e + ${num(x.dias.length - 6)}` : ""}</span>
              </>
            )} />
          </>
        )}
      </Secao>
      <Secao def="fotos" contador={c.totais.fotos}>
        {c.fotosIncompletas.length === 0 ? <Vazio>Nenhuma coleta de fotos pendente.</Vazio> : (
          <>
            <ListaCurta itens={c.fotosIncompletas} total={c.totais.fotos} chave={(x) => x.os.id} render={(x) => (
              <>
                <div className={s.linha}>
                  <LinkOS os={x.os} secao="fotos" />
                  <span className={s.chip}>{num(x.feitos)}/{num(x.total)} itens</span>
                </div>
                <span className={s.sub}>Falta: {x.pendencias[0]}{x.pendencias.length > 1 ? " …" : ""}</span>
              </>
            )} />
          </>
        )}
      </Secao>
      <Secao def="medicoes" contador={c.totais.medicoes}>
        {c.medicoesSemAprovacao.length === 0 ? <Vazio>Nenhuma medição esperando aprovação.</Vazio> : (
          <>
            <ListaCurta itens={c.medicoesSemAprovacao} total={c.totais.medicoes} chave={(x) => x.os.id} render={(x) => (
              <div className={s.linha}>
                <LinkOS os={x.os} secao="coletas" />
                <span className={s.chip}>{plural(x.medicoes, "medição", "medições")}</span>
              </div>
            )} />
          </>
        )}
      </Secao>
      <Secao def="laudos" periodo contador={c.totais.laudos}>
        {c.laudosForaDoLimite.length === 0
          ? <Vazio>{c.laudosAvaliados ? `Nenhum parâmetro fora do limite em ${plural(c.laudosAvaliados, "laudo", "laudos")} do período.` : "Nenhum laudo de execução enviado no período."}</Vazio>
          : (
            <>
              <p className={s.sub} style={{ margin: "0 0 6px" }}>{num(c.totais.laudos)} de {plural(c.laudosAvaliados, "laudo", "laudos")} do período</p>
              <ul className={s.lista}>
                {c.laudosForaDoLimite.map((x) => (
                  <li key={x.relatorioId}>
                    <LinkOS os={x.os} secao="relatorios" />
                    <span className={s.sub}>v{x.versao} · enviado {ddmm(x.enviado)} — {x.parametros.join("; ")}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
      </Secao>
    </>
  );
}

/** Próximos serviços dos clientes recorrentes: o que pede ação primeiro
 *  (vencido, em breve), com atalho para abrir o próximo projeto. */
function Recorrencia({ p }: { p: Dashboard }) {
  const r = p.recorrencia;
  return (
    <Secao def="recorrencia" contador={r.total}>
      {r.total === 0 ? (
        <Vazio>Nenhum cliente com serviço recorrente{p.filtros.cliente ? " neste filtro" : ""}. Marque “Serviço recorrente” no cadastro do cliente.</Vazio>
      ) : (
        <>
          <p className={s.sub} style={{ margin: "0 0 6px" }}>
            {plural(r.vencidos, "vencido", "vencidos")} · {num(r.emBreve)} em breve · {num(r.semHistorico)} sem histórico
          </p>
          <ListaCurta itens={r.itens} total={r.total} inicial={8} chave={(x) => x.clienteId} render={(x) => (
            <div className={s.linha}>
              <span>
                <Link className={s.link} href={`/orgaos/${x.clienteId}`}>{x.cliente}</Link>
                <span className={s.sub}>
                  {x.periodicidadeMeses ? `a cada ${x.periodicidadeMeses} meses` : "sem periodicidade"}
                  {x.ultimaExecucao ? ` · última execução ${ddmmaa(x.ultimaExecucao)}` : ""}
                  {x.vencimento ? ` · vence ${ddmmaa(x.vencimento)}` : ""}
                  {x.status === "vencido" || x.status === "em_breve" || x.status === "sem_historico" ? (
                    <> · <Link className={s.link} href={`/projetos?novo=1&cliente=${x.clienteId}`}>+ Novo projeto</Link></>
                  ) : null}
                </span>
              </span>
              <span className={`${s.chip}${x.status === "vencido" || x.status === "em_breve" ? ` ${s.chipAlerta}` : ""}`}>
                {ROTULO_STATUS_RECORRENCIA[x.status]}{x.status === "vencido" && x.dias != null ? ` há ${dias(-x.dias)}` : x.status === "em_breve" && x.dias != null ? ` · ${dias(x.dias)}` : ""}
              </span>
            </div>
          )} />
        </>
      )}
    </Secao>
  );
}

function Clientes({ p }: { p: Dashboard }) {
  return (
    <Secao def="clientes" titulo="OSs, projetos e entregas por cliente" periodo>
      {p.clientes.length === 0 ? <Vazio>Sem clientes no recorte.</Vazio> : (
        <div className={s.tabelaWrap}>
          <table className={s.tabela}>
            <caption className={s.srOnly}>OSs, projetos e entregas por cliente</caption>
            <thead>
              <tr>
                <th scope="col">Cliente</th><th scope="col">Projetos</th><th scope="col">OSs abertas <Base /></th>
                <th scope="col">Criadas</th><th scope="col">Encerradas</th><th scope="col">Entregas</th>
              </tr>
            </thead>
            <tbody>
              {p.clientes.map((c) => (
                <tr key={c.id || "sem"}>
                  <th scope="row" style={{ fontWeight: 500, color: "inherit", fontSize: 13 }}>
                    {c.id ? <Link className={s.link} href={`/orgaos/${c.id}`}>{c.nome}</Link> : c.nome}
                  </th>
                  <td>{num(c.projetos)}</td><td>{num(c.osAbertas)}</td><td>{num(c.osAbertasPeriodo)}</td>
                  <td>{num(c.osEncerradasPeriodo)}</td><td>{num(c.entregasPeriodo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  );
}
