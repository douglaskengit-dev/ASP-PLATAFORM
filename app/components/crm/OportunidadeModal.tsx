"use client";

/** Ficha da oportunidade no Follow-up (CRM): situação (etapa, ganha,
 * perdida), próxima ação, atividades, dados, documentos e histórico. */
import { useCallback, useEffect, useState } from "react";
import Modal from "@/app/components/Modal";
import DocumentosProcesso from "./DocumentosProcesso";
import { MOTIVOS_PERDA, ORIGENS, rotuloMotivoPerda, rotuloOrigem, situacaoProximaAcao, TIPOS_ATIVIDADE } from "@/lib/validacao/crm";
import type { EtapaFluxo } from "@/lib/processos/etapas";
import { dataBr, moeda, valorParaCampo, type Oportunidade, type Orgao, type Usuario } from "./tipos";
import s from "./crm.module.css";

interface Atividade { id: string; tipo: string; descricao: string; data: string; autor: string | null; minha: boolean }
interface Contato { id: string; nome_completo: string; cargo?: string; telefone?: string | null; email?: string }

async function enviar(url: string, metodo: string, corpo?: unknown): Promise<string | null> {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { "Content-Type": "application/json" } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.ok) return null;
  return (await r.json().catch(() => ({}))).erro || `Erro ${r.status}`;
}

export default function OportunidadeModal({ op, etapas, orgaos, usuarios, hoje, onFechar, onMudou }: {
  op: Oportunidade; etapas: EtapaFluxo[]; orgaos: Orgao[]; usuarios: Usuario[]; hoje: string;
  onFechar: () => void; onMudou: () => Promise<void> | void;
}) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const nomeEtapa = etapas[op.etapa]?.nome || "—";
  const responsavel = usuarios.find((u) => u.id === op.responsavel_id)?.nome;

  async function acao(fn: () => Promise<string | null>) {
    setErro(""); setOcupado(true);
    try {
      const e = await fn();
      if (e) setErro(e); else await onMudou();
      return !e;
    } finally { setOcupado(false); }
  }

  return (
    <Modal titulo={op.titulo} onFechar={onFechar} largo>
      <div className={s.ficha}>
        <p className={s.fichaSub}>
          {op.orgao?.razao_social || "Sem cliente"} · aberta em {dataBr(op.data.slice(0, 10))}
          {responsavel ? ` · responsável: ${responsavel}` : ""}
          {op.valor != null ? <> · <strong>{moeda(op.valor, true)}</strong></> : null}
        </p>
        {!op.migrado && (
          <p className={s.aviso} role="status">
            O Follow-up novo precisa da migração do CRM no Supabase. Até ela rodar, só os documentos funcionam.
          </p>
        )}
        {erro && <p className={s.erro} role="alert">{erro}</p>}

        <Situacao op={op} etapas={etapas} hoje={hoje} ocupado={ocupado} acao={acao} />
        <ProximaAcao op={op} hoje={hoje} ocupado={ocupado} acao={acao} />
        <Atividades op={op} hoje={hoje} />
        <Dados op={op} orgaos={orgaos} usuarios={usuarios} ocupado={ocupado} acao={acao} />

        <section className={s.bloco}>
          <h3>Documentos</h3>
          <DocumentosProcesso p={op} nomeEtapa={nomeEtapa} onMudou={() => onMudou()} />
        </section>

        <Historico op={op} etapas={etapas} usuarios={usuarios} />

        <div className={s.rodapeFicha}>
          <button type="button" className="btn-doc" disabled={ocupado} style={{ color: "var(--cor-erro, #b91c1c)" }}
            onClick={async () => {
              if (!confirm(`Excluir a oportunidade "${op.titulo}"?\n\nOs arquivos dela também serão removidos. Não dá para desfazer.`)) return;
              if (await acao(() => enviar(`/api/processos/${op.id}`, "DELETE"))) onFechar();
            }}>
            Excluir oportunidade
          </button>
        </div>
      </div>
    </Modal>
  );
}

type Acao = (fn: () => Promise<string | null>) => Promise<boolean>;

