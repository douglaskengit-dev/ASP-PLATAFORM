"use client";

/** Registra o service worker do PWA (Fase 0). Silencioso; só ativa em
 * navegadores compatíveis. */
import { useEffect } from "react";
import { prefetchDados } from "@/lib/pwa/prefetch";

export default function RegistrarSW() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // Aquecimento do cache offline em segundo plano (após a tela pintar).
    const t = setTimeout(() => { prefetchDados(); }, 4000);
    return () => clearTimeout(t);
  }, []);
  return null;
}
