"use client";

/** Registra o service worker do PWA (Fase 0). Silencioso; só ativa em
 * navegadores compatíveis. */
import { useEffect } from "react";

export default function RegistrarSW() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
