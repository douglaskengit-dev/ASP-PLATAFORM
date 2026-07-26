"use client";

import HistoricoConteudo from "@/app/components/HistoricoConteudo";

export default function HistoricoPage() {
  return (
    <main>
      <header className="topo">
        <h1>Projetos em Aberto</h1>
      </header>

      <div className="page">
        <HistoricoConteudo />
      </div>
    </main>
  );
}
