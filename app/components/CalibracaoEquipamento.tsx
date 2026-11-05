"use client";

/** Calibração de um equipamento do Catálogo (dentro da ficha do equipamento).
 *
 * Grava na hora (não espera o "Salvar" da ficha): marcação "exige
 * calibração", unidades (nº de série/patrimônio) e cada calibração
 * registrada. Registrar uma calibração nova guarda a anterior no histórico.
 * Regras em lib/validacao/calibracao.ts; API em /api/calibracao. */
import { useEffect, useMemo, useRef, useState } from "react";
import { MensagensCampo } from "./MensagensCampo";
import {
  dataBrCalibracao, ICONE_SITUACAO_CALIBRACAO, novoResultado, ROTULO_SITUACAO_CALIBRACAO, situacaoCalibracao,
  temErros, textoVencimento, validarCalibracao, validarUnidade, VALIDADE_MESES_PADRAO, vencimentoCalibracao,
  type ResultadoValidacao, type SituacaoCalibracao, type UnidadeEquipamento,
} from "@/lib/validacao";

const campo: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--borda)",
  background: "var(--bg-card)", color: "var(--texto)", fontSize: 13.5,
};
const rot: React.CSSProperties = { fontWeight: 600, fontSize: 12.5, display: "block", marginBottom: 4 };
const grade: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 };

export const COR_SITUACAO: Record<SituacaoCalibracao, { fundo: string; texto: string }> = {
  em_dia: { fundo: "#dcfce7", texto: "#166534" },
  vence_breve: { fundo: "#fef3c7", texto: "#92400e" },
  vencida: { fundo: "#fee2e2", texto: "#b91c1c" },
  sem_calibracao: { fundo: "#e2e8f0", texto: "#334155" },
};

export function SeloCalibracao({ situacao, texto }: { situacao: SituacaoCalibracao; texto?: string }) {
  const c = COR_SITUACAO[situacao];
  return (
    <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: c.fundo, color: c.texto, whiteSpace: "nowrap" }}>
      {ICONE_SITUACAO_CALIBRACAO[situacao]} {texto || ROTULO_SITUACAO_CALIBRACAO[situacao]}
    </span>
  );
}

interface FormCal {
  calibrado_em: string; usarVencimento: boolean; validade_meses: string; vence_em: string;
  certificado: string; laboratorio: string; certificado_path: string | null; nomePdf?: string;
}
const formVazio = (): FormCal => ({
  calibrado_em: "", usarVencimento: false, validade_meses: String(VALIDADE_MESES_PADRAO), vence_em: "",
  certificado: "", laboratorio: "", certificado_path: null,
});
const dadosCal = (f: FormCal) => ({
  calibrado_em: f.calibrado_em,
  validade_meses: f.usarVencimento || f.validade_meses === "" ? null : Number(f.validade_meses),
  vence_em: f.usarVencimento ? f.vence_em : "",
  certificado: f.certificado, laboratorio: f.laboratorio, certificado_path: f.certificado_path,
});

