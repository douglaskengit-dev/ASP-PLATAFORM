"use client";

/** Calendário mensal do Dashboard com as datas de inspeção e execução
 * (gp_agendamentos). Cada marcador leva à inspeção correspondente. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Agendamento {
  id: string;
  tipo: string;
  data_visita: string | null;
  data_execucao: string | null;
  hora: string | null;
  inspecao: { id: string; identificacao: string; projeto: { codigo_projeto: string | null; pedido_compra: string | null } | null } | null;
}
interface Evento { id: string; date: string; kind: "inspecao" | "execucao"; hora: string | null; inspecao: Agendamento["inspecao"] }

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export default function CalendarioAgenda() {
  const [ags, setAgs] = useState<Agendamento[]>([]);
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth());
  const [ano, setAno] = useState(hoje.getFullYear());

  useEffect(() => {
    fetch("/api/agendamentos").then((r) => r.ok ? r.json() : { agendamentos: [] }).then((d) => setAgs(d.agendamentos || [])).catch(() => {});
  }, []);

  // Cada agendamento vira 1 ou 2 eventos: a visita (por tipo) e, se houver,
  // a data prevista de execução. Mapa "YYYY-MM-DD" -> eventos do dia.
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    const add = (e: Evento) => { const k = e.date.slice(0, 10); m.set(k, [...(m.get(k) || []), e]); };
    ags.forEach((a) => {
      if (a.data_visita) add({ id: a.id + "-v", date: a.data_visita, kind: a.tipo === "execucao" ? "execucao" : "inspecao", hora: a.hora, inspecao: a.inspecao });
      if (a.data_execucao) add({ id: a.id + "-e", date: a.data_execucao, kind: "execucao", hora: null, inspecao: a.inspecao });
    });
    return m;
  }, [ags]);

  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const hojeStr = new Date().toISOString().slice(0, 10);

  const celulas: (number | null)[] = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);

  function navegar(delta: number) {
    let m = mes + delta, a = ano;
    if (m < 0) { m = 11; a--; } else if (m > 11) { m = 0; a++; }
    setMes(m); setAno(a);
  }
  function chave(d: number) {
    return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>📅 Calendário — inspeções e execuções</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="fu-icone-btn" onClick={() => navegar(-1)} title="Mês anterior">‹</button>
          <strong style={{ minWidth: 150, textAlign: "center" }}>{MESES[mes]} {ano}</strong>
          <button className="fu-icone-btn" onClick={() => navegar(1)} title="Próximo mês">›</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 12 }}>
        <span className="detalhe" style={{ margin: 0 }}><span style={{ color: "var(--primaria)" }}>●</span> Inspeção</span>
        <span className="detalhe" style={{ margin: 0 }}><span style={{ color: "#0f766e" }}>●</span> Execução</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {DIAS.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--cinza)", padding: "4px 0" }}>{d}</div>
        ))}
        {celulas.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const k = chave(d);
          const doDia = porDia.get(k) || [];
          const ehHoje = k === hojeStr;
          return (
            <div key={k} style={{
              minHeight: 62, border: "1px solid var(--borda)", borderRadius: 8, padding: 4,
              background: ehHoje ? "var(--primaria-claro)" : "var(--bg-card)",
            }}>
              <div style={{ fontSize: 11, fontWeight: ehHoje ? 800 : 600, color: ehHoje ? "var(--primaria)" : "var(--texto-suave)" }}>{d}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                {doDia.slice(0, 3).map((a) => (
                  <Link key={a.id} href={a.inspecao ? `/inspecoes/${a.inspecao.id}` : "#"} title={`${a.kind === "execucao" ? "Execução" : "Inspeção"} · ${a.inspecao?.identificacao || ""}${a.hora ? " às " + a.hora : ""}`}
                    style={{ fontSize: 10, textDecoration: "none", color: "#fff", borderRadius: 4, padding: "1px 4px",
                      background: a.kind === "execucao" ? "#0f766e" : "var(--primaria)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {a.hora ? `${a.hora} ` : ""}{a.inspecao?.identificacao || "Inspeção"}
                  </Link>
                ))}
                {doDia.length > 3 && <span className="detalhe" style={{ margin: 0, fontSize: 10 }}>+{doDia.length - 3}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
