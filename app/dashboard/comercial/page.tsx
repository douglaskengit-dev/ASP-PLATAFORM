"use client";

/** Dashboard Comercial — a operação vista pelo cliente (renovações, clientes
 * para reativar, prazo de entrega, OSs em andamento) e o funil do Follow-up.
 * Dados agregados em /api/dashboard/comercial (lib/asp/dashboard-comercial.ts).
 * Admin e Comercial (lib/asp/dashboard-acesso.ts). */
import Link from "next/link";
import TituloPagina from "@/app/components/TituloPagina";
import { BarrasHorizontais } from "@/app/components/DashboardCharts";
import type { PainelComercial } from "@/lib/asp/dashboard-comercial";
import { AbasDashboard, CamposPeriodo, ColunasMensais, FILTROS_PADRAO, Glossario, usePainel } from "../painel-comum";
import { ddmm, ddmmaa, dec, dias, Esqueleto, Kpi, ListaCurta, num, pct, plural, Secao, Tabela, useVisao, Vazio } from "../componentes";
import s from "../dashboard.module.css";

const sinal = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${pct(v)}`);
const ROT_FAIXA: Record<PainelComercial["renovacoes"][number]["faixa"], string> = { vencido: "Vencido", "30": "Até 30 dias", "60": "31 a 60 dias", "90": "61 a 90 dias" };

export default function DashboardComercialPage() {
  const { f, setF, muda, painel, paineis, carregando, erro, carregar, pronto, personalizadoIncompleto } = usePainel<PainelComercial>("/api/dashboard/comercial");
  const temFiltro = f.periodo !== "30" || !!f.cliente;

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

      <Glossario painel="comercial" rodape={<>Base comum: projetos e OSs fora da lixeira; agendamentos substituídos por remarcação não contam. “Agora” = estado atual; “No período” = eventos com data dentro do período. O filtro de cliente vale para todos os quadros.</>} />
    </div>
  );
}

function Conteudo({ p }: { p: PainelComercial }) {
  const k = p.kpis;
  const r = k.renovacoes;
  return (
    <>
      <div className={s.kpis}>
        <Kpi def="cRenovacoes" valor={num(r.vencidas + r.ate30 + r.ate60 + r.ate90)} alerta={r.vencidas > 0}
          sub={<>{plural(r.vencidas, "vencida", "vencidas")} · {num(r.ate30)} em 30 d · {num(r.ate60)} em 60 d · {num(r.ate90)} em 90 d</>} />
        <Kpi def="cInativos" valor={num(k.inativos.total)}
          sub={<>sem serviço há mais de 12 meses · {num(k.inativos.semServico)} cadastrados sem nenhum serviço</>} />
        <Kpi def="cPrazoEntrega" periodo valor={k.prazoEntrega ? dec(k.prazoEntrega.mediana) : "—"} unidade={k.prazoEntrega ? "dias" : undefined}
          sub={k.prazoEntrega ? <>mediana · média {dec(k.prazoEntrega.media)} d · {plural(k.prazoEntrega.n, "entrega", "entregas")}</> : "nenhuma entrega final no período"} />
        <Kpi def="cAndamento" valor={num(k.andamento.oss)} sub={<>em {plural(k.andamento.clientes, "cliente", "clientes")}</>} />
        <Kpi def="cFunil" valor={num(k.funil.ativos)} alerta={k.parados > 0}
          sub={<>oportunidades em aberto · {plural(k.parados, "parado", "parados")} · {num(k.funil.ganhasPeriodo)} {k.funil.ganhasPeriodo === 1 ? "ganha" : "ganhas"} e {num(k.funil.perdidasPeriodo)} {k.funil.perdidasPeriodo === 1 ? "perdida" : "perdidas"} no período</>} />
        <Kpi def="cConversao" periodo valor={pct(k.conversao.taxa)}
          sub={k.conversao.criados ? <>{num(k.conversao.ganhas)} de {plural(k.conversao.criados, "oportunidade aberta", "oportunidades abertas")} no período foram ganhas</> : "nenhum processo aberto no período"} />
        <Kpi def="cProjetosNovos" periodo valor={num(k.projetosNovos.periodo)}
          sub={<>{plural(k.projetosNovos.clientesNovos, "cliente novo", "clientes novos")} · {num(k.projetosNovos.recorrentes)} recorrentes · antes {num(k.projetosNovos.anterior)}{k.projetosNovos.variacao != null ? ` (${sinal(k.projetosNovos.variacao)})` : ""}</>} />
        <Kpi def="cRecompra" valor={pct(k.recompra.taxa)}
          sub={k.recompra.base ? <>{num(k.recompra.recompraram)} de {plural(k.recompra.base, "cliente", "clientes")}</> : "nenhum cliente com 12 meses de histórico"} />
      </div>

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
      <div className={s.cheio}><ProjetosMes p={p} /></div>
    </>
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
