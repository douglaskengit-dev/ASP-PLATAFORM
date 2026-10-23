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
    // Ícones v2 (ladrilho azul ASP de ponta a ponta). Nomes NOVOS de arquivo
    // de propósito: navegador e sistema guardam ícone por endereço, então
    // trocar o nome é o que faz o ícone novo aparecer. Fontes em
    // public/icons/src/*.svg.
    icons: [
      { src: "/icons/app-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Conteúdo dentro do círculo seguro de 80% (o Android recorta em
      // círculo/squircle/quadrado arredondado).
      { src: "/icons/app-512-maskable-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      // Android 13+ (ícones temáticos): silhueta branca sobre transparente.
      { src: "/icons/app-512-monochrome.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
  };
}
