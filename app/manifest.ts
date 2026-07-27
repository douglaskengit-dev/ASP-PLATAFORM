import type { MetadataRoute } from "next";

/** Manifesto do PWA (Fase 0). Torna o app instalável ("Adicionar à Tela de
 * Início") e abrindo em tela cheia. Ícones em public/. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ASP — Inspeção e Execução",
    short_name: "ASP",
    description: "Plataforma ASP de inspeção robótica e execução.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f6f8",
    theme_color: "#123761",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
