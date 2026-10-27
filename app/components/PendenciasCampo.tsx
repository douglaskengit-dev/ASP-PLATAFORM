"use client";

/**
 * Widget "Pendências de campo" (topo do Dashboard): para quem está na equipe
 * agendada de uma execução HOJE, o que ainda falta em cada OS — fotos da
 * coleta, com os botões de foto ali mesmo (o card da coleta em modo "só o
 * que falta"), e o RDO do dia. Some quando não há nada. As notificações das
 * 11h, 16h e 17h30 trazem a pessoa para cá (#pendencias-campo).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ColetaFotosExecucao from "./ColetaFotosExecucao";
import { enviarJson } from "@/lib/pwa/sync";
import { UNIDADE_CLORO_PADRAO, unidadeCloroValida, pendenciasColeta, type RegistroFotosExecucao } from "@/lib/asp/fotos-execucao";

/** Veio da notificação (#pendencias-campo)? Lido quando o módulo carrega: o
 *  Dashboard reescreve o endereço com os filtros logo depois (o # se perde) e
 *  pode remontar o widget. Vale uma vez por abertura da página. */
let pedidoDoAviso = typeof window !== "undefined" && window.location.hash === "#pendencias-campo";

interface Pendencia {
  inspecaoId: string;
  identificacao: string;
  projeto: string;
  ultimoDia: boolean;
  fotos: string[];
  rdoFaltando: boolean;
  aguaPotavel: boolean;
  cloroUnidade?: string | null;
  cloroLimiteAviso?: number | null;
}

export default function PendenciasCampo() {
  const [lista, setLista] = useState<Pendencia[] | null>(null);
  const [silenciado, setSilenciado] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  /** Itens de foto que faltam, contados pela coleta aberta nesta tela (a
   *  lista do servidor é de quando a tela abriu). */
  const [faltam, setFaltam] = useState<Record<string, number>>({});
  const nFotosDe = (p: Pendencia) => faltam[p.inspecaoId] ?? p.fotos.length;

  // navegação interna (sino do app) para /dashboard#pendencias-campo
  useEffect(() => { if (window.location.hash === "#pendencias-campo") pedidoDoAviso = true; }, []);

  const carregar = useCallback(() => {
    fetch("/api/pendencias-campo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.ok) { setLista([]); return; }
        setLista(d.pendencias || []);
        setSilenciado(!!d.silenciado);
      })
      .catch(() => setLista([]));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // veio da notificação: abre a primeira OS com foto faltando e rola até o widget
  useEffect(() => {
    if (!lista?.length || !pedidoDoAviso) return;
    pedidoDoAviso = false;
    const primeira = lista.find((p) => p.fotos.length > 0);
    if (primeira) setAberta(primeira.inspecaoId);
    requestAnimationFrame(() => document.getElementById("pendencias-campo")?.scrollIntoView({ block: "start" }));
  }, [lista]);

  async function alternarSilencio() {
    const novo = !silenciado;
    setSilenciado(novo);
    const res = await enviarJson("/api/pendencias-campo/silenciar", novo ? "POST" : "DELETE", {}, "Avisos de pendências de campo");
    if (!res.ok && !res.queued) setSilenciado(!novo);
  }

  const visiveis = (lista || []).filter((p) => p.rdoFaltando || nFotosDe(p) > 0 || aberta === p.inspecaoId);
  if (!lista || visiveis.length === 0) return null;

  return (
    <section id="pendencias-campo" className="card" style={{ marginBottom: 16 }} aria-label="Pendências de campo">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>📋 Pendências de campo — hoje</h2>
        <button type="button" className="btn-sec btn-sm" onClick={alternarSilencio} style={{ cursor: "pointer" }}>
          {silenciado ? "🔔 Voltar a avisar hoje" : "🔕 Não avisar mais hoje"}
        </button>
      </div>
      <p className="detalhe" style={{ margin: "4px 0 0" }}>
        Execuções em que você está na equipe. Envie o que falta antes de sair do local.
        {silenciado && " Avisos de hoje desligados — amanhã voltam sozinhos."}
      </p>

      {visiveis.map((p) => {
        const nFotos = nFotosDe(p);
        const abertaAqui = aberta === p.inspecaoId;
        return (
          <div key={p.inspecaoId} style={{ borderTop: "1px solid var(--borda)", marginTop: 12, paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <Link href={`/inspecoes/${p.inspecaoId}`} style={{ fontWeight: 700, fontSize: 15 }}>
                  {p.identificacao}
                </Link>
                {p.projeto && <span className="detalhe" style={{ margin: "0 0 0 6px" }}>{p.projeto}</span>}
                {p.ultimoDia && (
                  <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>último dia</span>
                )}
              </div>
              <span className="detalhe" style={{ margin: 0 }}>
                {[nFotos ? `${nFotos} ${nFotos === 1 ? "item de foto" : "itens de foto"}` : "", p.rdoFaltando ? "RDO de hoje" : ""]
                  .filter(Boolean).join(" · ")}
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {nFotos > 0 && (
                <button type="button" className="btn-dl btn-sm" style={{ cursor: "pointer" }} aria-expanded={abertaAqui}
                  onClick={() => setAberta(abertaAqui ? null : p.inspecaoId)}>
                  📷 {abertaAqui ? "Fechar fotos" : "Enviar fotos que faltam"}
                </button>
              )}
              {p.rdoFaltando && (
                <Link href={`/inspecoes/${p.inspecaoId}#rdos`} className="btn-dl btn-sec btn-sm">📝 Preparar RDO de hoje</Link>
              )}
            </div>

            {abertaAqui && (
              <div style={{ marginTop: 10 }}>
                <ColetaFotosExecucao inspecaoId={p.inspecaoId} identificacao={p.identificacao} embutido somentePendentes
                  aguaPotavel={p.aguaPotavel}
                  cloroUnidade={unidadeCloroValida(p.cloroUnidade) ? p.cloroUnidade : UNIDADE_CLORO_PADRAO}
                  cloroLimiteAviso={p.cloroLimiteAviso ?? undefined}
                  onMudar={(r: RegistroFotosExecucao) =>
                    setFaltam((c) => ({ ...c, [p.inspecaoId]: pendenciasColeta(r).length }))} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
