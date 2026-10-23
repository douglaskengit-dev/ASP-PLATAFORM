import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import BarraUsuario from "./components/BarraUsuario";
import RegistrarSW from "./components/RegistrarSW";

// Fontes hospedadas no próprio projeto (app/fonts, licença OFL) em vez de
// next/font/google: o build não depende mais de baixar do Google Fonts, que
// falhava de forma intermitente na Vercel. Arquivos variáveis, subset latin.

// D25: tipografia da marca Grupo BRID — títulos/nav em Montserrat (bold,
// geométrica, igual ao site institucional), corpo de texto em Inter.
const montserrat = localFont({
  src: "./fonts/Montserrat-Variable.woff2",
  weight: "100 900",
  variable: "--fonte-titulo",
  display: "swap",
});
const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  weight: "100 900",
  variable: "--fonte-corpo",
  display: "swap",
});
// D52: fonte dos títulos do site institucional (grupobrid.com) — usada na
// página inicial pública.
const antonio = localFont({
  src: "./fonts/Antonio-Variable.woff2",
  weight: "100 700",
  variable: "--fonte-brid",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Plataforma ASP",
  description: "Sistema interno — gestão de projetos e Ordens de Serviço.",
  applicationName: "ASP",
  icons: {
    // Variante otimizada para 16–32 px (borda dourada no contorno, letras mais cheias).
    icon: "/assets/asp-badge-16.svg",
    shortcut: "/assets/asp-badge-16.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "ASP",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#123761",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// D22: define o tema (claro/escuro) antes da primeira pintura, lendo a
// preferência salva (ou a do sistema), para evitar flash do tema errado.
const SCRIPT_TEMA = `(function(){try{
  var t = localStorage.getItem("tema");
  if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  // D45: limpa a chave "senha" gravada pela versão antiga do app (modelo de
  // senha única) — o login atual (Supabase Auth) nunca salva senha no navegador.
  localStorage.removeItem("senha");
} catch (e) {}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className={`${montserrat.variable} ${inter.variable} ${antonio.variable}`}>
        <RegistrarSW />
        <BarraUsuario />
        {children}
      </body>
    </html>
  );
}
