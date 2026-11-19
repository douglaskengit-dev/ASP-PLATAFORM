"use client";

/** Fechar ganho: numa tela só, a oportunidade ganha vira projeto, a OS do
 * procedimento é criada e as datas da Operação ficam agendadas (inspeção e
 * período da execução). Reaproveita as rotas de sempre, nesta ordem:
 *
 *   1. POST /api/projetos       (liga a oportunidade ao projeto)
 *   2. POST /api/inspecoes      (OS com o tanque)
 *   3. POST /api/agendamentos   (inspeção, com a execução prevista)
 *   4. POST /api/agendamentos   (execução, com o período)
 *   5. POST /api/processos/[id]/resultado  (marca ganha, se ainda não está)
 *
 * Cada rota repete as regras dela (código e pedido do projeto, OS e tanque,
 * datas, equipe, conflitos) e avisa a equipe escalada. Se um passo falha, os
 * anteriores ficam feitos e "Tentar de novo" continua de onde parou. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/app/components/Modal";
import FormularioTanque from "@/app/components/FormularioTanque";
import { erroDoTanque, TANQUE_FORM_VAZIO, type TanqueForm } from "@/lib/asp/tanque";
import type { Oportunidade, Procedimento } from "./tipos";
import s from "./crm.module.css";

interface UsuarioEquipe { id: string; nome: string; perfil?: string; funcao?: string | null }
type Passo = "projeto" | "os" | "inspecao" | "execucao" | "ganho";
const ROTULO_PASSO: Record<Passo, string> = {
  projeto: "Projeto", os: "OS", inspecao: "Agendamento da inspeção", execucao: "Agendamento da execução", ganho: "Marcar como ganha",
};

async function postar(url: string, corpo: unknown): Promise<{ ok: true; j: any } | { ok: false; erro: string }> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, j } : { ok: false, erro: j.erro || `Erro ${r.status}` };
}

export default function FecharGanho({ op, procedimentos, hoje, dataInicial, onFechar, onConcluido }: {
  op: Oportunidade; procedimentos: Procedimento[]; hoje: string; dataInicial?: string;
  onFechar: () => void; onConcluido: (projetoId: string | null) => void;
}) {
  const jaGanha = op.resultado === "ganha";
  const procOp = procedimentos.find((p) => p.id === op.procedimento_id);

  // Ganho e projeto
  const [dataGanho, setDataGanho] = useState(jaGanha ? (op.resultado_em || hoje).slice(0, 10) : dataInicial || hoje);
  const [codigo, setCodigo] = useState("");
  const [codigoAuto, setCodigoAuto] = useState("");
  const [pedido, setPedido] = useState("");
  const [endereco, setEndereco] = useState("");
  const [responsavel, setResponsavel] = useState("");
  // OS
  const [identificacao, setIdentificacao] = useState("");
  const [procedimento, setProcedimento] = useState(procOp?.codigo || "");
  const [comInspecao, setComInspecao] = useState(true);
  const [tanque, setTanque] = useState<TanqueForm>({ ...TANQUE_FORM_VAZIO });
  // Agenda
  const [inspData, setInspData] = useState("");
  const [inspHora, setInspHora] = useState("");
  const [execInicio, setExecInicio] = useState("");
  const [execFim, setExecFim] = useState("");
  const [execHora, setExecHora] = useState("");
  const [usuarios, setUsuarios] = useState<UsuarioEquipe[]>([]);
  const [equipe, setEquipe] = useState<string[]>([]);
  // Execução
  const [feitos, setFeitos] = useState<{ projetoId?: string; osId?: string; inspecao?: boolean; execucao?: boolean; ganho?: boolean }>(
    op.projeto ? { projetoId: op.projeto.id } : {});
  const [rodando, setRodando] = useState<Passo | null>(null);
  const [erro, setErro] = useState<{ passo: Passo; texto: string } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    fetch("/api/usuarios").then((r) => (r.ok ? r.json() : { usuarios: [] }))
      .then((d) => setUsuarios((d.usuarios || []).sort((a: UsuarioEquipe, b: UsuarioEquipe) => a.nome.localeCompare(b.nome, "pt-BR"))))
      .catch(() => {});
  }, []);
  // Código sugerido pela data de abertura (= data do ganho); só troca se o campo ainda tem a sugestão.
  useEffect(() => {
    if (feitos.projetoId || !dataGanho) return;
    fetch(`/api/projetos/proximo-codigo?data=${dataGanho}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.codigo) return;
      setCodigo((c) => (!c.trim() || c === codigoAuto ? d.codigo : c));
      setCodigoAuto(d.codigo);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataGanho, feitos.projetoId]);

  const equipeSel = useMemo(() => usuarios.filter((u) => equipe.includes(u.id)).map((u) => ({ id: u.id, nome: u.nome })), [usuarios, equipe]);

  // Conferência local (as rotas conferem de novo).
  const faltas: string[] = [];
  if (!op.orgao?.id) faltas.push("Escolha o cliente da oportunidade (em Dados) antes de abrir o projeto.");
  if (!dataGanho || dataGanho > hoje) faltas.push("Data do ganho: informe uma data até hoje.");
  if (!feitos.projetoId) {
    if (!codigo.trim()) faltas.push("Informe o código do projeto.");
    if (!pedido.trim()) faltas.push("Informe o pedido de compra.");
  }
  if (!feitos.osId) {
    if (!identificacao.trim()) faltas.push("Informe a identificação da OS (ex.: Tanque TQ-01).");
    if (!procedimento) faltas.push("Escolha o procedimento da OS.");
    const et = erroDoTanque(tanque);
    if (et) faltas.push(`Tanque: ${et}`);
  }
  if (comInspecao && !feitos.inspecao) {
    if (!inspData) faltas.push("Informe a data da inspeção.");
    else if (inspData < hoje) faltas.push("A inspeção não pode ser no passado.");
  }
  if (!feitos.execucao) {
    if (!execInicio) faltas.push("Informe o início da execução.");
    else if (execInicio < hoje) faltas.push("A execução não pode começar no passado.");
    if (execFim && execInicio && execFim < execInicio) faltas.push("O fim da execução não pode ser antes do início.");
    if (comInspecao && inspData && execInicio && execInicio < inspData) faltas.push("A execução não pode começar antes da inspeção.");
  }
  if ((!feitos.inspecao || !feitos.execucao) && !equipe.length) faltas.push("Escolha ao menos uma pessoa para a equipe.");

  async function passo(p: Passo, fn: () => Promise<{ ok: true; j: any } | { ok: false; erro: string }>) {
    setRodando(p);
    const r = await fn();
    if ("erro" in r) { setErro({ passo: p, texto: r.erro }); return null; }
    // avisos = { campo: [mensagens] } (ResultadoValidacao).
    const av = r.j?.avisos && typeof r.j.avisos === "object" ? Object.values(r.j.avisos as Record<string, string[]>).flat() : [];
    if (av.length) setAvisos((a) => [...a, ...av.map((x) => `${ROTULO_PASSO[p]}: ${x}`)]);
    return r.j;
  }

  async function confirmar() {
    setTentou(true);
    if (faltas.length) return;
    setErro(null); setAvisos([]);
    const f = { ...feitos };
    try {
      if (!f.projetoId) {
        const j = await passo("projeto", () => postar("/api/projetos", {
          clienteId: op.orgao!.id, codigoProjeto: codigo, pedidoCompra: pedido, endereco, responsavelProjeto: responsavel,
          dataAbertura: dataGanho, processoId: op.id, comInspecaoPadrao: comInspecao,
        }));
        if (!j) return;
        f.projetoId = j.projeto.id; setFeitos({ ...f });
      }
      if (!f.osId) {
        const j = await passo("os", () => postar("/api/inspecoes", { projetoId: f.projetoId, identificacao, procedimento, tanque, comInspecao }));
        if (!j) return;
        f.osId = j.inspecao.id; setFeitos({ ...f });
      }
      if (comInspecao && !f.inspecao) {
        const j = await passo("inspecao", () => postar("/api/agendamentos", {
          inspecaoId: f.osId, tipo: "inspecao", dataVisita: inspData, hora: inspHora, dataExecucao: execInicio,
          equipe: equipeSel, equipamentos: [], checklist: [],
        }));
        if (!j) return;
        f.inspecao = true; setFeitos({ ...f });
      }
      if (!f.execucao) {
        const j = await passo("execucao", () => postar("/api/agendamentos", {
          inspecaoId: f.osId, tipo: "execucao", dataVisita: execInicio, dataFim: execFim, hora: execHora,
          equipe: equipeSel, equipamentos: [], checklist: [],
        }));
        if (!j) return;
        f.execucao = true; setFeitos({ ...f });
      }
      if (!jaGanha && !f.ganho) {
        const j = await passo("ganho", () => postar(`/api/processos/${op.id}/resultado`, { resultado: "ganha", data: dataGanho }));
        if (!j) return;
        f.ganho = true; setFeitos({ ...f });
      }
      onConcluido(f.projetoId || null);
    } finally {
      setRodando(null);
    }
  }

  const travado = !!rodando;
  const comecou = !!(feitos.projetoId && !op.projeto) || !!feitos.osId;
  const titulo = jaGanha ? "Abrir projeto e agendar a Operação" : "Fechar ganho";

  return (
    <Modal titulo={`${titulo} — ${op.titulo}`} onFechar={() => { if (!travado) (comecou ? onConcluido(feitos.projetoId || null) : onFechar()); }} largo zIndex={120}>
      <div className={s.ficha}>
        <p className={s.fichaSub}>
          {op.orgao?.razao_social || "Sem cliente"} · cria o projeto, a OS e os agendamentos da inspeção e da execução. A equipe escalada é avisada como em qualquer agendamento; equipamentos e checklist a Operação completa na OS.
        </p>

        <section className={s.bloco}>
          <h3>Ganho e projeto</h3>
          {feitos.projetoId ? (
            <p className="detalhe">✓ Projeto {op.projeto?.codigo || codigo} {op.projeto ? "já ligado a esta oportunidade" : "criado"}.</p>
          ) : (
            <div className={s.linhaForm}>
              <label className={s.campo}><span>Data do ganho *</span>
                <input type="date" value={dataGanho} max={hoje} disabled={travado || jaGanha} onChange={(e) => setDataGanho(e.target.value)} /></label>
              <label className={s.campo}><span>Código do projeto *</span>
                <input value={codigo} disabled={travado} onChange={(e) => setCodigo(e.target.value)} /></label>
              <label className={s.campo}><span>Pedido de compra *</span>
                <input value={pedido} disabled={travado} onChange={(e) => setPedido(e.target.value)} placeholder="Nº do pedido / contrato" /></label>
              <label className={s.campo}><span>Endereço do serviço</span>
                <input value={endereco} disabled={travado} onChange={(e) => setEndereco(e.target.value)} /></label>
              <label className={s.campo}><span>Responsável do projeto (cliente)</span>
                <input value={responsavel} disabled={travado} onChange={(e) => setResponsavel(e.target.value)} /></label>
            </div>
          )}
        </section>

        <section className={s.bloco}>
          <h3>OS</h3>
          {feitos.osId ? <p className="detalhe">✓ OS {identificacao} criada.</p> : (
            <>
              <div className={s.linhaForm}>
                <label className={s.campo}><span>Identificação *</span>
                  <input value={identificacao} disabled={travado} onChange={(e) => setIdentificacao(e.target.value)} placeholder="Ex.: Tanque TQ-01" /></label>
                <label className={s.campo}><span>Procedimento *</span>
                  <select value={procedimento} disabled={travado} onChange={(e) => setProcedimento(e.target.value)}>
                    <option value="">— escolha —</option>
                    {procedimentos.filter((p) => p.ativo !== false || p.codigo === procedimento).map((p) => (
                      <option key={p.id} value={p.codigo}>{p.codigo} — {p.nome}</option>
                    ))}
                  </select></label>
                <label className={s.campo}><span>Haverá inspeção?</span>
                  <select value={comInspecao ? "sim" : "nao"} disabled={travado || !!feitos.inspecao} onChange={(e) => setComInspecao(e.target.value === "sim")}>
                    <option value="sim">Sim — inspeção antes da execução</option>
                    <option value="nao">Não — só a execução</option>
                  </select></label>
              </div>
              <FormularioTanque valor={tanque} onChange={setTanque} desabilitado={travado} />
            </>
          )}
        </section>

        <section className={s.bloco}>
          <h3>Datas da Operação</h3>
          <div className={s.linhaForm}>
            {comInspecao && (feitos.inspecao ? <p className="detalhe">✓ Inspeção agendada para {inspData.split("-").reverse().join("/")}.</p> : (
              <>
                <label className={s.campo}><span>Inspeção *</span>
                  <input type="date" value={inspData} min={hoje} disabled={travado} onChange={(e) => setInspData(e.target.value)} /></label>
                <label className={s.campo}><span>Hora</span>
                  <input type="time" value={inspHora} disabled={travado} onChange={(e) => setInspHora(e.target.value)} /></label>
              </>
            ))}
          </div>
          <div className={s.linhaForm}>
            {feitos.execucao ? <p className="detalhe">✓ Execução agendada.</p> : (
              <>
                <label className={s.campo}><span>Execução — início *</span>
                  <input type="date" value={execInicio} min={inspData || hoje} disabled={travado} onChange={(e) => setExecInicio(e.target.value)} /></label>
                <label className={s.campo}><span>Execução — fim</span>
                  <input type="date" value={execFim} min={execInicio || hoje} disabled={travado} onChange={(e) => setExecFim(e.target.value)} /></label>
                <label className={s.campo}><span>Hora</span>
                  <input type="time" value={execHora} disabled={travado} onChange={(e) => setExecHora(e.target.value)} /></label>
              </>
            )}
          </div>
          {(!feitos.inspecao || !feitos.execucao) && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Equipe * <span className="detalhe">(a mesma para a inspeção e a execução; a Operação pode trocar depois)</span></legend>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", maxHeight: 160, overflow: "auto" }}>
                {usuarios.map((u) => (
                  <label key={u.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" checked={equipe.includes(u.id)} disabled={travado}
                      onChange={(e) => setEquipe((l) => (e.target.checked ? [...l, u.id] : l.filter((x) => x !== u.id)))} />
                    {u.nome}{u.funcao ? <span className="detalhe"> · {u.funcao}</span> : null}
                  </label>
                ))}
                {!usuarios.length && <span className="detalhe">Carregando usuários…</span>}
              </div>
            </fieldset>
          )}
        </section>

        {tentou && faltas.length > 0 && (
          <ul className="val-msg val-erro" role="alert" style={{ margin: 0, paddingLeft: 18 }}>
            {faltas.map((f) => <li key={f}>{f}</li>)}
          </ul>
        )}
        {erro && (
          <p className="val-msg val-erro" role="alert" style={{ margin: 0 }}>
            <strong>{ROTULO_PASSO[erro.passo]}:</strong> {erro.texto}
            {erro.passo !== "projeto" && feitos.projetoId ? " Os passos anteriores já foram feitos — corrija e tente de novo para continuar." : ""}
          </p>
        )}
        {avisos.length > 0 && (
          <ul className="val-msg val-aviso" style={{ margin: 0, paddingLeft: 18 }}>
            {avisos.map((a, i) => <li key={i}>⚠️ {a}</li>)}
          </ul>
        )}

        <div className={s.linhaForm}>
          <button type="button" className="btn-azul" disabled={travado} onClick={confirmar}>
            {rodando ? `${ROTULO_PASSO[rodando]}…` : erro ? "Tentar de novo" : jaGanha ? "Criar projeto e agendar" : "Confirmar ganho, criar projeto e agendar"}
          </button>
          <button type="button" className="btn-doc" disabled={travado} onClick={() => (comecou ? onConcluido(feitos.projetoId || null) : onFechar())}>
            {comecou ? "Fechar (terminar depois)" : "Cancelar"}
          </button>
          {feitos.projetoId && !op.projeto && <Link className="detalhe" href={`/projetos/${feitos.projetoId}`}>Ver o projeto</Link>}
        </div>
      </div>
    </Modal>
  );
}
