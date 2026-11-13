"use client";

/**
 * Follow-up — CRM do Comercial. Cada processo é uma oportunidade de venda que
 * anda pelas etapas comerciais (lib/processos/etapas.ts) e termina ganha ou
 * perdida. Quadro (kanban) com uma coluna por etapa + Ganhas + Perdidas:
 * arrastar o card move a oportunidade (pede a data; ganha pede a data e
 * perdida pede o motivo). O card abre a ficha (próxima ação, atividades,
 * dados, documentos TR → Proposta → Ofício). Admin, Gerência e Comercial.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Modal from "@/app/components/Modal";
import FormularioOrgao from "@/app/components/FormularioOrgao";
import OportunidadeModal from "@/app/components/crm/OportunidadeModal";
import { dataCurta, iniciais, moeda, type Oportunidade, type Orgao, type Usuario } from "@/app/components/crm/tipos";
import { MOTIVOS_PERDA, ORIGENS, PERFIS_CRM, situacaoProximaAcao } from "@/lib/validacao/crm";
import type { EtapaFluxo } from "@/lib/processos/etapas";
import s from "@/app/components/crm/crm.module.css";

type Coluna = { chave: string; titulo: string; etapa?: number; resultado?: "ganha" | "perdida" };
type Movimento = { op: Oportunidade; destino: Coluna };

function hojeLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(dia: string, n: number) {
  const d = new Date(dia + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function FollowupConteudo() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const alvo = searchParams.get("processo");
  const [ops, setOps] = useState<Oportunidade[]>([]);
  const [etapas, setEtapas] = useState<EtapaFluxo[]>([]);
  const [orgaos, setOrgaos] = useState<Orgao[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [eu, setEu] = useState("");
  const [hoje, setHoje] = useState(hojeLocal());
  const [migrado, setMigrado] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [semAcesso, setSemAcesso] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [movimento, setMovimento] = useState<Movimento | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  // Filtros
  const [busca, setBusca] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fResp, setFResp] = useState("");
  const [fAcao, setFAcao] = useState("");
  const [fFechadas, setFFechadas] = useState("90");

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const [rp, rg, ru] = await Promise.all([fetch("/api/processos", { cache: "no-store" }), fetch("/api/orgaos"), fetch("/api/usuarios")]);
      if (rp.status === 401) { window.location.href = "/login"; return; }
      if (rp.status === 403) { setSemAcesso(true); return; }
      const dp = await rp.json();
      if (!rp.ok) throw new Error(dp.erro || "Falha ao carregar.");
      setOps(dp.processos || []);
      setEtapas(dp.etapas || []);
      setEu(dp.eu || "");
      if (dp.hoje) setHoje(dp.hoje);
      setMigrado(dp.migrado !== false);
      setOrgaos((await rg.json().catch(() => ({}))).orgaos || []);
      const du = await ru.json().catch(() => ({}));
      setUsuarios(((du.usuarios || []) as Usuario[]).filter((u) => PERFIS_CRM.includes(u.perfil)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar as oportunidades.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Vindo do Dashboard ou de uma notificação (?processo=id): abre a ficha.
  useEffect(() => { if (alvo && !carregando) setAberta(alvo); }, [alvo, carregando]);
  function fecharFicha() {
    setAberta(null);
    if (alvo) router.replace("/followup");
  }

  const colunas: Coluna[] = useMemo(() => [
    ...etapas.map((e, i) => ({ chave: `e${i}`, titulo: e.nome, etapa: i })),
    { chave: "ganha", titulo: "Ganhas", resultado: "ganha" as const },
    { chave: "perdida", titulo: "Perdidas", resultado: "perdida" as const },
  ], [etapas]);

  const corteFechadas = fFechadas === "todas" ? "" : somarDias(hoje, -Number(fFechadas));
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return ops.filter((o) => {
      if (t && !`${o.titulo} ${o.orgao?.razao_social || ""}`.toLowerCase().includes(t)) return false;
      if (fCliente && o.orgao?.id !== fCliente) return false;
      if (fResp === "eu" && o.responsavel_id !== eu) return false;
      if (fResp === "ninguem" && o.responsavel_id) return false;
      if (fResp && fResp !== "eu" && fResp !== "ninguem" && o.responsavel_id !== fResp) return false;
      if (fAcao && situacaoProximaAcao(o, hoje) !== fAcao) return false;
      if (o.resultado !== "aberta" && corteFechadas && (o.resultado_em || o.atualizado_em.slice(0, 10)) < corteFechadas) return false;
      return true;
    });
  }, [ops, busca, fCliente, fResp, fAcao, eu, hoje, corteFechadas]);
  const temFiltro = !!(busca || fCliente || fResp || fAcao || fFechadas !== "90");

  const abertas = ops.filter((o) => o.resultado === "aberta");
  const resumo = {
    abertas: abertas.length,
    valorAberto: abertas.reduce((a, o) => a + (o.valor || 0), 0),
    atrasadas: abertas.filter((o) => situacaoProximaAcao(o, hoje) === "atrasada").length,
    semAcao: abertas.filter((o) => situacaoProximaAcao(o, hoje) === "sem_acao").length,
    ganhas90: ops.filter((o) => o.resultado === "ganha" && (o.resultado_em || "") >= somarDias(hoje, -90)),
  };
  const nomeDe = (id: string | null) => usuarios.find((u) => u.id === id)?.nome || null;
  const opAberta = ops.find((o) => o.id === aberta) || null;

  function soltar(op: Oportunidade, destino: Coluna) {
    if (destino.etapa != null && op.resultado === "aberta" && op.etapa === destino.etapa) return;
    if (destino.resultado && op.resultado === destino.resultado) return;
    setMovimento({ op, destino });
  }

  if (semAcesso) {
    return (
      <div className="page-larga">
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Follow-up</h1>
        <p className="vazio">O Follow-up é usado pelo Comercial, pela Gerência e pela Administração.</p>
      </div>
    );
  }

  return (
    <div className="page-larga">
      <div className={s.topo}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Follow-up</h1>
          <p className="detalhe" style={{ margin: 0 }}>Oportunidades de venda, da prospecção ao ganho. Arraste o card para mudar a etapa; toque nele para ver a ficha.</p>
        </div>
        <button type="button" className="btn-azul" onClick={() => setNova(true)}>＋ Nova oportunidade</button>
      </div>

      {!migrado && (
        <p className={s.aviso} role="status">
          Falta rodar a migração do CRM (20261114100000_asp_crm_followup) no Supabase. Até lá, as etapas aparecem com os números antigos e valor, resultado e próxima ação não salvam.
        </p>
      )}

      <div className={s.resumo}>
        <div className={s.resumoCard}><span className={s.resumoNum}>{resumo.abertas}</span><span className="detalhe">Em aberto · {moeda(resumo.valorAberto)}</span></div>
        <button type="button" className={`${s.resumoCard} ${resumo.atrasadas ? s.resumoAlerta : ""}`} onClick={() => setFAcao(fAcao === "atrasada" ? "" : "atrasada")} aria-pressed={fAcao === "atrasada"}>
          <span className={s.resumoNum}>{resumo.atrasadas}</span><span className="detalhe">Próxima ação atrasada</span>
        </button>
        <button type="button" className={s.resumoCard} onClick={() => setFAcao(fAcao === "sem_acao" ? "" : "sem_acao")} aria-pressed={fAcao === "sem_acao"}>
          <span className={s.resumoNum}>{resumo.semAcao}</span><span className="detalhe">Sem próxima ação</span>
        </button>
        <div className={s.resumoCard}>
          <span className={s.resumoNum}>{resumo.ganhas90.length}</span>
          <span className="detalhe">Ganhas em 90 dias · {moeda(resumo.ganhas90.reduce((a, o) => a + (o.valor || 0), 0))}</span>
        </div>
      </div>

      <div className={s.filtros}>
        <label className={s.campo} style={{ flex: 2 }}>
          <span>Buscar</span>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Título ou cliente" />
        </label>
        <label className={s.campo}>
          <span>Cliente</span>
          <select value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
            <option value="">Todos</option>
            {orgaos.map((o) => <option key={o.id} value={o.id}>{o.razao_social}</option>)}
          </select>
        </label>
        <label className={s.campo}>
          <span>Responsável</span>
          <select value={fResp} onChange={(e) => setFResp(e.target.value)}>
            <option value="">Todos</option>
            <option value="eu">Minhas</option>
            <option value="ninguem">Sem responsável</option>
            {usuarios.filter((u) => u.id !== eu).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <label className={s.campo}>
          <span>Próxima ação</span>
          <select value={fAcao} onChange={(e) => setFAcao(e.target.value)}>
            <option value="">Todas</option>
            <option value="atrasada">Atrasadas</option>
            <option value="hoje">Para hoje</option>
            <option value="sem_acao">Sem próxima ação</option>
          </select>
        </label>
        <label className={s.campo}>
          <span>Ganhas e perdidas</span>
          <select value={fFechadas} onChange={(e) => setFFechadas(e.target.value)}>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Último ano</option>
            <option value="todas">Todas</option>
          </select>
        </label>
        {temFiltro && (
          <button type="button" className="btn-doc" style={{ alignSelf: "flex-end" }}
            onClick={() => { setBusca(""); setFCliente(""); setFResp(""); setFAcao(""); setFFechadas("90"); }}>Limpar</button>
        )}
      </div>

      {carregando && <p className="vazio">Carregando...</p>}
      {erro && <p className="vazio">❌ {erro}</p>}
      {!carregando && !erro && ops.length === 0 && <p className="vazio">Nenhuma oportunidade ainda. Use “＋ Nova oportunidade”.</p>}

      {!carregando && ops.length > 0 && (
        <div className={s.quadro} role="list" aria-label="Oportunidades por etapa">
          {colunas.map((c) => {
            const lista = filtradas.filter((o) => (c.resultado ? o.resultado === c.resultado : o.resultado === "aberta" && o.etapa === c.etapa))
              .sort((a, b) => (a.proxima_acao_em || "9999").localeCompare(b.proxima_acao_em || "9999") || b.atualizado_em.localeCompare(a.atualizado_em));
            const soma = lista.reduce((a, o) => a + (o.valor || 0), 0);
            return (
              <section key={c.chave} role="listitem" aria-label={c.titulo}
                className={`${s.coluna} ${c.resultado === "ganha" ? s.colunaGanha : c.resultado === "perdida" ? s.colunaPerdida : ""} ${sobre === c.chave ? s.colunaSobre : ""}`}
                onDragOver={(e) => { if (arrastando) { e.preventDefault(); setSobre(c.chave); } }}
                onDragLeave={() => setSobre((v) => (v === c.chave ? null : v))}
                onDrop={(e) => {
                  e.preventDefault(); setSobre(null);
                  const op = ops.find((o) => o.id === e.dataTransfer.getData("text/plain"));
                  if (op) soltar(op, c);
                }}>
                <header className={s.colunaTopo}>
                  <strong>{c.etapa != null ? `${c.etapa + 1}. ` : ""}{c.titulo}</strong>
                  <span className="detalhe">{lista.length}{soma ? ` · ${moeda(soma)}` : ""}</span>
                </header>
                <div className={s.cards}>
                  {lista.length === 0 && <p className={s.colunaVazia}>—</p>}
                  {lista.map((o) => {
                    const sit = situacaoProximaAcao(o, hoje);
                    const resp = nomeDe(o.responsavel_id);
                    return (
                      <button type="button" key={o.id} className={`${s.card} ${arrastando === o.id ? s.cardArrastando : ""}`}
                        draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; setArrastando(o.id); }}
                        onDragEnd={() => { setArrastando(null); setSobre(null); }}
                        onClick={() => setAberta(o.id)} aria-label={`Abrir ${o.titulo}`}>
                        <span className={s.cardTitulo}>{o.titulo}</span>
                        <span className={s.cardCliente}>{o.orgao?.razao_social || "Sem cliente"}</span>
                        <span className={s.cardRodape}>
                          <span className={s.cardValor}>{o.valor != null ? moeda(o.valor) : ""}</span>
                          {resp && <span className={s.avatar} title={`Responsável: ${resp}`}>{iniciais(resp)}</span>}
                        </span>
                        {o.resultado === "aberta" ? (
                          sit === "sem_acao" ? <span className={`${s.acao} ${s.acaoSem}`}>sem próxima ação</span> : (
                            <span className={`${s.acao} ${sit === "atrasada" ? s.acaoAtrasada : sit === "hoje" ? s.acaoHoje : ""}`} title={o.proxima_acao || ""}>
                              {dataCurta(o.proxima_acao_em)} · {o.proxima_acao}
                            </span>
                          )
                        ) : (
                          <span className={s.acao}>
                            {o.resultado === "ganha" ? "ganha" : `perdida${o.motivo_perda ? ` · ${MOTIVOS_PERDA.find((m) => m.valor === o.motivo_perda)?.rotulo || ""}` : ""}`} em {dataCurta(o.resultado_em)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {opAberta && (
        <OportunidadeModal op={opAberta} etapas={etapas} orgaos={orgaos} usuarios={usuarios} hoje={hoje}
          onFechar={fecharFicha} onMudou={carregar} />
      )}
      {nova && (
        <NovaOportunidade orgaos={orgaos} usuarios={usuarios} eu={eu} hoje={hoje} onFechar={() => setNova(false)}
          onCriada={async (id) => { setNova(false); await carregar(); setAberta(id); }} onNovoOrgao={carregar} />
      )}
      {movimento && (
        <ConfirmarMovimento m={movimento} etapas={etapas} hoje={hoje} onFechar={() => setMovimento(null)}
          onFeito={async () => { setMovimento(null); await carregar(); }} />
      )}
    </div>
  );
}

/** Data (e motivo, se perdida) ao soltar o card numa coluna. */
function ConfirmarMovimento({ m, etapas, hoje, onFechar, onFeito }: { m: Movimento; etapas: EtapaFluxo[]; hoje: string; onFechar: () => void; onFeito: () => void }) {
  const [data, setData] = useState(hoje);
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const d = m.destino;
  const reabre = d.etapa != null && m.op.resultado !== "aberta";

  async function confirmar() {
    setSalvando(true); setErro("");
    try {
      const r = d.etapa != null
        ? await fetch(`/api/processos/${m.op.id}/etapa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa: d.etapa, dataAutenticacao: data }) })
        : await fetch(`/api/processos/${m.op.id}/resultado`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultado: d.resultado, data, motivo, detalhe }) });
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).erro || "Não foi possível mover."); return; }
      onFeito();
    } finally { setSalvando(false); }
  }

  return (
    <Modal titulo={d.resultado === "ganha" ? "Marcar como ganha" : d.resultado === "perdida" ? "Marcar como perdida" : `Mover para ${etapas[d.etapa!]?.nome}`} onFechar={onFechar}>
      <div className={s.ficha}>
        <p style={{ margin: 0 }}><strong>{m.op.titulo}</strong>{m.op.orgao ? ` — ${m.op.orgao.razao_social}` : ""}</p>
        {reabre && <p className={s.aviso}>A oportunidade está {m.op.resultado}; movê-la para uma etapa a reabre.</p>}
        <label className={s.campo}>
          <span>{d.resultado ? "Data do resultado" : "Data da mudança"}</span>
          <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
        </label>
        {d.resultado === "perdida" && (
          <>
            <label className={s.campo}>
              <span>Motivo da perda *</span>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="">— escolha —</option>
                {MOTIVOS_PERDA.map((x) => <option key={x.valor} value={x.valor}>{x.rotulo}</option>)}
              </select>
            </label>
            <label className={s.campo}>
              <span>Detalhe {motivo === "outro" ? "*" : "(opcional)"}</span>
              <input value={detalhe} maxLength={500} onChange={(e) => setDetalhe(e.target.value)} />
            </label>
          </>
        )}
        {d.resultado === "ganha" && <p className="detalhe" style={{ margin: 0 }}>Depois do ganho, abra o projeto em Projetos para seguir com as OSs.</p>}
        {erro && <p className={s.erro} role="alert">{erro}</p>}
        <div className={s.linhaForm}>
          <button type="button" className="btn-azul" disabled={salvando || !data} onClick={confirmar}>{salvando ? "Salvando..." : "Confirmar"}</button>
          <button type="button" className="btn-doc" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

function NovaOportunidade({ orgaos, usuarios, eu, hoje, onFechar, onCriada, onNovoOrgao }: {
  orgaos: Orgao[]; usuarios: Usuario[]; eu: string; hoje: string;
  onFechar: () => void; onCriada: (id: string) => void; onNovoOrgao: () => Promise<void>;
}) {
  const [f, setF] = useState({ titulo: "", orgaoId: "", valor: "", origem: "", responsavelId: eu, previsaoFechamento: "", proximaAcao: "", proximaAcaoEm: "" });
  const [modalOrgao, setModalOrgao] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setErro("");
    try {
      const r = await fetch("/api/processos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro || "Falha ao criar a oportunidade."); return; }
      onCriada(d.id);
    } finally { setSalvando(false); }
  }

  return (
    <Modal titulo="Nova oportunidade" onFechar={onFechar}>
      <form className={s.ficha} onSubmit={salvar}>
        <div className={s.gradeForm}>
          <label className={s.campo} style={{ gridColumn: "1 / -1" }}>
            <span>Título *</span>
            <input value={f.titulo} maxLength={200} required onChange={muda("titulo")} placeholder="Ex.: Limpeza dos reservatórios da ETA" autoFocus />
          </label>
          <label className={s.campo} style={{ gridColumn: "1 / -1" }}>
            <span>Cliente *</span>
            <span className={s.linhaForm} style={{ flexWrap: "nowrap" }}>
              <select value={f.orgaoId} required onChange={muda("orgaoId")} style={{ flex: 1 }}>
                <option value="">— escolha —</option>
                {orgaos.map((o) => <option key={o.id} value={o.id}>{o.razao_social}{o.cidade ? ` (${o.cidade}/${o.uf})` : ""}</option>)}
              </select>
              <button type="button" className="btn-doc" onClick={() => setModalOrgao(true)}>＋ Novo cliente</button>
            </span>
          </label>
          <label className={s.campo}><span>Valor (R$)</span><input inputMode="decimal" value={f.valor} onChange={muda("valor")} placeholder="Ex.: 12.500,00" /></label>
          <label className={s.campo}>
            <span>Origem</span>
            <select value={f.origem} onChange={muda("origem")}>
              <option value="">— não informada —</option>
              {ORIGENS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className={s.campo}>
            <span>Responsável</span>
            <select value={f.responsavelId} onChange={muda("responsavelId")}>
              <option value="">— ninguém —</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
          <label className={s.campo}><span>Previsão de fechamento</span><input type="date" value={f.previsaoFechamento} onChange={muda("previsaoFechamento")} /></label>
          <label className={s.campo} style={{ gridColumn: "1 / -1" }}>
            <span>Próxima ação</span>
            <input value={f.proximaAcao} maxLength={200} onChange={muda("proximaAcao")} placeholder="Ex.: ligar para agendar a visita técnica" />
          </label>
          <label className={s.campo}><span>Quando</span><input type="date" value={f.proximaAcaoEm} min={hoje} onChange={muda("proximaAcaoEm")} /></label>
        </div>
        {erro && <p className={s.erro} role="alert">{erro}</p>}
        <div className={s.linhaForm}>
          <button type="submit" className="btn-azul" disabled={salvando}>{salvando ? "Criando..." : "Criar oportunidade"}</button>
          <button type="button" className="btn-doc" onClick={onFechar}>Cancelar</button>
        </div>
      </form>
      {modalOrgao && (
        <Modal titulo="Cadastrar novo cliente" onFechar={() => setModalOrgao(false)} zIndex={200}>
          <FormularioOrgao onSucesso={async (o) => { setModalOrgao(false); await onNovoOrgao(); if (o?.id) setF((v) => ({ ...v, orgaoId: o.id })); }}
            onCancelar={() => setModalOrgao(false)} />
        </Modal>
      )}
    </Modal>
  );
}

export default function FollowupPage() {
  return (
    <Suspense>
      <FollowupConteudo />
    </Suspense>
  );
}