async function api(metodo: string, corpo?: any, query = "") {
  try {
    const res = await fetch(`/api/calibracao${query}`, {
      method: metodo, headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return { ok: res.ok, d: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, d: { erro: "Sem conexão — tente de novo." } };
  }
}

export default function CalibracaoEquipamento({ equipamentoId, exige, unidades, hoje, podeEditar, onMudou }: {
  equipamentoId: string;
  exige: boolean;
  /** Unidades deste equipamento. */
  unidades: UnidadeEquipamento[];
  hoje: string;
  podeEditar: boolean;
  /** Algo foi gravado: a página relê /api/calibracao. */
  onMudou: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /** Formulário aberto: nova unidade, ou calibração de uma unidade. */
  const [nova, setNova] = useState<{ identificacao: string; observacao: string; comCal: boolean; cal: FormCal } | null>(null);
  const [calDe, setCalDe] = useState<{ unidadeId: string; cal: FormCal } | null>(null);
  const [editando, setEditando] = useState<{ id: string; identificacao: string; observacao: string } | null>(null);
  const [historico, setHistorico] = useState<{ unidadeId: string; lista: any[] | null } | null>(null);
  const [tentou, setTentou] = useState(false);
  const [enviandoPdf, setEnviandoPdf] = useState(false);

  const ordenadas = useMemo(() => unidades.slice().sort((a, b) =>
    Number(b.ativo !== false) - Number(a.ativo !== false) || a.identificacao.localeCompare(b.identificacao, "pt-BR")), [unidades]);

  // fechar com PDF enviado e não registrado: descarta o arquivo
  function descartarPdf(f: FormCal | undefined | null) {
    if (f?.certificado_path) fetch(`/api/calibracao/certificado?caminho=${encodeURIComponent(f.certificado_path)}`, { method: "DELETE" }).catch(() => {});
  }
  const abertos = useRef<(FormCal | undefined)[]>([]);
  abertos.current = [nova?.cal, calDe?.cal];
  useEffect(() => () => abertos.current.forEach(descartarPdf), []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function marcarExige(v: boolean) {
    setOcupado(true); setErro(null);
    const r = await api("PATCH", { acao: "exige", equipamentoId, exige: v });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao salvar."); return; }
    onMudou();
  }

  async function enviarPdf(arquivo: File, aplicar: (caminho: string, nome: string) => void) {
    setEnviandoPdf(true); setErro(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      const res = await fetch("/api/calibracao/certificado", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro || "Falha ao enviar o PDF."); return; }
      aplicar(d.caminho, arquivo.name);
    } catch {
      setErro("Sem conexão — o PDF não foi enviado.");
    } finally {
      setEnviandoPdf(false);
    }
  }

  const rNova: ResultadoValidacao = useMemo(() => {
    if (!nova) return novoResultado();
    const r = validarUnidade({ identificacao: nova.identificacao }, unidades);
    if (nova.comCal) {
      const rc = validarCalibracao(dadosCal(nova.cal), hoje);
      Object.entries(rc.erros).forEach(([k, l]) => (r.erros[k] = l));
      Object.entries(rc.avisos).forEach(([k, l]) => (r.avisos[k] = l));
    }
    return r;
  }, [nova, unidades, hoje]);
  const rCal = useMemo(() => calDe ? validarCalibracao(dadosCal(calDe.cal), hoje) : novoResultado(), [calDe, hoje]);
  const rEdit = useMemo(() => editando ? validarUnidade(editando, unidades) : novoResultado(), [editando, unidades]);

  async function criarUnidade() {
    if (!nova) return;
    setTentou(true);
    if (temErros(rNova)) return;
    setOcupado(true); setErro(null);
    const r = await api("POST", {
      acao: "unidade", equipamentoId, identificacao: nova.identificacao, observacao: nova.observacao,
      calibracao: nova.comCal ? dadosCal(nova.cal) : null,
    });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao criar a unidade."); return; }
    setNova(null); setTentou(false); onMudou();
  }

  async function registrar() {
    if (!calDe) return;
    setTentou(true);
    if (temErros(rCal)) return;
    setOcupado(true); setErro(null);
    const r = await api("POST", { acao: "calibracao", unidadeId: calDe.unidadeId, ...dadosCal(calDe.cal) });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao registrar a calibração."); return; }
    setCalDe(null); setTentou(false);
    if (historico?.unidadeId === calDe.unidadeId) verHistorico(calDe.unidadeId, true);
    onMudou();
  }

  async function salvarEdicao() {
    if (!editando || temErros(rEdit)) return;
    setOcupado(true); setErro(null);
    const r = await api("PATCH", { acao: "unidade", id: editando.id, identificacao: editando.identificacao, observacao: editando.observacao });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao salvar."); return; }
    setEditando(null); onMudou();
  }

  async function alternarAtiva(u: UnidadeEquipamento) {
    setOcupado(true); setErro(null);
    const r = await api("PATCH", { acao: "unidade", id: u.id, ativo: u.ativo === false });
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao salvar."); return; }
    onMudou();
  }

  async function excluirUnidade(u: UnidadeEquipamento) {
    if (!confirm(`Excluir a unidade “${u.identificacao}” e todo o histórico de calibração dela? Para tirar de uso e manter o histórico, use “Desativar”.`)) return;
    setOcupado(true); setErro(null);
    const r = await api("DELETE", undefined, `?unidadeId=${u.id}`);
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao excluir."); return; }
    if (historico?.unidadeId === u.id) setHistorico(null);
    onMudou();
  }

  async function verHistorico(unidadeId: string, forcar = false) {
    if (!forcar && historico?.unidadeId === unidadeId) { setHistorico(null); return; }
    setHistorico({ unidadeId, lista: null });
    const r = await api("GET", undefined, `?historico=${unidadeId}`);
    setHistorico({ unidadeId, lista: r.ok ? r.d.calibracoes || [] : [] });
    if (!r.ok) setErro(r.d?.erro || "Falha ao ler o histórico.");
  }

  async function excluirRegistro(c: any) {
    if (!confirm(`Excluir o registro da calibração de ${dataBrCalibracao(c.calibrado_em)}? Use só para lançamento errado — a calibração vigente volta a ser a anterior.`)) return;
    setOcupado(true); setErro(null);
    const r = await api("DELETE", undefined, `?calibracaoId=${c.id}`);
    setOcupado(false);
    if (!r.ok) { setErro(r.d?.erro || "Falha ao excluir."); return; }
    verHistorico(c.unidade_id, true); onMudou();
  }

  function camposCalibracao(f: FormCal, set: (f: FormCal) => void, r: ResultadoValidacao) {
    const vence = vencimentoCalibracao(dadosCal(f));
    return (
      <>
        <div style={grade}>
          <div>
            <label style={rot}>Data da calibração *</label>
            <input type="date" style={campo} value={f.calibrado_em} max={hoje}
              className={tentou && r.erros.calibrado_em ? "val-invalido" : undefined}
              onChange={(e) => set({ ...f, calibrado_em: e.target.value })} />
            <MensagensCampo r={r} campo="calibrado_em" mostrarErros={tentou} />
          </div>
          {f.usarVencimento ? (
            <div>
              <label style={rot}>Vencimento *</label>
              <input type="date" style={campo} value={f.vence_em} min={f.calibrado_em || undefined}
                className={tentou && r.erros.vence_em ? "val-invalido" : undefined}
                onChange={(e) => set({ ...f, vence_em: e.target.value })} />
              <MensagensCampo r={r} campo="vence_em" mostrarErros={tentou} />
            </div>
          ) : (
            <div>
              <label style={rot}>Validade (meses) *</label>
              <input type="number" min={1} max={120} style={campo} value={f.validade_meses}
                className={tentou && r.erros.validade_meses ? "val-invalido" : undefined}
                onChange={(e) => set({ ...f, validade_meses: e.target.value })} />
              <MensagensCampo r={r} campo="validade_meses" mostrarErros={tentou} />
            </div>
          )}
          <div>
            <label style={rot}>Nº do certificado</label>
            <input style={campo} value={f.certificado} maxLength={120} onChange={(e) => set({ ...f, certificado: e.target.value })} />
          </div>
          <div>
            <label style={rot}>Laboratório</label>
            <input style={campo} value={f.laboratorio} maxLength={160} onChange={(e) => set({ ...f, laboratorio: e.target.value })} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <button type="button" className="secao-link" onClick={() => set({ ...f, usarVencimento: !f.usarVencimento })}>
            {f.usarVencimento ? "Informar a validade em meses" : "Informar a data de vencimento"}
          </button>
          {vence && <span className="detalhe" style={{ margin: 0 }}>Vence em {dataBrCalibracao(vence)}</span>}
        </div>
        <div style={{ marginTop: 8 }}>
          <label style={rot}>Certificado em PDF (opcional, até 4 MB)</label>
          {f.certificado_path ? (
            <span className="detalhe" style={{ margin: 0 }}>
              📄 {f.nomePdf || "PDF enviado"}{" "}
              <button type="button" className="secao-link" onClick={() => { descartarPdf(f); set({ ...f, certificado_path: null, nomePdf: undefined }); }}>remover</button>
            </span>
          ) : (
            <input type="file" accept="application/pdf" disabled={enviandoPdf} aria-label="Enviar certificado em PDF"
              onChange={(e) => { const a = e.target.files?.[0]; if (a) enviarPdf(a, (c, n) => set({ ...f, certificado_path: c, nomePdf: n })); e.target.value = ""; }} />
          )}
          {enviandoPdf && <span className="detalhe"> enviando…</span>}
        </div>
      </>
    );
  }

  const caixa: React.CSSProperties = { border: "1px solid var(--borda)", borderRadius: 10, padding: 12, marginTop: 8 };

  return (
    <div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 13.5 }}>
        <input type="checkbox" checked={exige} disabled={!podeEditar || ocupado} onChange={(e) => marcarExige(e.target.checked)} />
        Este equipamento exige calibração
      </label>
      <p className="detalhe" style={{ margin: "4px 0 0" }}>
        Cada unidade (nº de série ou patrimônio) tem a sua calibração. Todos os usuários recebem aviso 30 dias e 7 dias
        antes do vencimento, no dia e, depois de vencida, uma vez por semana. O agendamento e o checklist da OS
        avisam quando a calibração não cobre a visita. O que se faz aqui é gravado na hora.
      </p>
      {erro && <p className="val-msg val-erro" style={{ margin: "6px 0 0" }}>⛔ {erro}</p>}

      {(exige || unidades.length > 0) && (
        <div style={{ marginTop: 8 }}>
          {exige && unidades.length === 0 && <p className="vazio" style={{ margin: "6px 0" }}>Nenhuma unidade cadastrada.</p>}
          {ordenadas.map((u) => {
            const inativa = u.ativo === false;
            const sit = situacaoCalibracao(u.vence_em, hoje);
            return (
              <div key={u.id} style={{ ...caixa, opacity: inativa ? 0.7 : 1 }}>
                {editando?.id === u.id ? (
                  <div style={grade}>
                    <div>
                      <label style={rot}>Nº de série / patrimônio *</label>
                      <input style={campo} value={editando.identificacao} maxLength={80}
                        onChange={(e) => setEditando({ ...editando, identificacao: e.target.value })} />
                      <MensagensCampo r={rEdit} campo="identificacao" />
                    </div>
                    <div>
                      <label style={rot}>Observação</label>
                      <input style={campo} value={editando.observacao} onChange={(e) => setEditando({ ...editando, observacao: e.target.value })} />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <button className="btn-dl btn-sec" onClick={() => setEditando(null)}>Cancelar</button>
                      <button className="btn-dl" disabled={ocupado || temErros(rEdit)} onClick={salvarEdicao}>Salvar</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <strong style={{ color: "var(--texto)" }}>{u.identificacao}</strong>
                        {inativa ? <span className="detalhe" style={{ margin: 0 }}>(desativada)</span> : <SeloCalibracao situacao={sit} />}
                      </div>
                      <span className="detalhe" style={{ display: "block" }}>
                        {u.vence_em
                          ? <>Calibrada em {dataBrCalibracao(u.calibrado_em)} · {textoVencimento(u.vence_em, hoje)}</>
                          : "Sem calibração registrada"}
                        {u.certificado && <> · Cert. {u.certificado}</>}
                        {u.laboratorio && <> · {u.laboratorio}</>}
                        {u.certificado_path && (
                          <> · <a href={`/api/calibracao/certificado?caminho=${encodeURIComponent(u.certificado_path)}`} target="_blank" rel="noreferrer">certificado (PDF)</a></>
                        )}
                      </span>
                      {u.observacao && <span className="detalhe" style={{ display: "block" }}>{u.observacao}</span>}
                    </div>
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {podeEditar && !inativa && (
                        <button className="btn-dl" disabled={ocupado} onClick={() => { descartarPdf(calDe?.cal); setTentou(false); setCalDe({ unidadeId: u.id, cal: formVazio() }); }}>
                          Registrar calibração
                        </button>
                      )}
                      <button className="btn-dl btn-sec" onClick={() => verHistorico(u.id)}>
                        {historico?.unidadeId === u.id ? "Fechar histórico" : "Histórico"}
                      </button>
                      {podeEditar && (
                        <>
                          <button className="btn-dl btn-sec" onClick={() => setEditando({ id: u.id, identificacao: u.identificacao, observacao: u.observacao || "" })}>Editar</button>
                          <button className="btn-dl btn-sec" disabled={ocupado} onClick={() => alternarAtiva(u)}>{inativa ? "Reativar" : "Desativar"}</button>
                          <button className="btn-dl btn-sec btn-perigo" disabled={ocupado} onClick={() => excluirUnidade(u)}>Excluir</button>
                        </>
                      )}
                    </span>
                  </div>
                )}

                {calDe?.unidadeId === u.id && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--borda)", paddingTop: 10 }}>
                    <strong style={{ fontSize: 13 }}>Nova calibração — {u.identificacao}</strong>
                    {u.vence_em && <p className="detalhe" style={{ margin: "2px 0 8px" }}>A atual (vence {dataBrCalibracao(u.vence_em)}) vai para o histórico.</p>}
                    {camposCalibracao(calDe.cal, (cal) => setCalDe({ ...calDe, cal }), rCal)}
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                      <button className="btn-dl btn-sec" onClick={() => { descartarPdf(calDe.cal); setCalDe(null); setTentou(false); }}>Cancelar</button>
                      <button className="btn-dl" disabled={ocupado || enviandoPdf || (tentou && temErros(rCal))} onClick={registrar}>
                        {ocupado ? "Salvando…" : "Registrar"}
                      </button>
                    </div>
                  </div>
                )}

                {historico?.unidadeId === u.id && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--borda)", paddingTop: 8 }}>
                    {historico.lista === null ? <span className="detalhe">carregando…</span>
                      : historico.lista.length === 0 ? <span className="vazio">Nenhuma calibração registrada.</span>
                      : historico.lista.map((c: any, k: number) => (
                        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "5px 0", borderBottom: "1px solid var(--borda)", fontSize: 13 }}>
                          <span>
                            {k === 0 ? "▶ " : ""}{dataBrCalibracao(c.calibrado_em)} → vence {dataBrCalibracao(c.vence_em)}
                            {c.certificado && ` · Cert. ${c.certificado}`}{c.laboratorio && ` · ${c.laboratorio}`}
                            {c.certificado_path && <> · <a href={`/api/calibracao/certificado?caminho=${encodeURIComponent(c.certificado_path)}`} target="_blank" rel="noreferrer">PDF</a></>}
                            <span className="detalhe" style={{ display: "block", margin: 0 }}>
                              registrado {c.registrado_em ? new Date(c.registrado_em).toLocaleDateString("pt-BR") : ""}
                              {c.autor?.nome_completo ? ` por ${c.autor.nome_completo}` : ""}
                            </span>
                          </span>
                          {podeEditar && (
                            <button className="btn-dl btn-sec btn-perigo" style={{ alignSelf: "center" }} disabled={ocupado} onClick={() => excluirRegistro(c)}>
                              Excluir registro
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}

          {podeEditar && !nova && (
            <button className="btn-dl btn-sec" style={{ marginTop: 8 }}
              onClick={() => { setTentou(false); setNova({ identificacao: "", observacao: "", comCal: true, cal: formVazio() }); }}>
              + Unidade
            </button>
          )}
          {nova && (
            <div style={caixa}>
              <strong style={{ fontSize: 13 }}>Nova unidade</strong>
              <div style={{ ...grade, marginTop: 8 }}>
                <div>
                  <label style={rot}>Nº de série / patrimônio *</label>
                  <input style={campo} value={nova.identificacao} maxLength={80} autoFocus
                    className={tentou && rNova.erros.identificacao ? "val-invalido" : undefined}
                    onChange={(e) => setNova({ ...nova, identificacao: e.target.value })} placeholder="ex.: SN 12345 / PAT-0042" />
                  <MensagensCampo r={rNova} campo="identificacao" mostrarErros={tentou || !!nova.identificacao} />
                </div>
                <div>
                  <label style={rot}>Observação</label>
                  <input style={campo} value={nova.observacao} onChange={(e) => setNova({ ...nova, observacao: e.target.value })} />
                </div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "10px 0 6px" }}>
                <input type="checkbox" checked={nova.comCal} onChange={(e) => setNova({ ...nova, comCal: e.target.checked })} />
                Registrar a calibração atual agora
              </label>
              {nova.comCal && camposCalibracao(nova.cal, (cal) => setNova({ ...nova, cal }), rNova)}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                <button className="btn-dl btn-sec" onClick={() => { descartarPdf(nova.cal); setNova(null); setTentou(false); }}>Cancelar</button>
                <button className="btn-dl" disabled={ocupado || enviandoPdf || (tentou && temErros(rNova))} onClick={criarUnidade}>
                  {ocupado ? "Salvando…" : "Criar unidade"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
