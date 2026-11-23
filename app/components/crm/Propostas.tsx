"use client";

/** Versões da proposta da oportunidade: data de envio, validade, valor,
 * observação e arquivo opcional (PDF, Word ou Excel). A versão mais nova com
 * valor define o valor da oportunidade. Cada versão tem situação: enviada,
 * aceita ou recusada (vencida e substituída são calculadas). */
import { useCallback, useEffect, useRef, useState } from "react";
import { diasParaValidade, situacaoPropostaVista, somarDias, type SituacaoProposta, type SituacaoPropostaVista } from "@/lib/validacao";
import { dataBr, moeda } from "./tipos";
import s from "./crm.module.css";

interface Versao {
  id: string; versao: number; data: string; valor: number | null; observacao: string | null;
  validade: string | null; situacao: SituacaoProposta; situacao_em: string | null;
  arquivo_nome: string | null; autor: string | null; minha: boolean;
}

const ROTULO: Record<SituacaoPropostaVista, string> = {
  enviada: "aguardando resposta", aceita: "aceita", recusada: "recusada", vencida: "vencida", substituida: "substituída",
};
const SELO: Partial<Record<SituacaoPropostaVista, string>> = {
  aceita: s.seloGanha, recusada: s.seloPerdida, vencida: s.seloAtraso,
};

/** "válida até 20/12/2026 · faltam 5 dias" (ou "venceu há 3 dias"). */
function textoValidade(validade: string, hoje: string, vista: SituacaoPropostaVista): string {
  const base = `válida até ${dataBr(validade)}`;
  if (vista !== "enviada" && vista !== "vencida") return base;
  const n = diasParaValidade(validade, hoje);
  if (n == null) return base;
  if (n === 0) return `${base} · vence hoje`;
  if (n > 0) return `${base} · ${n === 1 ? "falta 1 dia" : `faltam ${n} dias`}`;
  return `${base} · venceu há ${-n === 1 ? "1 dia" : `${-n} dias`}`;
}

