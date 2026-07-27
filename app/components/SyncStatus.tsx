"use client";

/** Indicador de sincronização offline no header. Aparece quando está offline
 * ou há itens pendentes na fila; permite sincronizar manualmente. Também liga
 * os gatilhos automáticos (ao voltar a rede). */
import { useEffect, useState } from "react";
import { pendentes, sincronizar, iniciarSync, estaOnline } from "@/lib/pwa/sync";

export default function SyncStatus() {
  const [pend, setPend] = useState(0);
  const [online, setOnline] = useState(true);
  const [sinc, setSinc] = useState(false);

  useEffect(() => {
    iniciarSync();
    setOnline(estaOnline());
    pendentes().then(setPend);
    const onFila = (e: Event) => setPend((e as CustomEvent).detail?.pendentes ?? 0);
    const onOn = () => { setOnline(true); pendentes().then(setPend); };
    const onOff = () => setOnline(false);
    window.addEventListener("asp:fila", onFila);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    const t = setInterval(() => pendentes().then(setPend), 15000);
    return () => {
      window.removeEventListener("asp:fila", onFila);
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
      clearInterval(t);
    };
  }, []);

  if (online && pend === 0) return null;

  async function sincronizarAgora() {
    setSinc(true);
    try { setPend(await sincronizar()); } finally { setSinc(false); }
  }

  const cor = !online ? "#c2410c" : "#0f766e";
  return (
    <button
      onClick={sincronizarAgora}
      disabled={sinc || !online}
      title={!online ? "Você está offline — as alterações serão enviadas ao reconectar" : "Enviar alterações pendentes agora"}
      style={{
        display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px",
        borderRadius: 8, border: `1px solid ${cor}`, background: "transparent", color: cor,
        fontSize: 12, fontWeight: 700, cursor: sinc || !online ? "default" : "pointer",
      }}
    >
      {!online ? "⚡ Offline" : sinc ? "Sincronizando…" : `⏳ ${pend} pendente${pend === 1 ? "" : "s"}`}
    </button>
  );
}