function Situacao({ op, etapas, hoje, ocupado, acao }: { op: Oportunidade; etapas: EtapaFluxo[]; hoje: string; ocupado: boolean; acao: Acao }) {
  const [modo, setModo] = useState<"" | "ganha" | "perdida">("");
  const [etapa, setEtapa] = useState(op.etapa);
  const [data, setData] = useState(hoje);
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  useEffect(() => { setEtapa(op.etapa); setModo(""); }, [op.etapa, op.resultado]);
  const fechada = op.resultado !== "aberta";

  return (
    <section className={s.bloco}>
      <h3>Situação</h3>
      {fechada ? (
        <div className={s.linhaForm}>
          <span className={`${s.selo} ${op.resultado === "ganha" ? s.seloGanha : s.seloPerdida}`}>
            {op.resultado === "ganha" ? "Ganha" : "Perdida"} em {dataBr(op.resultado_em)}
          </span>
          {op.resultado === "perdida" && (
            <span className="detalhe">Motivo: {rotuloMotivoPerda(op.motivo_perda) || "—"}{op.motivo_perda_detalhe ? ` — ${op.motivo_perda_detalhe}` : ""}</span>
          )}
          <button type="button" className="btn-doc" disabled={ocupado}
            onClick={() => acao(() => enviar(`/api/processos/${op.id}/resultado`, "POST", { resultado: "aberta" }))}>
            Reabrir
          </button>
        </div>
      ) : (
        <>
          <div className={s.linhaForm}>
            <label className={s.campo}>
              <span>Etapa</span>
              <select value={etapa} onChange={(e) => setEtapa(Number(e.target.value))}>
                {etapas.map((e, i) => <option key={i} value={i}>{i + 1}. {e.nome}</option>)}
              </select>
            </label>
            <label className={s.campo}>
              <span>Data</span>
              <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
            </label>
            <button type="button" className="btn-azul" disabled={ocupado || etapa === op.etapa || !data}
              onClick={() => acao(() => enviar(`/api/processos/${op.id}/etapa`, "POST", { etapa, dataAutenticacao: data }))}>
              Mover
            </button>
          </div>
          <div className={s.linhaForm}>
            <button type="button" className={`btn-doc ${s.botaoGanha}`} aria-pressed={modo === "ganha"} onClick={() => setModo(modo === "ganha" ? "" : "ganha")}>✓ Ganha</button>
            <button type="button" className={`btn-doc ${s.botaoPerdida}`} aria-pressed={modo === "perdida"} onClick={() => setModo(modo === "perdida" ? "" : "perdida")}>✕ Perdida</button>
          </div>
          {modo && (
            <div className={s.caixaAcao}>
              <div className={s.linhaForm}>
                <label className={s.campo}>
                  <span>Data do {modo === "ganha" ? "fechamento" : "resultado"}</span>
                  <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
                </label>
                {modo === "perdida" && (
                  <label className={s.campo}>
                    <span>Motivo da perda *</span>
                    <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                      <option value="">— escolha —</option>
                      {MOTIVOS_PERDA.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {modo === "perdida" && (
                <label className={s.campo}>
                  <span>Detalhe {motivo === "outro" ? "*" : "(opcional)"}</span>
                  <input value={detalhe} maxLength={500} onChange={(e) => setDetalhe(e.target.value)} placeholder="Ex.: concorrente cobrou 20% menos" />
                </label>
              )}
              <div className={s.linhaForm}>
                <button type="button" className="btn-azul" disabled={ocupado}
                  onClick={() => acao(() => enviar(`/api/processos/${op.id}/resultado`, "POST", { resultado: modo, data, motivo, detalhe }))}>
                  Confirmar {modo === "ganha" ? "ganho" : "perda"}
                </button>
                <button type="button" className="btn-doc" onClick={() => setModo("")}>Cancelar</button>
              </div>
              {modo === "ganha" && <p className="detalhe" style={{ margin: 0 }}>Depois do ganho, abra o projeto em Projetos para seguir com as OSs.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProximaAcao({ op, hoje, ocupado, acao }: { op: Oportunidade; hoje: string; ocupado: boolean; acao: Acao }) {
  const [texto, setTexto] = useState(op.proxima_acao || "");
  const [data, setData] = useState(op.proxima_acao_em || "");
  useEffect(() => { setTexto(op.proxima_acao || ""); setData(op.proxima_acao_em || ""); }, [op.proxima_acao, op.proxima_acao_em]);
  if (op.resultado !== "aberta") return null;
  const sit = situacaoProximaAcao(op, hoje);
  const mudou = texto !== (op.proxima_acao || "") || data !== (op.proxima_acao_em || "");
  return (
    <section className={s.bloco}>
      <h3>
        Próxima ação
        {sit === "atrasada" && <span className={`${s.selo} ${s.seloAtraso}`}>atrasada</span>}
        {sit === "hoje" && <span className={`${s.selo} ${s.seloHoje}`}>hoje</span>}
        {sit === "sem_acao" && <span className={s.selo}>sem próxima ação</span>}
      </h3>
      <div className={s.linhaForm}>
        <label className={s.campo} style={{ flex: 3 }}>
          <span>O que fazer</span>
          <input value={texto} maxLength={200} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: ligar para confirmar a visita técnica" />
        </label>
        <label className={s.campo}>
          <span>Quando</span>
          <input type="date" value={data} min={hoje} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      <div className={s.linhaForm}>
        <button type="button" className="btn-azul" disabled={ocupado || !mudou}
          onClick={() => acao(() => enviar(`/api/processos/${op.id}`, "PATCH", { proximaAcao: texto, proximaAcaoEm: data }))}>
          Salvar próxima ação
        </button>
        {op.proxima_acao && (
          <button type="button" className="btn-doc" disabled={ocupado} title="Tira a próxima ação; registre o que foi feito em Atividades"
            onClick={() => acao(() => enviar(`/api/processos/${op.id}`, "PATCH", { proximaAcao: "", proximaAcaoEm: "" }))}>
            Concluída
          </button>
        )}
      </div>
      <p className="detalhe" style={{ margin: 0 }}>No dia, o responsável recebe um aviso. Defina sempre a próxima ação: oportunidade sem ela costuma esfriar.</p>
    </section>
  );
}

function Atividades({ op, hoje }: { op: Oportunidade; hoje: string }) {
  const [lista, setLista] = useState<Atividade[] | null>(null);
  const [aviso, setAviso] = useState("");
  const [tipo, setTipo] = useState("ligacao");
  const [data, setData] = useState(hoje);
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/processos/${op.id}/atividades`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.erro || "Falha ao carregar as atividades."); setLista([]); return; }
    setLista(d.atividades || []);
    setAviso(d.aviso || "");
  }, [op.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setErro("");
    try {
      const err = await enviar(`/api/processos/${op.id}/atividades`, "POST", { tipo, data, descricao });
      if (err) { setErro(err); return; }
      setDescricao("");
      await carregar();
    } finally { setSalvando(false); }
  }

  return (
    <section className={s.bloco}>
      <h3>Atividades {lista && lista.length > 0 && <span className={s.selo}>{lista.length}</span>}</h3>
      {aviso && <p className={s.aviso}>{aviso}</p>}
      <form onSubmit={registrar} className={s.caixaAcao}>
        <div className={s.linhaForm}>
          <label className={s.campo}>
            <span>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS_ATIVIDADE.map((t) => <option key={t.valor} value={t.valor}>{t.icone} {t.rotulo}</option>)}
            </select>
          </label>
          <label className={s.campo}>
            <span>Data</span>
            <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        <label className={s.campo}>
          <span>O que aconteceu</span>
          <textarea rows={2} value={descricao} maxLength={2000} onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: falei com o Ivan; pediu a proposta até sexta" />
        </label>
        {erro && <p className={s.erro} role="alert">{erro}</p>}
        <div><button type="submit" className="btn-azul" disabled={salvando || !descricao.trim()}>{salvando ? "Salvando..." : "Registrar atividade"}</button></div>
      </form>
      {lista === null ? <p className="detalhe">Carregando...</p> : lista.length === 0 ? <p className="detalhe">Nenhuma atividade registrada.</p> : (
        <ul className={s.timeline}>
          {lista.map((a) => {
            const t = TIPOS_ATIVIDADE.find((x) => x.valor === a.tipo);
            return (
              <li key={a.id}>
                <span className={s.timelineIcone} aria-hidden="true">{t?.icone || "•"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className={s.timelineTopo}>
                    <strong>{t?.rotulo || a.tipo}</strong>
                    <span className="detalhe">{dataBr(a.data)}{a.autor ? ` · ${a.autor}` : ""}</span>
                    {a.minha && (
                      <button type="button" className={s.botaoTexto} aria-label="Apagar esta atividade"
                        onClick={async () => {
                          if (!confirm("Apagar esta atividade?")) return;
                          const err = await enviar(`/api/processos/${op.id}/atividades?atividade=${a.id}`, "DELETE");
                          if (err) setErro(err); else carregar();
                        }}>apagar</button>
                    )}
                  </div>
                  <p className={s.timelineTexto}>{a.descricao}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Dados({ op, orgaos, usuarios, ocupado, acao }: { op: Oportunidade; orgaos: Orgao[]; usuarios: Usuario[]; ocupado: boolean; acao: Acao }) {
  const inicial = useCallback(() => ({
    titulo: op.titulo, orgaoId: op.orgao?.id || "", contatoId: op.contato_id || "", valor: valorParaCampo(op.valor),
    origem: op.origem || "", responsavelId: op.responsavel_id || "", previsaoFechamento: op.previsao_fechamento || "",
  }), [op]);
  const [f, setF] = useState(inicial);
  const [contatos, setContatos] = useState<Contato[]>([]);
  useEffect(() => { setF(inicial()); }, [inicial]);
  useEffect(() => {
    if (!f.orgaoId) { setContatos([]); return; }
    let vivo = true;
    fetch(`/api/orgaos/${f.orgaoId}`).then((r) => r.json()).then((d) => { if (vivo) setContatos(d.orgao?.contatos || []); }).catch(() => {});
    return () => { vivo = false; };
  }, [f.orgaoId]);
  const muda = (k: keyof ReturnType<typeof inicial>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value, ...(k === "orgaoId" ? { contatoId: "" } : {}) }));
  const mudou = JSON.stringify(f) !== JSON.stringify(inicial());
  const contato = contatos.find((c) => c.id === f.contatoId);

  return (
    <section className={s.bloco}>
      <h3>Dados da oportunidade</h3>
      <div className={s.gradeForm}>
        <label className={s.campo} style={{ gridColumn: "1 / -1" }}><span>Título *</span><input value={f.titulo} maxLength={200} onChange={muda("titulo")} /></label>
        <label className={s.campo}>
          <span>Cliente *</span>
          <select value={f.orgaoId} onChange={muda("orgaoId")}>
            <option value="">— escolha —</option>
            {orgaos.map((o) => <option key={o.id} value={o.id}>{o.razao_social}{o.cidade ? ` (${o.cidade}/${o.uf})` : ""}</option>)}
          </select>
        </label>
        <label className={s.campo}>
          <span>Contato</span>
          <select value={f.contatoId} onChange={muda("contatoId")} disabled={!contatos.length}>
            <option value="">{contatos.length ? "— nenhum —" : "cliente sem contatos"}</option>
            {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome_completo}{c.cargo ? ` — ${c.cargo}` : ""}</option>)}
          </select>
          {contato && <small className="detalhe">{[contato.telefone, contato.email].filter(Boolean).join(" · ")}</small>}
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
      </div>
      <div className={s.linhaForm}>
        <button type="button" className="btn-azul" disabled={ocupado || !mudou}
          onClick={() => acao(() => enviar(`/api/processos/${op.id}`, "PATCH", f))}>Salvar dados</button>
        {mudou && <button type="button" className="btn-doc" onClick={() => setF(inicial())}>Desfazer</button>}
        {!mudou && op.origem && <span className="detalhe">Origem: {rotuloOrigem(op.origem)}</span>}
      </div>
    </section>
  );
}

function Historico({ op, etapas, usuarios }: { op: Oportunidade; etapas: EtapaFluxo[]; usuarios: Usuario[] }) {
  const eventos = [...(op.historico_etapas || [])].reverse();
  const quem = (id?: string) => usuarios.find((u) => u.id === id)?.nome;
  return (
    <details className={s.bloco}>
      <summary><h3 style={{ display: "inline" }}>Histórico</h3></summary>
      <ul className={s.historico}>
        {eventos.map((h, i) => (
          <li key={i}>
            <span className="detalhe">{dataBr(h.data_autenticacao || h.data || h.alterado_em?.slice(0, 10))}</span>{" "}
            {h.evento === "resultado"
              ? <>{h.resultado === "ganha" ? "Marcada como ganha" : h.resultado === "perdida" ? `Marcada como perdida${h.motivo ? ` (${rotuloMotivoPerda(h.motivo)})` : ""}` : "Reaberta"}</>
              : <>Etapa: {etapas[h.etapa ?? -1]?.nome || h.nome || "—"}{h.etapa_antiga != null && h.nome ? <span className="detalhe"> (antes: {h.nome})</span> : null}</>}
            {quem(h.alterado_por) ? <span className="detalhe"> · {quem(h.alterado_por)}</span> : null}
          </li>
        ))}
        <li><span className="detalhe">{dataBr(op.data.slice(0, 10))}</span> Aberta{op.criado_por ? <span className="detalhe"> · {op.criado_por.nome}</span> : null}</li>
      </ul>
    </details>
  );
}
