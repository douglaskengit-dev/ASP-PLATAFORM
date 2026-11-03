"use client";

import AdminAssistenteConteudo from "@/app/components/AdminAssistenteConteudo";

export default function AdminAssistentePage() {
  return (
    <main>
      <header className="topo">
        <h1>Robô ASP — avaliações e exemplos</h1>
      </header>

      <div className="page">
        <AdminAssistenteConteudo />
      </div>
    </main>
  );
}
