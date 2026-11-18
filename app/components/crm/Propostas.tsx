"use client";

/** Versões da proposta da oportunidade: data de envio, valor, observação e
 * arquivo opcional (PDF, Word ou Excel). A versão mais nova com valor define
 * o valor da oportunidade. */
import { useCallback, useEffect, useRef, useState } from "react";
import { dataBr, moeda } from "./tipos";
import s from "./crm.module.css";

interface Versao {
  id: string; versao: number; data: string; valor: number | null; observacao: string | null;
  arquivo_nome: string | null; autor: string | null; minha: boolean;
}

export default function Propostas({ processoId, hoje, onValorMudou }: {
  processoId: string; hoje: string; onValorMudou: () => Promise<void> | void;
}) {
  const [lista, setLista] = useState<Versao[] | null>(null);
  const [aviso, setAviso] = useState("");
  const [abrir, setAbrir] = useState(false);
  const [data, setData] = useState(hoje);
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
    setAviso(d.aviso || "");
  }, [processoId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true); setErro("");
    try {
      const fd = new FormData();
      fd.append("data", data);
      fd.append("valor", valor);
      fd.append("observacao", observacao);
      if (arquivo) fd.append("arquivo", arquivo);
      const r = await fetch(`/api/processos/${processoId}/propostas`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro || "Falha ao registrar a proposta."); return; }
      setValor(""); setObservacao(""); setArquivo(null); setAbrir(false);
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

  const proxima = (lista?.[0]?.versao || 0) + 1;

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
          <p className="detalhe" style={{ margin: 0 }}>Com valor, ele passa a ser o valor da oportunidade.</p>
          {erro && <p className={s.erro} role="alert">{erro}</p>}
          <div className={s.linhaForm}>
            <button type="submit" className="btn-azul" disabled={salvando}>{salvando ? "Salvando..." : `Registrar versão ${proxima}`}</button>
            <button type="button" className="btn-doc" onClick={() => { setAbrir(false); setErro(""); }}>Cancelar</button>
          </div>
        </form>
      )}
      {!abrir && erro && <p className={s.erro} role="alert">{erro}</p>}
      {lista === null ? <p className="detalhe">Carregando...</p> : lista.length === 0 ? (
        !aviso && <p className="detalhe">Nenhuma proposta registrada.</p>
      ) : (
        <ul className={s.timeline}>
          {lista.map((v, i) => (
            <li key={v.id}>
              <span className={s.timelineIcone} aria-hidden="true">📄</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className={s.timelineTopo}>
                  <strong>Versão {v.versao}</strong>
                  {i === 0 && <span className={s.selo}>atual</span>}
                  <span className="detalhe">{dataBr(v.data)}{v.autor ? ` · ${v.autor}` : ""}</span>
                  {v.valor != null && <strong className={s.cardValor}>{moeda(v.valor, true)}</strong>}
                  {v.minha && <button type="button" className={s.botaoTexto} aria-label={`Apagar a versão ${v.versao}`} onClick={() => apagar(v)}>apagar</button>}
                </div>
                {v.arquivo_nome && (
                  <a className="btn-dl btn-sec" style={{ display: "inline-block", marginTop: 4 }}
                    href={`/api/processos/${processoId}/propostas?arquivo=${v.id}`}>📎 {v.arquivo_nome}</a>
                )}
                {v.observacao && <p className={s.timelineTexto}>{v.observacao}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
