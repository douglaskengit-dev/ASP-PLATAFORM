"use client";

/** D52: página inicial pública (antes do login) — versão enxuta para o time
 * interno, com a identidade do site institucional (grupobrid.com): fundo
 * escuro, dourado, títulos em Antonio e fade-in de entrada. O botão leva ao
 * login (ou direto ao Dashboard, se já houver sessão). */
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function PaginaInicial() {
  const [logado, setLogado] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setLogado(!!data.user));
  }, []);

  return (
    <main className="landing">
      <div className="landing-conteudo">
        <Image src="/assets/asp-badge.svg" alt="ASP" width={80} height={80} priority />

        <span className="landing-marca">ASP</span>

        <div style={{ display: "flex", alignItems: "center", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
          <Image src="/assets/asp-mascote.svg" alt="Mascote ASP" width={92} height={106} priority />
          <h1 className="landing-titulo" style={{ margin: 0 }}>
            Soluções em inspeção<br />robótica industrial
          </h1>
        </div>

        <p className="landing-sub">
          Sistema interno — gestão de projetos e inspeções.

        </p>

        {logado ? (
          <div className="landing-atalhos">
            <Link href="/dashboard" className="landing-cta">Ir para o Dashboard →</Link>
            <Link href="/projetos" className="landing-cta secundario">Ir para Projetos →</Link>
            <Link href="/arquivos" className="landing-cta secundario">Ir para Arquivos →</Link>
          </div>
        ) : (
          <Link href="/login" className="landing-cta">Acessar o sistema →</Link>
        )}
      </div>

      <footer className="landing-rodape">
        uso interno · © {new Date().getFullYear()} ASP
      </footer>
    </main>
  );
}
