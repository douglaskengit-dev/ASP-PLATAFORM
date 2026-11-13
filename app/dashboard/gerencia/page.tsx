"use client";

/** Dashboard de Gerência — visão geral da operação: volume concluído, prazo,
 * carteira, qualidade, capacidade e calibração. Dados agregados em
 * /api/dashboard/gerencia (lib/asp/dashboard-gerencia.ts); a página só
 * mostra. Admin e Gerência (lib/asp/dashboard-acesso.ts). */
import { useState } from "react";
import Link from "next/link";
import TituloPagina from "@/app/components/TituloPagina";
import { BarrasHorizontais } from "@/app/components/DashboardCharts";
import type { PainelGerencia } from "@/lib/asp/dashboard-gerencia";
import { AbasDashboard, CamposPeriodo, ColunasMensais, FILTROS_PADRAO, Glossario, usePainel } from "../painel-comum";
import { ddmmaa, dec, dias, Esqueleto, Kpi, LinkOS, ListaCurta, num, pct, plural, Secao, Tabela, useVisao, Vazio } from "../componentes";
import s from "../dashboard.module.css";

const sinal = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${pct(v)}`);

export default function DashboardGerenciaPage() {
  const h = usePainel<PainelGerencia>("/api/dashboard/gerencia");
  const { f, setF, muda, painel, paineis, carregando, erro, carregar, pronto, personalizadoIncompleto } = h;
  const temFiltro = f.periodo !== "30" || !!(f.cliente || f.procedimento);
  const op = painel?.opcoes;

  return (
    <div className="page-larga">
      <TituloPagina titulo="Dashboard de Gerência" subtitulo="Visão geral da operação: resultado, prazo, qualidade e capacidade — horário de Brasília" />
      <AbasDashboard atual="gerencia" paineis={paineis} />

      <form className={s.filtros} onSubmit={(e) => e.preventDefault()} aria-label="Filtros do Dashboard">
        <CamposPeriodo f={f} setF={setF} muda={muda} />
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
            <span>Comparado a <strong>{ddmmaa(painel.anterior.de)} a {ddmmaa(painel.anterior.ate)}</strong></span>
            <span>Recorte: <strong>{plural(painel.base.oss, "OS", "OSs")}</strong></span>
            <span>Atualizado às {new Date(painel.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</span>
          </p>
          <Conteudo p={painel} />
        </div>
      )}

      <Glossario painel="gerencia" rodape={<>Base comum: OSs e projetos fora da lixeira; agendamentos substituídos por remarcação não contam. “Agora” = estado atual; “No período” = eventos com data dentro do período. Os filtros de cliente e procedimento valem para todos os quadros, menos a calibração.</>} />
    </div>
  );
}

function Conteudo({ p }: { p: PainelGerencia }) {
  const k = p.kpis;
  const cal = k.calibracao;
  return (
    <>
      <div className={s.kpis}>
        <Kpi def="gConcluidas" periodo valor={num(k.concluidas.periodo)}
          sub={<>{plural(k.concluidas.anterior, "no período anterior", "no período anterior")}{k.concluidas.variacao != null ? ` (${sinal(k.concluidas.variacao)})` : ""}</>} />
        <Kpi def="gPrazoTotal" periodo valor={k.prazoTotal ? dec(k.prazoTotal.mediana) : "—"} unidade={k.prazoTotal ? "dias" : undefined}
          sub={k.prazoTotal ? <>mediana · média {dec(k.prazoTotal.media)} d · {plural(k.prazoTotal.n, "entrega", "entregas")}</> : "nenhuma entrega final no período"} />
        <Kpi def="gCarteira" valor={num(k.carteira.abertas)} alerta={k.carteira.paradas > 0}
          sub={<>{plural(k.carteira.paradas, "parada", "paradas")}{k.carteira.maisAntigaDias != null ? <> · mais antiga há {dias(k.carteira.maisAntigaDias)}</> : null}</>} />
        <Kpi def="gRetrabalho" periodo valor={pct(k.retrabalho.taxa)} alerta={(k.retrabalho.taxa ?? 0) >= 0.3}
          sub={<>{num(k.retrabalho.reprovacoes)} de {plural(k.retrabalho.avaliacoes, "avaliação", "avaliações")}</>} />
        <Kpi def="gAgua" periodo valor={pct(k.aguaConforme.taxa)} alerta={k.aguaConforme.taxa != null && k.aguaConforme.taxa < 1}
          sub={k.aguaConforme.avaliados ? <>{num(k.aguaConforme.conformes)} de {plural(k.aguaConforme.avaliados, "laudo", "laudos")}</> : "nenhum laudo de execução no período"} />
        <Kpi def="gDiasCampo" periodo valor={k.diasCampo ? dec(k.diasCampo.media) : "—"} unidade={k.diasCampo ? "dias" : undefined}
          sub={k.diasCampo ? <>média · mediana {dec(k.diasCampo.mediana)} d · {plural(k.diasCampo.n, "OS", "OSs")}</> : "nenhuma OS encerrada com RDO"} />
        <Kpi def="gOcupacao" valor={pct(k.ocupacao.equipe)}
          sub={<>equipe ({plural(k.ocupacao.pessoas, "pessoa", "pessoas")}) · equipamentos {pct(k.ocupacao.equipamentos)} ({num(k.ocupacao.nEquipamentos)})</>} />
        <Kpi def="gCalibracao" valor={cal.erro ? "—" : num(cal.vencidas)} alerta={cal.vencidas > 0}
          sub={cal.erro ? "calibração indisponível" : <>{cal.vencidas === 1 ? "vencida" : "vencidas"} · {num(cal.venceBreve)} vencem em 30 dias · de {plural(cal.total, "unidade", "unidades")}</>} />
      </div>

      <h2 className={s.grupoTitulo}>Resultado</h2>
      <div className={s.grade2}>
        <ConcluidasMes p={p} />
        <PrazoMes p={p} />
      </div>

      <h2 className={s.grupoTitulo}>Qualidade</h2>
      <div className={s.grade2}>
        <RetrabalhoMes p={p} />
        <Pendencias p={p} />
      </div>

      <h2 className={s.grupoTitulo}>Carteira e capacidade</h2>
      <div className={s.grade2}>
        <Carteira p={p} />
        <Ocupacao p={p} />
      </div>
      <div className={s.cheio}><Calibracao p={p} /></div>
    </>
  );
}

function ConcluidasMes({ p }: { p: PainelGerencia }) {
  const { tabela, botao } = useVisao();
  return (
    <Secao def="gConcluidas" titulo="Serviços concluídos por mês" acoes={botao}>
      {tabela ? (
        <Tabela legenda="OSs encerradas por mês, últimos 12 meses" colunas={["Mês", "Encerradas", "Mesmo mês do ano anterior"]}
          linhas={p.mensal.map((m) => [m.rotulo, num(m.concluidas), num(m.concluidasAnoAnterior)])} />
      ) : (
        <ColunasMensais rotuloAria="OSs encerradas por mês" nome="Encerradas" nomeComparacao="Mesmo mês do ano anterior"
          dados={p.mensal.map((m) => ({ rotulo: m.rotulo, valor: m.concluidas, comparacao: m.concluidasAnoAnterior }))} />
      )}
    </Secao>
  );
}

function PrazoMes({ p }: { p: PainelGerencia }) {
  const { tabela, botao } = useVisao();
  const algum = p.mensal.some((m) => m.prazoMediano != null);
  return (
    <Secao def="gPrazoTotal" titulo="Prazo total da OS por mês (mediana)" acoes={botao}>
      {!algum ? <Vazio>Nenhuma entrega final registrada nos últimos 12 meses.</Vazio> : tabela ? (
        <Tabela legenda="Mediana de dias da abertura à entrega final, por mês da entrega" colunas={["Mês", "Mediana (dias)", "Entregas"]}
          linhas={p.mensal.map((m) => [m.rotulo, dec(m.prazoMediano), num(m.entregas)])} />
      ) : (
        <ColunasMensais rotuloAria="Mediana de dias da abertura à entrega final" nome="Mediana (dias)" cor="#0f766e"
          formatar={(v) => `${dec(v)} d`} dados={p.mensal.map((m) => ({ rotulo: m.rotulo, valor: m.prazoMediano }))} />
      )}
    </Secao>
  );
}

function RetrabalhoMes({ p }: { p: PainelGerencia }) {
  const { tabela, botao } = useVisao();
  const algum = p.mensal.some((m) => m.avaliacoes > 0);
  return (
    <Secao def="gRetrabalho" titulo="Retrabalho de relatórios por mês" acoes={botao}>
      {!algum ? <Vazio>Nenhuma avaliação de relatório nos últimos 12 meses.</Vazio> : tabela ? (
        <Tabela legenda="Taxa de reprovação por mês" colunas={["Mês", "Reprovação", "Reprovados", "Avaliações"]}
          linhas={p.mensal.map((m) => [m.rotulo, pct(m.taxaReprovacao), num(m.reprovacoes), num(m.avaliacoes)])} />
      ) : (
        <ColunasMensais rotuloAria="Taxa de reprovação de relatórios por mês" nome="Reprovação" cor="#b45309"
          formatar={(v) => pct(v)} dados={p.mensal.map((m) => ({ rotulo: m.rotulo, valor: m.taxaReprovacao }))} />
      )}
      <strong style={{ fontSize: 13, margin: "12px 0 6px" }}>Motivos no período</strong>
      {p.motivos.length === 0 ? <Vazio>Nenhuma reprovação no período.</Vazio> : (
        <BarrasHorizontais dados={p.motivos.map((m) => ({ rotulo: m.rotulo, valor: m.total }))} cor="#b45309" rotuloAria="Reprovações por motivo no período" />
      )}
    </Secao>
  );
}

function Pendencias({ p }: { p: PainelGerencia }) {
  const x = p.kpis.pendencias;
  const itens: [string, number][] = [
    ["OSs com dias sem RDO", x.rdo],
    ["Coleta de fotos incompleta", x.fotos],
    ["Medições sem aprovação", x.medicoes],
    ["Fase 10 com pendência", x.encerramento],
  ];
  return (
    <Secao def="gPendencias" contador={x.rdo + x.fotos + x.medicoes + x.encerramento}>
      <div className={s.duplo}>
        {itens.map(([rot, n]) => (
          <div key={rot} className={s.mini}>
            <span className={s.sub}>{rot}</span>
            <span className={s.miniValor} style={n ? { color: "var(--cor-aviso)" } : undefined}>{num(n)}</span>
          </div>
        ))}
      </div>
      <p className={s.sub} style={{ margin: 0 }}>
        {plural(x.encerradasComPendencia, "OS encerrada", "OSs encerradas")} com pendência no período (por justificativa).
        {" "}<Link className={s.link} href="/dashboard">Ver as OSs no Dashboard de Operações</Link>
      </p>
    </Secao>
  );
}

function Carteira({ p }: { p: PainelGerencia }) {
  const { tabela, botao } = useVisao();
  return (
    <Secao def="gMaisAntigas" titulo="Carteira em aberto" contador={p.kpis.carteira.abertas} acoes={botao}>
      {p.carteiraPorFase.length === 0 ? <Vazio>Nenhuma OS em aberto.</Vazio> : (
        <>
          {tabela ? (
            <Tabela legenda="OSs abertas por fase" colunas={["Fase", "OSs", "Paradas"]}
              linhas={p.carteiraPorFase.map((x) => [`${x.fase}. ${x.titulo}`, num(x.abertas), num(x.paradas)])} />
          ) : (
            <BarrasHorizontais dados={p.carteiraPorFase.map((x) => ({ rotulo: `${x.fase}. ${x.titulo}`, valor: x.abertas, x }))} rotuloAria="OSs abertas por fase"
              detalhe={(d) => (d.x.paradas ? <strong style={{ color: "var(--cor-aviso)" }}>{plural(d.x.paradas, "parada", "paradas")}</strong> : null)} />
          )}
          <strong style={{ fontSize: 13, margin: "12px 0 6px" }}>Abertas há mais tempo</strong>
          <ListaCurta itens={p.maisAntigas} inicial={5} chave={(x) => x.id} render={(x) => (
            <div className={s.linha}>
              <LinkOS os={x} />
              <span className={s.chip}>{dias(x.dias)}</span>
            </div>
          )} />
        </>
      )}
    </Secao>
  );
}

function Ocupacao({ p }: { p: PainelGerencia }) {
  const [aba, setAba] = useState<"pessoas" | "equip">("pessoas");
  const { tabela, botao } = useVisao();
  const dados = (aba === "pessoas" ? p.ocupacaoPessoas : p.ocupacaoEquipamentos).map((x) => ({ rotulo: x.nome, valor: x.dias }));
  return (
    <Secao def="gOcupacao" titulo="Ocupação — próximos 30 dias" acoes={
      <>
        <div className={s.abas} role="group" aria-label="Recurso">
          <button type="button" className={s.aba} aria-pressed={aba === "pessoas"} onClick={() => setAba("pessoas")}>Equipe</button>
          <button type="button" className={s.aba} aria-pressed={aba === "equip"} onClick={() => setAba("equip")}>Equip.</button>
        </div>
        {botao}
      </>
    }>
      <p className={s.sub} style={{ margin: "0 0 8px" }}>
        Média: {pct(aba === "pessoas" ? p.kpis.ocupacao.equipe : p.kpis.ocupacao.equipamentos)} dos dias
      </p>
      {dados.length === 0 ? <Vazio>Ninguém agendado nos últimos 90 dias nem nos próximos 30.</Vazio> : tabela ? (
        <Tabela legenda="Dias alocados nos próximos 30 dias" colunas={[aba === "pessoas" ? "Pessoa" : "Equipamento", "Dias", "% dos 30"]}
          linhas={dados.map((d) => [d.rotulo, num(d.valor), pct(d.valor / 30)])} />
      ) : (
        <BarrasHorizontais dados={dados} max={30} cor="#6d28d9" rotuloAria="Dias alocados nos próximos 30 dias"
          formatar={(v) => `${num(v)} d · ${pct(v / 30)}`} />
      )}
    </Secao>
  );
}

function Calibracao({ p }: { p: PainelGerencia }) {
  const c = p.kpis.calibracao;
  return (
    <Secao def="gCalibracao" titulo="Calibração — vencidas e a vencer" contador={c.vencidas + c.venceBreve}>
      {c.erro ? <Vazio>{c.erro}</Vazio> : p.calibracaoItens.length === 0 ? <Vazio>Todas as unidades estão com a calibração em dia.</Vazio> : (
        <ListaCurta itens={p.calibracaoItens} inicial={8} total={c.vencidas + c.venceBreve} chave={(x) => `${x.equipamento}|${x.identificacao}`} render={(x) => (
          <div className={s.linha}>
            <span>
              <strong style={{ fontSize: 13 }}>{x.equipamento}</strong>
              <span className={s.sub}>{x.identificacao}</span>
            </span>
            <span className={`${s.chip}${x.situacao === "vencida" ? ` ${s.chipAlerta}` : ""}`}>
              {!x.venceEm ? "sem calibração" : x.situacao === "vencida" ? `venceu ${ddmmaa(x.venceEm)}` : `vence ${ddmmaa(x.venceEm)}`}
            </span>
          </div>
        )} />
      )}
      <p className={s.sub} style={{ margin: "8px 0 0" }}><Link className={s.link} href="/dashboard#calibracoes">Ver e atualizar as calibrações</Link></p>
    </Secao>
  );
}
