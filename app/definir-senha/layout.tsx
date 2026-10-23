import type { Metadata } from "next";

// O link traz o token na URL: não vaza no Referer nem vai para buscadores.
export const metadata: Metadata = {
  title: "Definir senha — Plataforma ASP",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function DefinirSenhaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
