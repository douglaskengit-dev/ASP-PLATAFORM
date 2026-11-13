import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard de Gerência · Plataforma ASP",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
