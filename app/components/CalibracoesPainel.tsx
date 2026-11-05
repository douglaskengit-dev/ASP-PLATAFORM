"use client";

/**
 * Cartão "Calibrações" do Dashboard: unidades vencidas, que vencem em até 30
 * dias e equipamentos que exigem calibração sem unidade/registro. Some quando
 * está tudo em dia. Os avisos diários da calibração trazem a pessoa para cá
 * (#calibracoes); cada linha abre a ficha do equipamento no Catálogo.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SeloCalibracao } from "./CalibracaoEquipamento";
import {
  GRAVIDADE_CALIBRACAO, situacaoCalibracao, textoVencimento,
  type SituacaoCalibracao, type UnidadeEquipamento,
} from "@/lib/validacao";

/** Veio do aviso (#calibracoes)? Lido quando o módulo carrega: o Dashboard
 *  reescreve o endereço com os filtros logo depois (o # se perde). */
let pedidoDoAviso = typeof window !== "undefined" && window.location.hash === "#calibracoes";

interface Linha { equipamentoId: string; equipamento: string; unidade: string | null; situacao: SituacaoCalibracao; texto: string; vence: string }

export default function CalibracoesPainel() {
  const [dados, setDados] = useState<{ hoje: string; equipamentos: any[]; unidades: UnidadeEquipamento[] } | null>(null);
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    fetch("/api/calibracao", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) setDados({ hoje: d.hoje, equipamentos: d.equipamentos || [], unidades: d.unidades || [] }); })
      .catch(() => {});
  }, []);

  const linhas = useMemo<Linha[]>(() => {
    if (!dados) return [];
    const out: Linha[] = [];
    for (const e of dados.equipamentos.filter((x) => x.exige_calibracao && x.ativo)) {
      const us = dados.unidades.filter((u) => u.equipamento_id === e.id && u.ativo !== false);
      if (!us.length) {
        out.push({ equipamentoId: e.id, equipamento: e.nome, unidade: null, situacao: "sem_calibracao", texto: "nenhuma unidade cadastrada", vence: "" });
        continue;
      }
      for (const u of us) {
        const sit = situacaoCalibracao(u.vence_em, dados.hoje);
        if (sit === "em_dia") continue;
        out.push({ equipamentoId: e.id, equipamento: e.nome, unidade: u.identificacao, situacao: sit, texto: textoVencimento(u.vence_em, dados.hoje), vence: u.vence_em || "" });
      }
    }
    return out.sort((a, b) => GRAVIDADE_CALIBRACAO[b.situacao] - GRAVIDADE_CALIBRACAO[a.situacao] || a.vence.localeCompare(b.vence));
  }, [dados]);

  // veio do aviso (#calibracoes): rola até o cartão
  useEffect(() => { if (window.location.hash === "#calibracoes") pedidoDoAviso = true; }, []);
  useEffect(() => {
    if (!linhas.length || !pedidoDoAviso) return;
    pedidoDoAviso = false;
    requestAnimationFrame(() => document.getElementById("calibracoes")?.scrollIntoView({ block: "start" }));
  }, [linhas.length]);

  if (!linhas.length) return null;
  const n = (s: SituacaoCalibracao) => linhas.filter((l) => l.situacao === s).length;
  const visiveis = todas ? linhas : linhas.slice(0, 6);

  return (
    <section id="calibracoes" className="card" style={{ marginBottom: 16 }} aria-label="Calibrações">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>🔧 Calibrações</h2>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {n("vencida") > 0 && <SeloCalibracao situacao="vencida" texto={`${n("vencida")} vencida(s)`} />}
          {n("vence_breve") > 0 && <SeloCalibracao situacao="vence_breve" texto={`${n("vence_breve")} vence(m) em até 30 dias`} />}
          {n("sem_calibracao") > 0 && <SeloCalibracao situacao="sem_calibracao" texto={`${n("sem_calibracao")} sem registro`} />}
        </span>
      </div>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {visiveis.map((l, i) => (
          <li key={`${l.equipamentoId}-${l.unidade}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "7px 0", borderBottom: "1px solid var(--borda)" }}>
            <span style={{ minWidth: 0 }}>
              <Link href={`/catalogo?equipamento=${l.equipamentoId}`} style={{ fontWeight: 600 }}>{l.equipamento}</Link>
              {l.unidade && <span className="detalhe" style={{ margin: 0 }}> · {l.unidade}</span>}
              <span className="detalhe" style={{ display: "block", margin: 0 }}>{l.texto}</span>
            </span>
            <SeloCalibracao situacao={l.situacao} />
          </li>
        ))}
      </ul>
      {linhas.length > 6 && (
        <button type="button" className="secao-link" style={{ marginTop: 6 }} onClick={() => setTodas(!todas)}>
          {todas ? "Mostrar menos" : `Ver todas (${linhas.length})`}
        </button>
      )}
    </section>
  );
}
