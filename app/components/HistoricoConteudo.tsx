"use client";

/** Conteúdo de "Projetos em Aberto" — reaproveitado pela página /historico e
 * pelo modal do header. Lista os projetos ainda não encerrados (alguma
 * inspeção fora da fase 10, ou projeto sem inspeções), com progresso médio. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ULTIMA_FASE } from "@/lib/asp/fases";

interface InspecaoResumo { id: string; fase: number }
interface Projeto {
  id: string;
  codigo_projeto: string | null;
  pedido_compra: string | null;
  cliente: { razao_social: string } | null;
  inspecoes: InspecaoResumo[];
  inspecoes_total: number;
}

function encerrado(p: Projeto) {
  return p.inspecoes.length > 0 && p.inspecoes.every((i) => i.fase >= ULTIMA_FASE);
}

export default function HistoricoConteudo() {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [projetos, setProjetos] = useState<Projeto[]>([]);

  useEffect(() => {
    fetch("/api/projetos")
      .then(async (r) => {
        if (r.status === 401) { window.location.href = "/login"; return; }
        const d = await r.json();
        setProjetos((d.projetos || []).map((p: Projeto) => ({ ...p, inspecoes: p.inspecoes || [] })));
      })
      .catch((e) => setErro(e?.message || "Erro ao carregar projetos."))
      .finally(() => setCarregando(false));
  }, []);

  const abertos = useMemo(() => projetos.filter((p) => !encerrado(p)), [projetos]);

  return (
    <div>
      {carregando && <p>Carregando…</p>}
      {erro && <p className="msg erro">{erro}</p>}

      <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>
        📋 Projetos em Aberto ({abertos.length})
      </h3>
      {!carregando && abertos.length === 0 && (
        <p className="vazio" style={{ marginBottom: 20 }}>Nenhum projeto em aberto.</p>
      )}
      {abertos.map((p) => {
        const fases = p.inspecoes.map((i) => i.fase);
        const media = fases.length ? fases.reduce((a, b) => a + b, 0) / fases.length : 1;
        const pct = Math.round(((media - 1) / (ULTIMA_FASE - 1)) * 100);
        return (
          <Link key={p.id} href={`/projetos/${p.id}`} className="item"
            style={{ display: "block", textDecoration: "none", color: "inherit", marginBottom: 10 }}
            title="Abrir este projeto">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{p.codigo_projeto || p.pedido_compra || "Projeto"}</strong>
              <span className="detalhe">{pct}%</span>
            </div>
            <div className="fu-progresso" style={{ margin: "6px 0" }}>
              <div className="fu-barra" style={{ width: `${pct}%` }} />
            </div>
            <span className="detalhe">
              {p.cliente?.razao_social || "Cliente não informado"} — {p.inspecoes.length} inspeç{p.inspecoes.length === 1 ? "ão" : "ões"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
