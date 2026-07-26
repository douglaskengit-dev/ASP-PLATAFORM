"use client";

/** Cadastro de Clientes — reaproveitado pela página /orgaos e pelo modal
 * "Clientes" do header. Cliente reaproveita a tabela gp_orgaos (mesmo cadastro
 * usado como cliente dos Projetos); o conceito de "tipo de ente" (órgão
 * público) foi removido da UI. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { OrgaoComAcoes } from "@/lib/orgaos/types";
import { mascaraCnpj } from "@/lib/mascaras";
import FormularioOrgao from "./FormularioOrgao";

interface FiltrosClientes {
  q: string;
  de: string;
  ate: string;
}

const FILTROS_VAZIOS: FiltrosClientes = { q: "", de: "", ate: "" };

export default function OrgaosConteudo() {
  const [filtrosInput, setFiltrosInput] = useState<FiltrosClientes>(FILTROS_VAZIOS);
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosClientes>(FILTROS_VAZIOS);

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [clientes, setClientes] = useState<OrgaoComAcoes[]>([]);

  const [formAberto, setFormAberto] = useState(false);

  async function carregarClientes(filtros: FiltrosClientes) {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (filtros.q.trim()) params.set("q", filtros.q.trim());
      if (filtros.de) params.set("de", filtros.de);
      if (filtros.ate) params.set("ate", filtros.ate);

      const resp = await fetch(`/api/orgaos?${params.toString()}`);
      const dados = await resp.json();
      if (!resp.ok || !dados.ok) throw new Error(dados.erro || "Falha ao carregar clientes.");
      setClientes(dados.orgaos || []);
    } catch (err: any) {
      setErro(err.message || "Erro ao carregar clientes.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarClientes(filtrosAplicados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosAplicados]);

  function buscar() {
    setFiltrosAplicados(filtrosInput);
  }

  function limparFiltros() {
    setFiltrosInput(FILTROS_VAZIOS);
    setFiltrosAplicados(FILTROS_VAZIOS);
  }

  function fecharForm() {
    setFormAberto(false);
  }

  async function aoCadastrarCliente() {
    fecharForm();
    await carregarClientes(filtrosAplicados);
  }

  return (
    <div>
      <section className="card">
        <h2>Filtros</h2>
        <div className="grid">
          <div className="field">
            <label>Nome / Razão social</label>
            <input
              value={filtrosInput.q}
              onChange={(e) => setFiltrosInput((f) => ({ ...f, q: e.target.value }))}
              placeholder="Buscar por nome…"
              onKeyDown={(e) => { if (e.key === "Enter") buscar(); }}
            />
          </div>
          <div className="field">
            <label>Cadastrado de</label>
            <input type="date" value={filtrosInput.de} onChange={(e) => setFiltrosInput((f) => ({ ...f, de: e.target.value }))} />
          </div>
          <div className="field">
            <label>Cadastrado até</label>
            <input type="date" value={filtrosInput.ate} onChange={(e) => setFiltrosInput((f) => ({ ...f, ate: e.target.value }))} />
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={buscar}>Buscar</button>
          <button className="btn secondary" onClick={limparFiltros}>Limpar filtros</button>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Clientes cadastrados ({clientes.length})</h2>
          <button className="btn" onClick={() => setFormAberto((v) => !v)}>
            {formAberto ? "Cancelar" : "+ Novo cliente"}
          </button>
        </div>

        {formAberto && (
          <div style={{ borderTop: "1px solid var(--borda)", marginTop: 12, paddingTop: 12 }}>
            <FormularioOrgao onSucesso={aoCadastrarCliente} onCancelar={fecharForm} />
          </div>
        )}
      </section>

      {carregando && <p>Carregando…</p>}
      {erro && <p className="msg erro">{erro}</p>}

      {!carregando && clientes.length === 0 && !erro && <p className="vazio">Nenhum cliente encontrado.</p>}

      {clientes.map((c) => (
        <Link key={c.id} href={`/orgaos/${c.id}`} className="item-analise" style={{ display: "block", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
          <div className="item-analise-cabecalho">
            <span className="etapa-badge">
              {c.razao_social} — {c.cidade}/{c.uf}
            </span>
          </div>
          <p className="item-analise-resumo">
            CNPJ: {mascaraCnpj(c.cnpj)} — Cadastrado em {new Date(c.created_at).toLocaleString("pt-BR")}
          </p>
        </Link>
      ))}
    </div>
  );
}
