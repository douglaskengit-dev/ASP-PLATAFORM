"use client";

/** Fase 10 — card "Encerramento" da OS: pendências, encerrar (normal ou
 * manual), quem/quando encerrou e reabrir. As pendências e a última
 * atividade vêm da API (/api/inspecoes/[id]/encerramento), que recalcula e
 * repete os bloqueios ao encerrar. Regras em lib/validacao/encerramento.ts.
 *
 *   ⛔ pendência bloqueia "Encerrar OS" (cada uma com link para a seção)
 *   ⛔ data no futuro / antes da última atividade
 *   ⛔ manual (Admin/Gerência) exige justificativa com sentido
 *   ⚠️ nenhuma entrega ao cliente registrada
 *   Duplo clique / fila offline: uma chave de idempotência por tentativa. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MensagensCampo, ResumoValidacao } from "@/app/components/MensagensCampo";
import { enviarJson, novoId } from "@/lib/pwa/sync";
import {
  dataBrCompleta, novoResultado, podeEncerrar, podeEncerrarManual, podeReabrir, ROTULOS_ENCERRAMENTO, ROTULOS_REABERTURA,
  temErros, validarEncerramento, validarReabertura, type PendenciaEncerramento, type ResultadoValidacao,
} from "@/lib/validacao";

interface Situacao {
  hoje: string;
  pendencias: PendenciaEncerramento[];
  ultima: { dia: string; origem: string } | null;
  entregas: number;
  encerramento: {
    em: string; por: string | null; porNome: string | null; manual: boolean; justificativa: string | null; pendenciasIgnoradas: string[];
  } | null;
}

const ROT_SECAO: Record<string, string> = { relatorios: "Relatórios", rdos: "RDOs", fotos: "Fotos da execução", agendamentos: "Agendamentos" };

export default function EncerramentoOS({ inspecaoId, perfil, versao, onMudou }: {
  inspecaoId: string;
  perfil: string | null;
  /** Muda quando a página recarrega dados (refaz a consulta das pendências). */
  versao: number;
  /** Encerrou/reabriu: a página recarrega tudo. */
  onMudou: () => void;
}) {
  const [sit, setSit] = useState<Situacao | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [data, setData] = useState("");
  const [manual, setManual] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [reabrindo, setReabrindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [servidor, setServidor] = useState<ResultadoValidacao>(novoResultado());
  const [erro, setErro] = useState<string | null>(null);
  const enviandoRef = useRef(false);
  /** Uma chave por tentativa: o 2º clique/reenvio da fila não duplica. */
  const chaveRef = useRef<string>(novoId());

  const carregar = useCallback(() => {
    fetch(`/api/inspecoes/${inspecaoId}/encerramento`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErroCarga(d.erro || "Não foi possível carregar as pendências."); return; }
        setErroCarga(null);
        setSit(d);
        setData((atual) => atual || d.hoje);
      })
      .catch(() => setErroCarga("Falha de rede ao carregar as pendências."));
  }, [inspecaoId]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const validacao = useMemo(() => {
    if (!sit) return novoResultado();
    const v = validarEncerramento({ data, manual, justificativa }, {
      perfil, hoje: sit.hoje, ultima: sit.ultima, pendencias: sit.pendencias, entregas: sit.entregas < 0 ? undefined : sit.entregas,
    });
    // O servidor fala por último (ex.: outro usuário encerrou).
    for (const [c, l] of Object.entries(servidor.erros)) for (const m of l) (v.erros[c] ||= []).includes(m) || v.erros[c].push(m);
    return v;
  }, [sit, data, manual, justificativa, perfil, servidor]);
  const valReabrir = useMemo(() => validarReabertura({ motivo }, perfil), [motivo, perfil]);

  async function enviar(corpo: Record<string, unknown>) {
    if (enviandoRef.current) return;      // duplo clique: o 2º nem sai
    enviandoRef.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const res = await enviarJson(`/api/inspecoes/${inspecaoId}/encerramento`, "POST", corpo,
        corpo.acao === "reabrir" ? "Reabrir OS" : "Encerrar OS", chaveRef.current);
      if (res.queued) { alert("Sem conexão — ação salva offline e aplicada ao reconectar."); return; }
      if (!res.ok) {
        setErro(res.data?.erro || "Não foi possível concluir.");
        if (res.data?.erros) setServidor({ erros: res.data.erros, avisos: {} });
        if (res.status === 409) { carregar(); onMudou(); }
        return;
      }
      chaveRef.current = novoId();
      setManual(false); setJustificativa(""); setReabrindo(false); setMotivo(""); setTentou(false); setServidor(novoResultado());
      carregar();
      onMudou();
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  function encerrar() {
    setTentou(true);
    if (temErros(validacao)) return;
    const pend = sit?.pendencias || [];
    const msg = manual
      ? `Encerrar MANUALMENTE a OS em ${dataBrCompleta(data)}, ignorando ${pend.length} pendência(s)?\n\nFica registrado quem encerrou, a justificativa e as pendências ignoradas. Depois de encerrada a OS fica só para consulta.`
      : `Encerrar a OS em ${dataBrCompleta(data)}?\n\nDepois de encerrada a OS fica só para consulta (só Admin/Gerência reabrem).`;
    if (!confirm(msg)) return;
    enviar({ acao: "encerrar", data, manual, justificativa: manual ? justificativa : undefined });
  }

  function reabrir() {
    setTentou(true);
    if (temErros(valReabrir)) return;
    if (!confirm("Reabrir a OS? Ela continua na fase 10, mas volta a aceitar alterações.")) return;
    enviar({ acao: "reabrir", motivo });
  }

  if (erroCarga) return <p className="erro-texto" style={{ margin: 0 }}>{erroCarga}</p>;
  if (!sit) return <p className="detalhe" style={{ margin: 0 }}>Carregando pendências do encerramento…</p>;

  const enc = sit.encerramento;
  const pend = sit.pendencias;

  // ── Encerrada ──────────────────────────────────────────────────────────────
  if (enc) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0, color: "var(--texto)" }}>
          <strong>✓ {enc.manual ? "Encerrada manualmente" : "OS encerrada"}</strong>
          {enc.manual
            ? <> por {enc.porNome || "usuário"} em {dataBrCompleta(enc.em).slice(0, 5)}{enc.justificativa ? <> — {enc.justificativa}</> : null}</>
            : <> em {dataBrCompleta(enc.em)}{enc.porNome ? ` por ${enc.porNome}` : ""}.</>}
        </p>
        {enc.manual && enc.pendenciasIgnoradas.length > 0 && (
          <details>
            <summary className="detalhe" style={{ margin: 0, cursor: "pointer" }}>Pendências ignoradas ({enc.pendenciasIgnoradas.length})</summary>
            <ul className="detalhe" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {enc.pendenciasIgnoradas.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </details>
        )}
        <p className="detalhe" style={{ margin: 0 }}>A OS está só para consulta: downloads e o registro de entregas ao cliente continuam liberados.</p>
        {podeReabrir(perfil) && !reabrindo && (
          <div><button className="btn-azul btn-sec" onClick={() => { setReabrindo(true); setTentou(false); setMotivo(""); setErro(null); }}>↺ Reabrir OS</button></div>
        )}
        {reabrindo && (
          <div className="bloco-plano">
            <label style={{ fontWeight: 600, fontSize: 13 }} htmlFor="motivo-reabrir">Motivo da reabertura *</label>
            <textarea id="motivo-reabrir" rows={3} value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: cliente pediu correção na data do relatório de execução"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--borda)", background: "var(--bg-card)", color: "var(--texto)", fontSize: 14 }} />
            <MensagensCampo r={valReabrir} campo="motivo" mostrarErros={tentou || motivo.trim().length > 0} />
            <ResumoValidacao r={valReabrir} rotulos={ROTULOS_REABERTURA} mostrarErros={tentou} />
            <div className="val-acoes">
              <button className="btn-azul" disabled={enviando} onClick={reabrir}>{enviando ? "Reabrindo…" : "Confirmar reabertura"}</button>
              <button className="btn-azul btn-sec" disabled={enviando} onClick={() => setReabrindo(false)}>Cancelar</button>
            </div>
          </div>
        )}
        {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
      </div>
    );
  }

  // ── Aberta: pendências + encerrar ──────────────────────────────────────────
  const podeNormal = podeEncerrar(perfil);
  const podeManual = podeEncerrarManual(perfil);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <strong style={{ fontSize: 14, color: "var(--texto)" }}>Pendências para encerrar</strong>
        {pend.length === 0 ? (
          <p className="val-msg" style={{ margin: "4px 0 0", color: "#16a34a" }}>✓ Nenhuma pendência — a OS pode ser encerrada.</p>
        ) : (
          <ul style={{ margin: "4px 0 0", paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {pend.map((p) => (
              <li key={p.chave} className="val-msg val-erro" style={{ margin: 0 }}>
                ⛔ {p.texto}{" "}
                <a href={`#${p.secao}`} style={{ color: "var(--primaria)", whiteSpace: "nowrap" }}>ir para {ROT_SECAO[p.secao] || p.secao} →</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!podeNormal ? (
        <p className="vazio" style={{ margin: 0 }}>Encerrar a OS é com Comercial, Gerência ou Admin — você está em modo consulta.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label htmlFor="data-encerramento" style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 }}>Data de encerramento *</label>
              <input id="data-encerramento" type="date" value={data} max={sit.hoje} min={sit.ultima?.dia}
                className={validacao.erros.data && (tentou || data) ? "val-invalido" : undefined}
                onChange={(e) => { setData(e.target.value); setServidor(novoResultado()); }}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--borda)", background: "var(--bg-card)", color: "var(--texto)", fontSize: 14 }} />
            </div>
            {sit.ultima && (
              <span className="detalhe" style={{ margin: 0 }}>Última atividade: {dataBrCompleta(sit.ultima.dia)} ({sit.ultima.origem})</span>
            )}
          </div>
          <MensagensCampo r={validacao} campo="data" mostrarErros={tentou || !!data} />

          {manual && (
            <div className="bloco-plano">
              <strong style={{ fontSize: 13.5 }}>Encerramento manual — ignora {pend.length} pendência(s)</strong>
              <label htmlFor="justificativa-enc" style={{ fontWeight: 600, fontSize: 13 }}>Justificativa *</label>
              <textarea id="justificativa-enc" rows={3} value={justificativa} maxLength={1000}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Ex.: cliente dispensou o relatório de inspeção assinado (e-mail de 05/11)"
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--borda)", background: "var(--bg-card)", color: "var(--texto)", fontSize: 14 }} />
              <MensagensCampo r={validacao} campo="justificativa" mostrarErros={tentou || justificativa.trim().length > 0} />
              <p className="detalhe" style={{ margin: 0 }}>Fica registrado quem encerrou, a justificativa e a lista de pendências ignoradas.</p>
            </div>
          )}

          <ResumoValidacao r={validacao} rotulos={ROTULOS_ENCERRAMENTO} mostrarErros={tentou || (!manual && pend.length > 0)} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!manual && (
              <button className="btn-azul" disabled={enviando || pend.length > 0}
                title={pend.length ? "Resolva as pendências acima para encerrar" : "Encerrar a OS"}
                onClick={encerrar}>
                {enviando ? "Encerrando…" : "Encerrar OS"}
              </button>
            )}
            {podeManual && !manual && pend.length > 0 && (
              <button className="btn-azul btn-sec" disabled={enviando}
                onClick={() => { setManual(true); setTentou(false); setErro(null); }}>
                Encerrar manualmente (ignorar pendências)
              </button>
            )}
            {manual && (
              <>
                <button className="btn-azul" disabled={enviando} onClick={encerrar}>{enviando ? "Encerrando…" : "Encerrar manualmente"}</button>
                <button className="btn-azul btn-sec" disabled={enviando} onClick={() => { setManual(false); setTentou(false); }}>Cancelar</button>
              </>
            )}
          </div>
          {!podeManual && pend.length > 0 && (
            <p className="detalhe" style={{ margin: 0 }}>Só Admin e Gerência podem encerrar ignorando pendências.</p>
          )}
        </>
      )}
      {erro && <p className="erro-texto" style={{ margin: 0 }}>{erro}</p>}
    </div>
  );
}
