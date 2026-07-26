"use client";

/** Notificações do header — mostra as inspeções paradas numa fase que é
 * responsabilidade do perfil do usuário (Comercial, Operações ou Gerência),
 * ou seja, "o processo está para atuação da sua área". Admin vê todas. */
import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "./Modal";
import { tituloFase } from "@/lib/asp/fases";

interface Inspecao {
  id: string;
  identificacao: string;
  fase: number;
  atualizado_em: string | null;
  projeto: {
    id: string;
    codigo_projeto: string | null;
    pedido_compra: string | null;
    cliente: { razao_social: string } | null;
  } | null;
}

const NOME_PERFIL: Record<string, string> = {
  admin: "Administrador", comercial: "Comercial", operacoes: "Operações", gerencia: "Gerência",
};

function fmtData(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function NotificacoesBotao() {
  const [inspecoes, setInspecoes] = useState<Inspecao[]>([]);
  const [perfil, setPerfil] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    fetch("/api/inspecoes/pendentes")
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        setInspecoes(d.inspecoes || []);
        setPerfil(d.perfil || null);
      })
      .catch(() => {});
  }, []);

  const total = inspecoes.length;

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        title="Inspeções aguardando atuação da sua área"
        style={{
          position: "relative", background: "none", border: "1px solid #3a3529", borderRadius: 8,
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", fontSize: 15, color: "#c9c4b6",
        }}
      >
        🔔
        {total > 0 && (
          <span
            style={{
              position: "absolute", top: -5, right: -5, background: "var(--primaria)", color: "var(--escuro)",
              borderRadius: 999, fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, padding: "0 3px",
              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}
          >
            {total}
          </span>
        )}
      </button>

      {aberto && (
        <Modal titulo="🔔 Aguardando sua atuação" onFechar={() => setAberto(false)}>
          <span className="detalhe" style={{ display: "block", margin: "0 0 10px" }}>
            {perfil ? `Inspeções em fases sob responsabilidade de ${NOME_PERFIL[perfil] || perfil}.` : "Suas pendências."}
          </span>
          {total === 0 ? (
            <p className="vazio">✅ Nenhuma inspeção aguardando a sua área.</p>
          ) : (
            inspecoes.map((i) => (
              <Link href={`/inspecoes/${i.id}`} className="item notif" key={i.id}
                style={{ display: "block", textDecoration: "none", color: "inherit", cursor: "pointer", marginBottom: 8 }}
                title="Abrir esta inspeção" onClick={() => setAberto(false)}>
                <div>
                  <strong>{i.identificacao}</strong>
                  <span className="detalhe">
                    {i.projeto?.codigo_projeto || i.projeto?.pedido_compra || "Projeto"}
                    {i.projeto?.cliente ? ` · ${i.projeto.cliente.razao_social}` : ""}
                  </span>
                  <span className="detalhe">Fase {i.fase} · {tituloFase(i.fase)}</span>
                  <span className="detalhe">Desde {fmtData(i.atualizado_em)}</span>
                </div>
              </Link>
            ))
          )}
        </Modal>
      )}
    </>
  );
}