export default function Propostas({ processoId, hoje, aberta, onValorMudou }: {
  processoId: string; hoje: string; aberta: boolean; onValorMudou: () => Promise<void> | void;
}) {
  const [lista, setLista] = useState<Versao[] | null>(null);
  const [comSituacao, setComSituacao] = useState(true);
  const [aviso, setAviso] = useState("");
  const [abrir, setAbrir] = useState(false);
  const [data, setData] = useState(hoje);
  const [validade, setValidade] = useState("");
  const [mudando, setMudando] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const campoArquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/processos/${processoId}/propostas`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.erro || "Falha ao carregar as propostas."); setLista([]); return; }
    setLista(d.propostas || []);
    setComSituacao(d.comSituacao !== false);
    setAviso(d.aviso || "");
  }, [processoId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setErro("");
    try {
      const fd = new FormData();
      fd.append("data", data);
      if (validade) fd.append("validade", validade);
      fd.append("valor", valor);
      fd.append("observacao", observacao);
      if (arquivo) fd.append("arquivo", arquivo);
      const r = await fetch(`/api/processos/${processoId}/propostas`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro || "Falha ao registrar a proposta."); return; }
      setValor(""); setObservacao(""); setArquivo(null); setValidade(""); setAbrir(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
      await carregar();
      await onValorMudou();
    } finally { setSalvando(false); }
  }

  async function apagar(v: Versao) {
    if (!confirm(`Apagar a versão ${v.versao} da proposta${v.arquivo_nome ? " e o arquivo dela" : ""}? Não dá para desfazer.`)) return;
    setErro("");
    const r = await fetch(`/api/processos/${processoId}/propostas?proposta=${v.id}`, { method: "DELETE" });
    if (!r.ok) { setErro((await r.json().catch(() => ({}))).erro || "Falha ao apagar."); return; }
    await carregar();
    await onValorMudou();
  }

  async function mudarSituacao(v: Versao, situacao: SituacaoProposta) {
    setErro(""); setMudando(v.id);
    try {
      const r = await fetch(`/api/processos/${processoId}/propostas`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposta: v.id, situacao }),
      });
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).erro || "Falha ao mudar a situação."); return; }
      await carregar();
      if (situacao === "aceita") await onValorMudou();
    } finally { setMudando(null); }
  }

  const proxima = (lista?.[0]?.versao || 0) + 1;
  const aceita = lista?.find((v) => v.situacao === "aceita");

  return (
    <section className={s.bloco}>
      <h3>
        Propostas {lista && lista.length > 0 && <span className={s.selo}>{lista.length}</span>}
        {!abrir && !aviso && (
          <button type="button" className="btn-doc" style={{ marginLeft: "auto" }} onClick={() => setAbrir(true)}>＋ Nova versão</button>
        )}
      </h3>
      {aviso && <p className={s.aviso}>{aviso}</p>}
      {abrir && (
        <form onSubmit={registrar} className={s.caixaAcao}>
          <strong style={{ fontSize: 13 }}>Versão {proxima}</strong>
          <div className={s.linhaForm}>
            <label className={s.campo}>
              <span>Enviada em</span>
              <input type="date" value={data} max={hoje} required onChange={(e) => setData(e.target.value)} />
            </label>
            {comSituacao && (
              <label className={s.campo}>
                <span>Válida até (opcional)</span>
                <input type="date" value={validade} min={data} onChange={(e) => setValidade(e.target.value)} />
              </label>
            )}
            <label className={s.campo}>
              <span>Valor (R$)</span>
              <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 12.500,00" />
            </label>
          </div>
          <label className={s.campo}>
            <span>Arquivo (PDF, Word ou Excel, até 20 MB)</span>
            <input ref={campoArquivo} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
          </label>
          <label className={s.campo}>
            <span>Observação</span>
            <textarea rows={2} value={observacao} maxLength={2000} onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: desconto de 5% pedido pelo cliente" />
          </label>
          {comSituacao && (
            <div className={s.linhaForm} style={{ alignItems: "center" }}>
              <span className="detalhe">Validade de</span>
              {[15, 30, 60].map((n) => (
                <button key={n} type="button" className="btn-doc" onClick={() => setValidade(somarDias(data || hoje, n))}>{n} dias</button>
              ))}
            </div>
          )}
          <p className="detalhe" style={{ margin: 0 }}>Com valor, ele passa a ser o valor da oportunidade.</p>
          {erro && <p className={s.erro} role="alert">{erro}</p>}
          <div className={s.linhaForm}>
            <button type="submit" className="btn-azul" disabled={salvando}>{salvando ? "Salvando..." : `Registrar versão ${proxima}`}</button>
            <button type="button" className="btn-doc" onClick={() => { setAbrir(false); setErro(""); }}>Cancelar</button>
          </div>
        </form>
      )}
      {!abrir && erro && <p className={s.erro} role="alert">{erro}</p>}
      {aberta && aceita && (
        <p className={s.aviso}>A versão {aceita.versao} foi aceita. Use “Fechar ganho” acima para abrir o projeto e reservar as datas da Operação.</p>
      )}
      {lista === null ? <p className="detalhe">Carregando...</p> : lista.length === 0 ? (
        !aviso && <p className="detalhe">Nenhuma proposta registrada.</p>
      ) : (
        <ul className={s.timeline}>
          {lista.map((v, i) => {
            const vista = situacaoPropostaVista(v, i === 0, hoje);
            const ocupada = mudando === v.id;
            return (
            <li key={v.id}>
              <span className={s.timelineIcone} aria-hidden="true">📄</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className={s.timelineTopo}>
                  <strong>Versão {v.versao}</strong>
                  {i === 0 && <span className={s.selo}>atual</span>}
                  {comSituacao && <span className={`${s.selo} ${SELO[vista] || ""}`}>{ROTULO[vista]}</span>}
                  <span className="detalhe">{dataBr(v.data)}{v.autor ? ` · ${v.autor}` : ""}</span>
                  {v.valor != null && <strong className={s.cardValor}>{moeda(v.valor, true)}</strong>}
                  {v.minha && <button type="button" className={s.botaoTexto} aria-label={`Apagar a versão ${v.versao}`} onClick={() => apagar(v)}>apagar</button>}
                </div>
                {comSituacao && (
                  <div className={s.timelineTopo} style={{ marginTop: 2 }}>
                    {v.validade && <span className="detalhe">{textoValidade(v.validade, hoje, vista)}</span>}
                    {v.situacao !== "enviada" && v.situacao_em && <span className="detalhe">{ROTULO[v.situacao]} em {dataBr(v.situacao_em)}</span>}
                    {v.situacao === "enviada" ? (
                      <>
                        <button type="button" className={s.botaoTexto} disabled={ocupada} onClick={() => mudarSituacao(v, "aceita")}>marcar aceita</button>
                        <button type="button" className={s.botaoTexto} disabled={ocupada} onClick={() => mudarSituacao(v, "recusada")}>marcar recusada</button>
                      </>
                    ) : (
                      <button type="button" className={s.botaoTexto} disabled={ocupada} onClick={() => mudarSituacao(v, "enviada")}>desfazer</button>
                    )}
                  </div>
                )}
                {v.arquivo_nome && (
                  <a className="btn-dl btn-sec" style={{ display: "inline-block", marginTop: 4 }}
                    href={`/api/processos/${processoId}/propostas?arquivo=${v.id}`}>📎 {v.arquivo_nome}</a>
                )}
                {v.observacao && <p className={s.timelineTexto}>{v.observacao}</p>}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
