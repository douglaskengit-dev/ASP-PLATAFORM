"use client";

/** Fase 10 — "Entregas ao cliente": lista e registro. Os documentos vão por
 * fora (e-mail, impresso, pendrive…); aqui fica o registro de QUANDO, A QUEM
 * e O QUÊ foi entregue. Permitido também com a OS encerrada. Regras em
 * lib/validacao/encerramento.ts (validarEntrega); a API repete os ⛔.
 *
 *   ⛔ data no futuro / antes dos documentos · contato fora da lista do
 *      cliente ("+ Novo contato" usa o cadastro de contato da Fase 1) ·
 *      nenhum arquivo · meio "outro" sem descrição
 *   ⚠️ mesmo arquivo já entregue ao mesmo contato (com a data) */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/app/components/Modal";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import { enviarJson, novoId } from "@/lib/pwa/sync";
import { mascaraTelefone } from "@/lib/mascaras";
import {
  dataBrCompleta, MEIOS_ENTREGA, mesclar, novoResultado, podeRegistrarEntrega, rotuloMeio, ROTULOS_ENTREGA, temErros,
  contatosAtivos, validarContato, validarEntrega, type ArquivoEntrega, type DadosContato, type EntregaRegistrada, type ResultadoValidacao,
} from "@/lib/validacao";

interface Contato { id: string; nome_completo: string; cargo?: string | null; email: string | null; telefone?: string | null; ativo?: boolean }
type Arquivo = ArquivoEntrega & { href: string };
interface Entrega extends EntregaRegistrada {
  meio: string; meio_outro?: string | null; observacao?: string | null; criado_por_nome?: string | null; criado_em?: string;
}

const campo: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 14,
};
const rotulo: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };

