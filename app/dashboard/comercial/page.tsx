"use client";

/** Dashboard Comercial — a operação vista pelo cliente (renovações, clientes
 * para reativar, prazo de entrega, OSs em andamento) e o funil do Follow-up.
 * Dados agregados em /api/dashboard/comercial (lib/asp/dashboard-comercial.ts).
 * Admin e Comercial (lib/asp/dashboard-acesso.ts). */
import { useState } from "react";
import Link from "next/link";
import TituloPagina from "@/app/components/TituloPagina";
import { BarrasHorizontais } from "@/app/components/DashboardCharts";
import type { PainelComercial } from "@/lib/asp/dashboard-comercial";
import { AbasDashboard, CamposPeriodo, ColunasMensais, FILTROS_PADRAO, Glossario, usePainel } from "../painel-comum";
import { ddmm, ddmmaa, dec, dias, Esqueleto, Kpi, ListaCurta, moeda, num, pct, plural, Secao, Tabela, useVisao, Vazio } from "../componentes";
import { GradeKpis, Personalizacao } from "../personalizar";
import s from "../dashboard.module.css";

const sinal = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${pct(v)}`);
const ROT_FAIXA: Record<PainelComercial["renovacoes"][number]["faixa"], string> = { vencido: "Vencido", "30": "Até 30 dias", "60": "31 a 60 dias", "90": "61 a 90 dias" };

export default function DashboardComercialPage() {
  const { f, setF, muda, painel, paineis, carregando, erro, carregar, pronto, personalizadoIncompleto } = usePainel<PainelComercial>("/api/dashboard/comercial");
  const temFiltro = f.periodo !== "30" || !!(f.cliente || f.procedimento);

  return (
    <div className="page-larga">
      <TituloPagina titulo="Dashboard Comercial" subtitulo="Clientes, renovações e o funil do Follow-up — horário de Brasília" />
      <AbasDashboard atual="comercial" paineis={paineis} />

      <form className={s.filtros} onSubmit={(e) => e.preventDefault()} aria-label="Filtros do Dashboard">
        <CamposPeriodo f={f} setF={setF} muda={muda} />
        <div className={s.campo}>
          <label htmlFor="f-cliente">Cliente</label>
          <select id="f-cliente" value={f.cliente || ""} onChange={muda("cliente")}>
            <option value="">Todos</option>
            {painel?.opcoes.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className={s.campo}>
          <label htmlFor="f-proc">Procedimento</label>
          <select id="f-proc" value={f.procedimento || ""} onChange={muda("procedimento")}>
            <option value="">Todos</option>
            {painel?.opcoes.procedimentos.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo === p.nome ? p.codigo : `${p.codigo} — ${p.nome}`}</option>)}
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
            <span>Atualizado às {new Date(painel.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</span>
          </p>
          <Conteudo p={painel} />
        </div>
      )}

      <Glossario painel="comercial" rodape={<>Base comum: projetos e OSs fora da lixeira; agendamentos substituídos por remarcação não contam. “Agora” = estado atual; “No período” = eventos com data dentro do período. O filtro de cliente vale para todos os quadros. O de procedimento vale para todos, menos as renovações e os cadastrados sem nenhum serviço; no Follow-up, conta o procedimento escolhido no título da oportunidade.</>} />
    </div>
  );
}

function Conteudo({ p }: { p: PainelComercial }) {
  const k = p.kpis;
  const r = k.renovacoes;
  return (
    <Personalizacao painel="comercial">
      <GradeKpis>
        <Kpi def="cRenovacoes" valor={num(r.vencidas + r.ate30 + r.ate60 + r.ate90)} alerta={r.vencidas > 0}
          sub={<>{plural(r.vencidas, "vencida", "vencidas")} · {num(r.ate30)} em 30 d · {num(r.ate60)} em 60 d · {num(r.ate90)} em 90 d</>} />
        <Kpi def="cInativos" valor={num(k.inativos.total)}
          sub={<>sem serviço há mais de 12 meses · {num(k.inativos.semServico)} cadastrados sem nenhum serviço</>} />
        <Kpi def="cPrazoEntrega" periodo valor={k.prazoEntrega ? dec(k.prazoEntrega.mediana) : "—"} unidade={k.prazoEntrega ? "dias" : undefined}
          sub={k.prazoEntrega ? <>mediana · média {dec(k.prazoEntrega.media)} d · {plural(k.prazoEntrega.n, "entrega", "entregas")}</> : "nenhuma entrega final no período"} />
        <Kpi def="cAndamento" valor={num(k.andamento.oss)} sub={<>em {plural(k.andamento.clientes, "cliente", "clientes")}</>} />
        <Kpi def="cFunil" valor={num(k.funil.ativos)} alerta={k.parados > 0}
          sub={<>oportunidades em aberto · {plural(k.parados, "parado", "parados")} · {num(k.funil.ganhasPeriodo)} {k.funil.ganhasPeriodo === 1 ? "ganha" : "ganhas"} e {num(k.funil.perdidasPeriodo)} {k.funil.perdidasPeriodo === 1 ? "perdida" : "perdidas"} no período</>} />
        <Kpi def="cFollowups" valor={num(k.followups.atrasadas)} alerta={k.followups.atrasadas > 0}
          sub={<>{num(k.followups.hoje)} para hoje · {num(k.followups.semAcao)} sem próxima ação · de {plural(k.followups.abertas, "oportunidade aberta", "oportunidades abertas")}</>} />
        <Kpi def="cPipeline" valor={moeda(k.pipeline.valor)}
          sub={<>{plural(k.pipeline.abertas, "oportunidade", "oportunidades")}{k.pipeline.semValor ? ` (${num(k.pipeline.semValor)} sem valor)` : ""} · {moeda(k.pipeline.previsto30)} previsto em 30 dias ({num(k.pipeline.qtdPrevisto30)})</>} />
        <Kpi def="cPrevisao" valor={moeda(k.previsao.ponderado)}
          sub={<>de {moeda(k.previsao.valor)} em {plural(k.previsao.comTemperatura, "oportunidade com temperatura", "oportunidades com temperatura")}{k.previsao.semTemperatura ? ` · ${num(k.previsao.semTemperatura)} antes da proposta` : ""}</>} />
        <Kpi def="cTaxaGanho" periodo valor={pct(k.ganho.taxa)}
          sub={k.ganho.ganhas + k.ganho.perdidas ? <>{num(k.ganho.ganhas)} {k.ganho.ganhas === 1 ? "ganha" : "ganhas"} de {plural(k.ganho.ganhas + k.ganho.perdidas, "fechada", "fechadas")} · {moeda(k.ganho.valorGanho)} ganhos{k.ganho.ticketMedio != null ? ` · ticket médio ${moeda(k.ganho.ticketMedio)}` : ""}{k.ganho.cicloMediano != null ? ` · ciclo ${dias(k.ganho.cicloMediano)}` : ""}</> : "nenhuma oportunidade fechada no período"} />
        <Kpi def="cConversao" periodo valor={pct(k.conversao.taxa)}
          sub={k.conversao.criados ? <>{num(k.conversao.ganhas)} de {plural(k.conversao.criados, "oportunidade aberta", "oportunidades abertas")} no período foram ganhas</> : "nenhum processo aberto no período"} />
        <Kpi def="cProjetosNovos" periodo valor={num(k.projetosNovos.periodo)}
          sub={<>{plural(k.projetosNovos.clientesNovos, "cliente novo", "clientes novos")} · {num(k.projetosNovos.recorrentes)} recorrentes · antes {num(k.projetosNovos.anterior)}{k.projetosNovos.variacao != null ? ` (${sinal(k.projetosNovos.variacao)})` : ""}</>} />
        <Kpi def="cRecompra" valor={pct(k.recompra.taxa)}
          sub={k.recompra.base ? <>{num(k.recompra.recompraram)} de {plural(k.recompra.base, "cliente", "clientes")}</> : "nenhum cliente com 12 meses de histórico"} />
      </GradeKpis>

      <h2 className={s.grupoTitulo}>Clientes</h2>
      <div className={s.cheio}><Renovacoes p={p} /></div>
      <div className={s.grade2}>
        <Andamento p={p} />
        <Inativos p={p} />
      </div>

      <h2 className={s.grupoTitulo}>Follow-up</h2>
      <div className={s.grade2}>
        <Funil p={p} />
        <Parados p={p} />
      </div>
      <div className={s.cheio}><Followups p={p} /></div>
      <div className={s.cheio}><PropostasAcao p={p} /></div>
      <div className={s.cheio}><Previsao p={p} /></div>
      <div className={s.grade2}>
        <MotivosPerda p={p} />
        <Origens p={p} />
      </div>
      <div className={s.cheio}><ProjetosFollowup p={p} /></div>
      <div className={s.cheio}><ProjetosMes p={p} /></div>
    </Personalizacao>
  );
}

function Renovacoes({ p }: { p: PainelComercial }) {
  return (
    <div id="recorrencia">
      <Secao def="cRenovacoes" titulo="Renovações — próximos 90 dias" contador={p.renovacoes.length}>
        {p.kpis.renovacoes.recorrentes === 0 ? (
          <Vazio>Nenhum cliente com serviço recorrente{p.filtros.cliente ? " neste filtro" : ""}. Marque “Serviço recorrente” no cadastro do cliente.</Vazio>
        ) : p.renovacoes.length === 0 ? <Vazio>Nenhuma renovação vencida ou vencendo nos próximos 90 dias.</Vazio> : (
          <ListaCurta itens={p.renovacoes} inicial={8} chave={(x) => x.clienteId} render={(x) => (
            <div className={s.linha}>
              <span>
                <Link className={s.link} href={`/orgaos/${x.clienteId}`}>{x.cliente}</Link>
                <span className={s.sub}>
                  {x.periodicidadeMeses ? `a cada ${x.periodicidadeMeses} meses` : ""}
                  {x.ultimaExecucao ? ` · última execução ${ddmmaa(x.ultimaExecucao)}` : ""}
                  {x.vencimento ? ` · vence ${ddmmaa(x.vencimento)}` : ""}
                  {" · "}<Link className={s.link} href={`/projetos?novo=1&cliente=${x.clienteId}`}>+ Novo projeto</Link>
                </span>
              </span>
              <span className={`${s.chip}${x.faixa === "vencido" || x.faixa === "30" ? ` ${s.chipAlerta}` : ""}`}>
                {ROT_FAIXA[x.faixa]}{x.faixa === "vencido" && x.dias != null ? ` há ${dias(-x.dias)}` : x.dias != null ? ` · ${dias(x.dias)}` : ""}
              </span>
            </div>
          )} />
        )}
      </Secao>
    </div>
  );
}

function Andamento({ p }: { p: PainelComercial }) {
  return (
    <Secao def="cAndamento" contador={p.kpis.andamento.oss}>
      {p.andamento.length === 0 ? <Vazio>Nenhuma OS em andamento.</Vazio> : (
        <div className={s.tabelaWrap}>
          <table className={s.tabela}>
            <caption className={s.srOnly}>OSs em andamento por cliente</caption>
            <thead>
              <tr><th scope="col">Cliente</th><th scope="col">OSs</th><th scope="col">Fases</th><th scope="col">Mais antiga</th><th scope="col">Próx. execução</th></tr>
            </thead>
            <tbody>
              {p.andamento.map((c) => (
                <tr key={c.clienteId || "sem"}>
                  <th scope="row" style={{ fontWeight: 500, color: "inherit", fontSize: 13 }}>
                    {c.clienteId ? <Link className={s.link} href={`/orgaos/${c.clienteId}`}>{c.cliente}</Link> : c.cliente}
                  </th>
                  <td>{num(c.oss)}</td><td>{c.fases}</td><td>{dias(c.maisAntigaDias)}</td><td>{c.proximaExecucao ? ddmm(c.proximaExecucao) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  );
}

function Inativos({ p }: { p: PainelComercial }) {
  return (
    <Secao def="cInativos" contador={p.kpis.inativos.total}>
      {p.inativos.length === 0 ? <Vazio>Nenhum cliente sem serviço há mais de 12 meses.</Vazio> : (
        <ListaCurta itens={p.inativos} inicial={8} total={p.kpis.inativos.total} chave={(x) => x.clienteId} render={(x) => (
          <div className={s.linha}>
            <span>
              <Link className={s.link} href={`/orgaos/${x.clienteId}`}>{x.cliente}</Link>
              <span className={s.sub}>
                último serviço {ddmmaa(x.ultimoServico)} · <Link className={s.link} href={`/projetos?novo=1&cliente=${x.clienteId}`}>+ Novo projeto</Link>
              </span>
            </span>
            <span className={s.chip}>{x.meses} meses</span>
          </div>
        )} />
      )}
    </Secao>
  );
}

function Funil({ p }: { p: PainelComercial }) {
  const { tabela, botao } = useVisao();
  const total = p.funil.reduce((a, x) => a + x.ativos, 0);
  return (
    <Secao def="cFunil" titulo="Funil do Follow-up" contador={total} acoes={botao}>
      {total === 0 ? <Vazio>Nenhum processo no Follow-up{p.filtros.cliente ? " deste cliente" : ""}.</Vazio> : tabela ? (
        <Tabela legenda="Processos por etapa" colunas={["Etapa", "Agora", "Parados", "Tempo mediano (dias)", "Conversão p/ próxima"]}
          linhas={p.funil.map((x) => [`${x.etapa + 1}. ${x.nome}`, num(x.ativos), num(x.parados), dec(x.tempoMediano), pct(x.conversao)])} />
      ) : (
        <BarrasHorizontais dados={p.funil.map((x) => ({ rotulo: `${x.etapa + 1}. ${x.nome}`, valor: x.ativos, x }))} rotuloAria="Processos do Follow-up por etapa"
          detalhe={(d) => {
            const partes: string[] = [];
            if (d.x.tempoMediano != null) partes.push(`mediana ${dec(d.x.tempoMediano)} d na etapa`);
            if (d.x.conversao != null) partes.push(`${pct(d.x.conversao)} seguem p/ a próxima`);
            return <>{partes.join(" · ")}{d.x.parados ? <>{partes.length ? " · " : ""}<strong style={{ color: "var(--cor-aviso)" }}>{plural(d.x.parados, "parado", "parados")}</strong></> : null}</>;
          }} />
      )}
      <p className={s.sub} style={{ margin: "8px 0 0" }}>Conversão: processos abertos no período ({num(p.kpis.conversao.criados)}).</p>
    </Secao>
  );
}

function Parados({ p }: { p: PainelComercial }) {
  return (
    <Secao def="cParados" contador={p.kpis.parados}>
      {p.parados.length === 0 ? <Vazio>Nenhum processo parado há mais de 30 dias.</Vazio> : (
        <ListaCurta itens={p.parados} inicial={8} total={p.kpis.parados} chave={(x) => x.id} render={(x) => (
          <div className={s.linha}>
            <span>
              <Link className={s.link} href={`/followup?processo=${x.id}`}>{x.titulo}</Link>
              <span className={s.sub}>{x.cliente ? `${x.cliente} · ` : ""}{x.etapa}</span>
            </span>
            <span className={`${s.chip} ${s.chipAlerta}`}>{dias(x.dias)}</span>
          </div>
        )} />
      )}
    </Secao>
  );
}

function Followups({ p }: { p: PainelComercial }) {
  const f = p.kpis.followups;
  const resp = p.followupsPorResponsavel.filter((r) => r.atrasadas || r.semAcao);
  return (
    <Secao def="cFollowups" contador={f.atrasadas}>
      {f.abertas === 0 ? <Vazio>Nenhuma oportunidade em aberto.</Vazio> : (
        <>
          {resp.length > 0 && (
            <p className={s.sub} style={{ margin: "0 0 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {resp.map((r) => (
                <span key={r.responsavelId || "sem"} className={`${s.chip}${r.atrasadas ? ` ${s.chipAlerta}` : ""}`}>
                  {r.nome}: {num(r.atrasadas)} atrasada{r.atrasadas === 1 ? "" : "s"}{r.semAcao ? ` · ${num(r.semAcao)} sem ação` : ""}
                </span>
              ))}
            </p>
          )}
          {p.followupsAtrasados.length === 0 ? <Vazio>Nenhuma próxima ação atrasada.</Vazio> : (
            <ListaCurta itens={p.followupsAtrasados} inicial={8} total={f.atrasadas} chave={(x) => x.id} render={(x) => (
              <div className={s.linha}>
                <span>
                  <Link className={s.link} href={`/followup?processo=${x.id}`}>{x.titulo}</Link>
                  <span className={s.sub}>{[x.cliente, x.acao, x.responsavel].filter(Boolean).join(" · ")}{" · "}era para {ddmmaa(x.em)}</span>
                </span>
                <span className={`${s.chip} ${s.chipAlerta}`}>{dias(x.dias)}</span>
              </div>
            )} />
          )}
        </>
      )}
    </Secao>
  );
}

function Previsao({ p }: { p: PainelComercial }) {
  const k = p.kpis.previsao;
  const linhas = p.previsaoTemperatura.filter((t) => t.temperatura || t.n);
  const total = p.previsaoTemperatura.reduce((a, t) => ({ n: a.n + t.n, valor: a.valor + t.valor }), { n: 0, valor: 0 });
  return (
    <Secao def="cPrevisao" contador={k.comTemperatura}>
      {total.n === 0 ? <Vazio>Nenhuma oportunidade em aberto.</Vazio> : (
        <>
          {k.ponderado > 0 && (
            <div role="img" aria-label="Composição do valor ponderado por temperatura"
              style={{ display: "flex", gap: 2, height: 12, borderRadius: 6, overflow: "hidden", margin: "0 0 10px" }}>
              {p.previsaoTemperatura.filter((t) => t.temperatura && t.ponderado > 0).map((t) => (
                <span key={t.temperatura} title={`${t.rotulo}: ${moeda(t.ponderado)}`}
                  style={{ flex: t.ponderado, background: `var(--temp-${t.temperatura})` }} />
              ))}
            </div>
          )}
          <Tabela legenda="Previsão ponderada por temperatura" colunas={["Temperatura", "Probabilidade", "Oportunidades", "Valor", "Valor ponderado"]}
            linhas={[
              ...linhas.map((t) => [
                <span key="r" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: t.temperatura ? `var(--temp-${t.temperatura})` : "var(--temp-sem)" }} />
                  {t.rotulo}
                </span>,
                // Com percentual próprio na faixa, mostra a média efetiva.
                t.proprios && t.valor > 0 ? `${pct(t.pct)} (efetivo ${pct(t.ponderado / t.valor)})` : pct(t.pct),
                `${num(t.n)}${t.semValor ? ` (${num(t.semValor)} sem valor)` : ""}`, moeda(t.valor), moeda(t.ponderado)]),
              [<strong key="t">Total</strong>, "", num(total.n), moeda(total.valor), <strong key="p">{moeda(k.ponderado)}</strong>],
            ]} />
          {p.previsaoMes.length > 0 && (
            <Tabela legenda="Previsão ponderada pelo mês da previsão de fechamento" colunas={["Fechamento previsto", "Oportunidades", "Valor", "Valor ponderado"]}
              linhas={p.previsaoMes.map((m) => [m.rotulo, num(m.n), moeda(m.valor), moeda(m.ponderado)])} />
          )}
          {p.previsaoClientes.length > 0 && <ClientesPrevisao p={p} />}
          {k.manuais > 0 && <p className={s.sub} style={{ margin: "6px 0 0" }}>{plural(k.manuais, "oportunidade com temperatura ou percentual escolhido na ficha", "oportunidades com temperatura ou percentual escolhido na ficha")}{k.proprios ? ` (${num(k.proprios)} com percentual próprio)` : ""}; as demais usam a automática.</p>}
        </>
      )}
    </Secao>
  );
}

/** Quem está na previsão ponderada, uma linha por oportunidade (maior valor
 *  ponderado primeiro): cliente, valor, procedimento, temperatura (na cor da
 *  escala) e a última observação da temperatura. */
function ClientesPrevisao({ p }: { p: PainelComercial }) {
  const [todas, setTodas] = useState(false);
  const linhas = p.previsaoClientes
    .flatMap((c) => c.oportunidades.map((o) => ({ ...o, clienteId: c.clienteId, cliente: c.cliente })))
    .sort((a, b) => b.ponderado - a.ponderado || b.pct - a.pct || a.cliente.localeCompare(b.cliente, "pt-BR"));
  const vis = todas ? linhas : linhas.slice(0, 10);
  const corT = (t: string) => `var(--temp-${t})`;
  const nomeT = (t: string) => (t === "frio" ? "❄️ Frio" : t === "morno" ? "🌤️ Morno" : "🔥 Quente");
  return (
    <div style={{ marginTop: 12 }}>
      <div className={s.tabelaWrap}>
        <table className={`${s.tabela} ${s.tabelaPrevisao}`}>
          <caption>Clientes da previsão ponderada (maior valor ponderado primeiro)</caption>
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Valor</th>
              <th scope="col">Procedimento</th>
              <th scope="col">Temperatura</th>
              <th scope="col">Observação</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((o) => (
              <tr key={o.id} style={{ boxShadow: `inset 3px 0 0 ${corT(o.temperatura)}` }}>
                <th scope="row">
                  {o.clienteId ? <Link className={s.link} href={`/orgaos/${o.clienteId}`}>{o.cliente}</Link> : <strong>{o.cliente}</strong>}
                  <span className={s.sub}>
                    <Link className={s.link} style={{ fontWeight: 400 }} href={`/followup?processo=${o.id}`}>abrir oportunidade</Link>
                    {o.previsaoFechamento ? ` · fecha ${ddmmaa(o.previsaoFechamento)}` : ""}{o.responsavel ? ` · ${o.responsavel}` : ""}
                  </span>
                </th>
                <td>
                  <strong>{moeda(o.ponderado)}</strong>
                  <span className={s.sub}>{o.valor != null ? `de ${moeda(o.valor)}` : "sem valor"}</span>
                </td>
                <td>
                  {o.procedimento.nome}
                  <span className={s.sub}>{o.procedimento.outros ? "Outros" : o.procedimento.codigo}</span>
                </td>
                <td>
                  <span style={{ color: corT(o.temperatura), fontWeight: 700 }}>{nomeT(o.temperatura)} {pct(o.pct)}</span>
                  <span className={s.sub}>{o.automatica ? "automática" : o.percentualProprio ? "percentual próprio" : "escolhida"}</span>
                </td>
                <td>
                  {o.observacao ? <>“{o.observacao.texto}”<span className={s.sub}>{ddmmaa(o.observacao.data)}</span></> : <span className={s.sub}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > 10 && (
        <button type="button" className={s.botaoSec} style={{ marginTop: 6, padding: "3px 10px", fontSize: 12 }} aria-expanded={todas} onClick={() => setTodas((v) => !v)}>
          {todas ? "Mostrar menos" : `Ver todas (${num(linhas.length)})`}
        </button>
      )}
    </div>
  );
}

function PropostasAcao({ p }: { p: PainelComercial }) {
  const k = p.kpis.propostas;
  const total = p.propostasAcao.length;
  const chip = (x: PainelComercial["propostasAcao"][number]) => {
    if (x.tipo === "aceita") return <span className={s.chip}>aceita · falta Fechar ganho</span>;
    if (x.tipo === "vencida") return <span className={`${s.chip} ${s.chipAlerta}`}>venceu {x.dias != null ? `há ${dias(-x.dias)}` : ""}</span>;
    return <span className={`${s.chip} ${s.chipAlerta}`}>{x.dias === 0 ? "vence hoje" : `vence em ${dias(x.dias || 0)}`}</span>;
  };
  return (
    <Secao def="cPropostas" contador={total}>
      <p className={s.sub} style={{ margin: "0 0 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span className={s.chip}>{plural(k.aguardando, "proposta aguardando resposta", "propostas aguardando resposta")}</span>
        {k.vencidas > 0 && <span className={`${s.chip} ${s.chipAlerta}`}>{plural(k.vencidas, "vencida", "vencidas")}</span>}
        {k.vencem7 > 0 && <span className={`${s.chip} ${s.chipAlerta}`}>{num(k.vencem7)} vence{k.vencem7 === 1 ? "" : "m"} em 7 dias</span>}
        {k.aceitas > 0 && <span className={s.chip}>{plural(k.aceitas, "aceita sem Fechar ganho", "aceitas sem Fechar ganho")}</span>}
      </p>
      {total === 0 ? <Vazio>Nenhuma proposta vencida, vencendo ou aceita sem fechar.</Vazio> : (
        <ListaCurta itens={p.propostasAcao} inicial={8} total={total} chave={(x) => x.id} render={(x) => (
          <div className={s.linha}>
            <span>
              <Link className={s.link} href={`/followup?processo=${x.id}`}>{x.titulo}</Link>
              <span className={s.sub}>{[x.cliente, `versão ${x.versao}`, x.responsavel].filter(Boolean).join(" · ")}{x.validade ? ` · válida até ${ddmmaa(x.validade)}` : ""}</span>
            </span>
            {chip(x)}
          </div>
        )} />
      )}
    </Secao>
  );
}

function MotivosPerda({ p }: { p: PainelComercial }) {
  const { tabela, botao } = useVisao();
  const total = p.kpis.ganho.perdidas;
  return (
    <Secao def="cMotivosPerda" periodo contador={total} acoes={total ? botao : undefined}>
      {total === 0 ? <Vazio>Nenhuma oportunidade perdida no período.</Vazio> : tabela ? (
        <Tabela legenda="Perdidas no período por motivo" colunas={["Motivo", "Perdidas", "Parte", "Valor"]}
          linhas={p.motivosPerda.map((m) => [m.rotulo, num(m.n), pct(m.n / total), moeda(m.valor)])} />
      ) : (
        <BarrasHorizontais dados={p.motivosPerda.map((m) => ({ rotulo: m.rotulo, valor: m.n, m }))} rotuloAria="Oportunidades perdidas por motivo"
          cor="var(--cor-aviso)" formatar={(v) => `${num(v)} · ${pct(v / total)}`}
          detalhe={(d) => (d.m.valor ? `${moeda(d.m.valor)} perdidos` : null)} />
      )}
    </Secao>
  );
}

function Origens({ p }: { p: PainelComercial }) {
  const { tabela, botao } = useVisao();
  const total = p.kpis.conversao.criados;
  return (
    <Secao def="cOrigens" periodo contador={total} acoes={total ? botao : undefined}>
      {total === 0 ? <Vazio>Nenhuma oportunidade aberta no período.</Vazio> : tabela ? (
        <Tabela legenda="Oportunidades abertas no período por origem" colunas={["Origem", "Abertas", "Ganhas", "Perdidas", "Taxa de ganho", "Valor ganho"]}
          linhas={p.origens.map((o) => [o.rotulo, num(o.criadas), num(o.ganhas), num(o.perdidas), pct(o.taxa), moeda(o.valorGanho)])} />
      ) : (
        <BarrasHorizontais dados={p.origens.map((o) => ({ rotulo: o.rotulo, valor: o.criadas, o }))} rotuloAria="Oportunidades abertas por origem"
          detalhe={(d) => {
            const partes = [`${num(d.o.ganhas)} ${d.o.ganhas === 1 ? "ganha" : "ganhas"}`, `${num(d.o.perdidas)} ${d.o.perdidas === 1 ? "perdida" : "perdidas"}`];
            if (d.o.taxa != null) partes.push(`taxa ${pct(d.o.taxa)}`);
            if (d.o.valorGanho) partes.push(moeda(d.o.valorGanho));
            return partes.join(" · ");
          }} />
      )}
    </Secao>
  );
}

const ROT_SITUACAO = { concluido: "Concluído", andamento: "Em andamento", sem_os: "Sem OS" } as const;

function ProjetosFollowup({ p }: { p: PainelComercial }) {
  const h = p.projetosFollowup;
  return (
    <Secao def="cProjetosFollowup" contador={h.total}>
      {h.total === 0 ? <Vazio>Nenhuma oportunidade ganha no Follow-up{p.filtros.cliente || p.filtros.procedimento ? " neste filtro" : ""}.</Vazio> : (
        <>
          <p className={s.sub} style={{ margin: "0 0 8px" }}>{plural(h.comProjeto, "com projeto", "com projeto")} · {plural(h.semProjeto, "sem projeto ligado", "sem projeto ligado")}</p>
          <div className={s.tabelaWrap}>
            <table className={s.tabela}>
              <caption className={s.srOnly}>Oportunidades ganhas e os projetos abertos a partir delas</caption>
              <thead>
                <tr><th scope="col">Oportunidade</th><th scope="col">Cliente</th><th scope="col">Ganha em</th><th scope="col">Valor</th><th scope="col">Projeto</th><th scope="col">Situação</th></tr>
              </thead>
              <tbody>
                {h.itens.map((x) => (
                  <tr key={x.id}>
                    <th scope="row" style={{ fontWeight: 500, color: "inherit", fontSize: 13 }}>
                      <Link className={s.link} href={`/followup?processo=${x.id}`}>{x.titulo}</Link>
                    </th>
                    <td>{x.clienteId ? <Link className={s.link} href={`/orgaos/${x.clienteId}`}>{x.cliente || "Cliente"}</Link> : "—"}</td>
                    <td>{ddmmaa(x.ganhaEm)}</td>
                    <td>{moeda(x.valor)}</td>
                    <td>{x.projeto ? <Link className={s.link} href={`/projetos/${x.projeto.id}`}>{x.projeto.codigo || "Projeto"}</Link>
                      : <Link className={s.link} href={`/projetos?novo=1${x.clienteId ? `&cliente=${x.clienteId}` : ""}&processo=${x.id}`}>+ Abrir projeto</Link>}</td>
                    <td>{x.projeto ? <>{ROT_SITUACAO[x.projeto.situacao]}{x.projeto.oss ? <span className={s.sub}> · {plural(x.projeto.oss, "OS", "OSs")}{x.projeto.ossAbertas ? `, ${num(x.projeto.ossAbertas)} aberta${x.projeto.ossAbertas === 1 ? "" : "s"}` : ""}</span> : null}</> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {h.total > h.itens.length && <p className={s.sub} style={{ margin: "8px 0 0" }}>Mostrando as {num(h.itens.length)} mais recentes de {num(h.total)}.</p>}
        </>
      )}
    </Secao>
  );
}

function ProjetosMes({ p }: { p: PainelComercial }) {
  const { tabela, botao } = useVisao();
  return (
    <Secao def="cProjetosNovos" titulo="Projetos novos por mês" acoes={botao}>
      {tabela ? (
        <Tabela legenda="Projetos abertos por mês, últimos 12 meses" colunas={["Mês", "Total", "Clientes novos", "Recorrentes"]}
          linhas={p.mensal.map((m) => [m.rotulo, num(m.novos), num(m.clientesNovos), num(m.recorrentes)])} />
      ) : (
        <ColunasMensais rotuloAria="Projetos abertos por mês" nome="Clientes novos" nomeComparacao="Clientes recorrentes"
          dados={p.mensal.map((m) => ({ rotulo: m.rotulo, valor: m.clientesNovos, comparacao: m.recorrentes }))} />
      )}
    </Secao>
  );
}
