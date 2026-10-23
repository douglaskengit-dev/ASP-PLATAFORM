import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Esqueci minha senha — Plataforma ASP",
  robots: { index: false, follow: false },
};

export default function EsqueciSenhaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