export default function EntregasCliente({ inspecaoId, perfil, versao, onResumo }: {
  inspecaoId: string;
  perfil: string | null;
  versao: number;
  onResumo?: (resumo: string) => void;
}) {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [disponiveis, setDisponiveis] = useState<Arquivo[]>([]);
  const [podeRegistrar, setPodeRegistrar] = useState(false);
  const [tabelaOk, setTabelaOk] = useState(true);
  const [hoje, setHoje] = useState("");
  const [carregado, setCarregado] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);

  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState("");
  const [contatoId, setContatoId] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [meio, setMeio] = useState("");
  const [meioOutro, setMeioOutro] = useState("");
  const [observacao, setObservacao] = useState("");
  const [tentou, setTentou] = useState(false);
  const [servidor, setServidor] = useState<ResultadoValidacao>(novoResultado());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvandoRef = useRef(false);
  const idRef = useRef<string>(novoId());

  const [novoContato, setNovoContato] = useState<DadosContato | null>(null);
  const [contatoServidor, setContatoServidor] = useState<ResultadoValidacao>(novoResultado());
  const [salvandoContato, setSalvandoContato] = useState(false);

  const carregar = useCallback(() => {
    fetch(`/api/inspecoes/${inspecaoId}/entregas`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErroLista(d.erro || "Não foi possível carregar as entregas."); return; }
        setErroLista(null);
        setContatos(d.contatos || []);
        setClienteId(d.clienteId || null);
        setEntregas(d.entregas || []);
        setDisponiveis(d.disponiveis || []);
        setPodeRegistrar(!!d.podeRegistrar);
        setTabelaOk(d.tabelaOk !== false);
        setHoje(d.hoje || "");
      })
      .catch(() => setErroLista("Falha de rede ao carregar as entregas."))
      .finally(() => setCarregado(true));
  }, [inspecaoId]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  useEffect(() => {
    if (!onResumo) return;
    if (!carregado) { onResumo("Carregando…"); return; }
    const ult = entregas[0];
    onResumo(entregas.length === 0 ? "Nenhuma entrega registrada"
      : `${entregas.length} entrega${entregas.length === 1 ? "" : "s"} · última ${dataBrCompleta(ult.data)}${ult.contato_nome ? ` a ${ult.contato_nome}` : ""}`);
  }, [entregas, carregado, onResumo]);

  const validacao = useMemo(() => mesclar(validarEntrega(
    { data, contatoId: contatoId || null, arquivos: marcados, meio: meio || null, meioOutro, observacao },
    { perfil, hoje, contatos, disponiveis, anteriores: entregas },
  ), servidor), [data, contatoId, marcados, meio, meioOutro, observacao, perfil, hoje, contatos, disponiveis, entregas, servidor]);

  const existentesContato = contatos.map((c) => ({ id: c.id, nome_completo: c.nome_completo, email: c.email, ativo: c.ativo !== false }));
  // Desativados não entram em escolha nova; as entregas já registradas
  // mostram o nome gravado (contato_nome).
  const ativos = contatosAtivos(contatos);
  const valContato = useMemo(
    () => (novoContato ? mesclar(validarContato(novoContato, existentesContato), contatoServidor) : novoResultado()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [novoContato, contatos, contatoServidor],
  );

  function abrir() {
    setData(hoje); setContatoId(ativos.length === 1 ? ativos[0].id : ""); setMarcados([]); setMeio(""); setMeioOutro("");
    setObservacao(""); setTentou(false); setServidor(novoResultado()); setErro(null); setNovoContato(null);
    idRef.current = novoId();
    setAberto(true);
  }

  async function salvar() {
    setTentou(true);
    if (temErros(validacao) || salvandoRef.current) return;
    salvandoRef.current = true;
    setSalvando(true);
    setErro(null);
    try {
      const res = await enviarJson(`/api/inspecoes/${inspecaoId}/entregas`, "POST", {
        id: idRef.current, data, contatoId, arquivos: marcados, meio, meioOutro, observacao,
      }, "Entrega ao cliente", idRef.current);
      if (res.queued) { alert("Sem conexão — entrega salva offline e registrada ao reconectar."); setAberto(false); return; }
      if (!res.ok) {
        setErro(res.data?.erro || "Não foi possível registrar a entrega.");
        if (res.data?.erros) setServidor({ erros: res.data.erros, avisos: {} });
        return;
      }
      setAberto(false);
      carregar();
    } finally {
      salvandoRef.current = false;
      setSalvando(false);
    }
  }

  async function retirar(e: Entrega) {
    if (!confirm(`Retirar o registro da entrega de ${dataBrCompleta(e.data)}${e.contato_nome ? ` a ${e.contato_nome}` : ""}?`)) return;
    const r = await fetch(`/api/inspecoes/${inspecaoId}/entregas?entregaId=${e.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.erro || "Não foi possível retirar."); return; }
    carregar();
  }

  async function salvarContato() {
    if (!novoContato || !clienteId || temErros(valContato)) return;
    setSalvandoContato(true);
    try {
      const r = await fetch(`/api/orgaos/${clienteId}/contatos`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(novoContato),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setContatoServidor({ erros: d.erros || { nomeCompleto: [d.erro || "Falha ao salvar o contato."] }, avisos: d.avisos || {} });
        return;
      }
      const c = d.contato as Contato;
      setContatos((l) => [...l, c]);
      setContatoId(c.id);
      setNovoContato(null);
    } catch {
      setContatoServidor({ erros: { nomeCompleto: ["Falha de rede ao salvar o contato."] }, avisos: {} });
    } finally {
      setSalvandoContato(false);
    }
  }

  const hrefDe = (chave?: string) => disponiveis.find((a) => a.chave === chave)?.href;
  const mostrar = (v: string) => tentou || !!v;
  const campoContato = (k: keyof DadosContato, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label style={rotulo}>{label}</label>
      <input {...extra} aria-label={label.replace(" *", "")} style={campo} value={(novoContato?.[k] as string) || ""}
        onChange={(e) => {
          const v = k === "telefone" ? mascaraTelefone(e.target.value) : e.target.value;
          setNovoContato((c) => c && { ...c, [k]: v }); setContatoServidor(novoResultado());
        }} />
      <MensagensCampo r={valContato} campo={k} mostrarErros={!!(novoContato?.[k] as string)?.trim()} />
    </div>
  );

  if (!tabelaOk) {
    return <p className="val-msg val-aviso" style={{ margin: 0 }}>⚠️ O registro de entregas ainda não está disponível — falta rodar a migração da Fase 10 no banco.</p>;
  }

  return (
    <div>
      <p className="detalhe" style={{ marginTop: 0 }}>
        Os documentos são enviados ao cliente fora do sistema; registre aqui quando, a quem e o que foi entregue.
      </p>
      {erroLista && <p className="erro-texto" style={{ margin: "0 0 8px" }}>{erroLista}</p>}
      {podeRegistrarEntrega(perfil) && podeRegistrar && (
        <button className="btn-azul" onClick={abrir} style={{ marginBottom: 10 }}>+ Registrar entrega</button>
      )}
      {entregas.length === 0 ? (
        <p className="vazio" style={{ margin: 0 }}>{carregado ? "Nenhuma entrega registrada." : "Carregando…"}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entregas.map((e) => (
            <div key={e.id} className="linha-item" style={{ borderLeft: "3px solid var(--primaria)", paddingLeft: 12, marginTop: 0 }}>
              <div className="linha-texto">
                <div style={{ color: "var(--texto)" }}>
                  <strong>📦 {dataBrCompleta(e.data)}</strong> — {e.contato_nome || "contato removido"} · {rotuloMeio(e.meio, e.meio_outro)}
                </div>
                <ul className="detalhe" style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                  {(e.arquivos || []).map((a, i) => {
                    const href = hrefDe(a.chave);
                    return <li key={i}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{a.nome}</a> : a.nome}</li>;
                  })}
                </ul>
                {e.observacao && <div className="detalhe" style={{ margin: 0 }}>Obs.: {e.observacao}</div>}
                <div className="detalhe" style={{ margin: 0 }}>Registrado{e.criado_por_nome ? ` por ${e.criado_por_nome}` : ""}</div>
              </div>
              {podeRegistrarEntrega(perfil) && (
                <span className="linha-acoes">
                  <button className="btn-dl btn-sec" style={{ color: "#dc2626", borderColor: "#dc2626" }} onClick={() => retirar(e)}>Retirar</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {aberto && (
        <Modal titulo="📦 Registrar entrega ao cliente" onFechar={() => !salvando && setAberto(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={rotulo} htmlFor="entrega-data">Data da entrega *</label>
                <input id="entrega-data" type="date" style={campo} value={data} max={hoje}
                  onChange={(e) => { setData(e.target.value); setServidor(novoResultado()); }} />
                <MensagensCampo r={validacao} campo="data" mostrarErros={mostrar(data)} />
              </div>
              <div>
                <label style={rotulo} htmlFor="entrega-meio">Meio *</label>
                <select id="entrega-meio" style={campo} value={meio} onChange={(e) => { setMeio(e.target.value); setServidor(novoResultado()); }}>
                  <option value="">— escolha —</option>
                  {MEIOS_ENTREGA.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
                </select>
                <MensagensCampo r={validacao} campo="meio" mostrarErros={tentou} />
                {meio === "outro" && (
                  <>
                    <input style={{ ...campo, marginTop: 6 }} value={meioOutro} maxLength={120} placeholder="Qual? (ex.: WeTransfer)"
                      aria-label="Descreva o meio" onChange={(e) => setMeioOutro(e.target.value)} />
                    <MensagensCampo r={validacao} campo="meioOutro" mostrarErros={tentou || !!meioOutro} />
                  </>
                )}
              </div>
            </div>

            <div>
              <label style={rotulo} htmlFor="entrega-contato">Contato que recebeu *</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select id="entrega-contato" style={{ ...campo, flex: "1 1 220px", width: "auto" }} value={contatoId}
                  onChange={(e) => { setContatoId(e.target.value); setServidor(novoResultado()); }}>
                  <option value="">— escolha um contato do cliente —</option>
                  {ativos.map((c) => <option key={c.id} value={c.id}>{c.nome_completo}{c.cargo ? ` (${c.cargo})` : ""}</option>)}
                </select>
                {clienteId && !novoContato && (
                  <button type="button" className="btn-azul btn-sec" onClick={() => { setNovoContato({ nomeCompleto: "", cargo: "", email: "", telefone: "" }); setContatoServidor(novoResultado()); }}>
                    + Novo contato
                  </button>
                )}
              </div>
              {ativos.length === 0 && <p className="val-msg val-aviso" style={{ margin: "4px 0 0" }}>⚠️ O cliente não tem contatos cadastrados — cadastre quem recebeu.</p>}
              <MensagensCampo r={validacao} campo="contato" mostrarErros={tentou} />
            </div>

            {novoContato && (
              <div className="val-contato">
                <strong style={{ fontSize: 13.5 }}>Novo contato do cliente</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {campoContato("nomeCompleto", "Nome completo *")}
                  {campoContato("cargo", "Cargo *")}
                  {campoContato("email", "E-mail *", { type: "email", inputMode: "email" })}
                  {campoContato("telefone", "Telefone (com DDD)", { inputMode: "numeric", maxLength: 15, placeholder: "(11) 91234-5678" })}
                </div>
                <p className="detalhe" style={{ margin: 0 }}>Fica gravado no cadastro do cliente.</p>
                <div className="val-acoes">
                  <button type="button" className="btn-azul" disabled={salvandoContato || temErros(validarContato(novoContato, existentesContato))} onClick={salvarContato}>
                    {salvandoContato ? "Salvando…" : "Salvar contato e usar"}
                  </button>
                  <button type="button" className="btn-azul btn-sec" disabled={salvandoContato} onClick={() => setNovoContato(null)}>Cancelar</button>
                </div>
              </div>
            )}

            <fieldset style={{ border: "1px solid var(--borda)", borderRadius: 8, padding: "8px 12px", margin: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: 13 }}>Arquivos entregues *</legend>
              {disponiveis.length === 0 ? (
                <p className="vazio" style={{ margin: 0 }}>Nenhum documento final nesta OS (relatório aprovado/assinado, laudo, RDO .docx ou anexo).</p>
              ) : disponiveis.map((a) => (
                <label key={a.chave} style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "6px 0", cursor: "pointer" }}>
                  <input type="checkbox" style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }} checked={marcados.includes(a.chave)}
                    onChange={(e) => { setServidor(novoResultado()); setMarcados((m) => (e.target.checked ? [...m, a.chave] : m.filter((x) => x !== a.chave))); }} />
                  <span style={{ fontSize: 14, color: "var(--texto)", minWidth: 0, overflowWrap: "anywhere" }}>
                    {a.nome}{a.data ? <span className="detalhe" style={{ margin: 0 }}> · {dataBrCompleta(a.data)}</span> : null}
                  </span>
                </label>
              ))}
              <MensagensCampo r={validacao} campo="arquivos" mostrarErros={tentou} />
            </fieldset>

            <div>
              <label style={rotulo} htmlFor="entrega-obs">Observação</label>
              <textarea id="entrega-obs" rows={2} style={campo} value={observacao} maxLength={1000} onChange={(e) => setObservacao(e.target.value)} />
              <MensagensCampo r={validacao} campo="observacao" />
            </div>

            <ResumoValidacao r={validacao} rotulos={ROTULOS_ENTREGA} mostrarErros={tentou} />
            {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
            <div className="val-acoes">
              <button className="btn-azul" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Registrar entrega"}</button>
              <button className="btn-azul btn-sec" disabled={salvando} onClick={() => setAberto(false)}>Cancelar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
