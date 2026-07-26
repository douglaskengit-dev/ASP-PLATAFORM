"use client";

import OrgaosConteudo from "@/app/components/OrgaosConteudo";

export default function OrgaosPage() {
  return (
    <main>
      <header className="topo">
        <h1>Clientes</h1>
        <p>Cadastro central de clientes atendidos</p>
      </header>

      <div className="page">
        <OrgaosConteudo />
      </div>
    </main>
  );
}
