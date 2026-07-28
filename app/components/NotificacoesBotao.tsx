"use client";

/** Notificações do header:
 *  1) Avisos in-app persistidos (gp_notificacoes) — ex.: "inspeção agendada"
 *     enviados aos envolvidos; contam como não lidos até abrir o sino.
 *  2) Inspeções paradas numa fase que é responsabilidade do perfil do usuário
 *     (Comercial/Operações/Gerência) — "aguardando sua atuação". */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Modal from "./Modal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { tituloFase } from "@/lib/asp/fases";
import { estadoPush, ativarPush, desativarPush, type EstadoPush } from "@/lib/pwa/push";

interface Aviso {
  id: string;
  titulo: string;
  mensagem: string | null;
  link: string | null;
  lida: boolean;
  criado_em: string;
}
interface Feedback {
  id: string;
  tipo: "erro" | "sugestao";
  mensagem: string;
  pagina: string | null;
  autor: string;
  criado_em: string;
}
interface Inspecao {
  id: string;
  identificacao: string;
  fase: number;
  atualizado_em: string | null;
  projeto: { id: string; codigo_projeto: string | null; pedido_compra: string | null; cliente: { razao_social: string } | null } | null;
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
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [inspecoes, setInspecoes] = useState<Inspecao[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [perfil, setPerfil] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const [push, setPush] = useState<EstadoPush>("indisponivel");
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  async function alternarPush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (push === "ativo") {
        await desativarPush();
        setPush("inativo");
      } else {
        const r = await ativarPush();
        if (r.ok) { setPush("ativo"); setPushMsg("Notificações ativadas neste dispositivo."); }
        else setPushMsg(r.motivo || "Não foi possível ativar.");
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function carregarFeedbacks() {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase
      .from("gp_feedbacks")
      .select("id, tipo, mensagem, pagina, created_at, autor:criado_por(nome_completo, email)")
      .eq("status", "aberto")
      .order("created_at", { ascending: false });
    setFeedbacks((data || []).map((f: any) => ({
      id: f.id, tipo: f.tipo, mensagem: f.mensagem, pagina: f.pagina,
      autor: f.autor?.nome_completo || f.autor?.email || "usuário", criado_em: f.created_at,
    })));
  }

  const carregar = useCallback(() => {
    fetch("/api/notificacoes").then((r) => r.ok ? r.json() : { notificacoes: [] }).then((d: any) => setAvisos(d.notificacoes || [])).catch(() => {});
    fetch("/api/inspecoes/pendentes").then((r) => r.ok ? r.json() : {}).then((d: any) => {
      setInspecoes(d.inspecoes || []); setPerfil(d.perfil || null);
      if (d.perfil === "admin") carregarFeedbacks().catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { estadoPush().then(setPush).catch(() => {}); }, []);

  async function resolverFeedback(id: string) {
    setResolvendo(id);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("gp_feedbacks").update({ status: "resolvido", resolvido_por: userData.user?.id, resolvido_em: new Date().toISOString() }).eq("id", id);
      setFeedbacks((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setResolvendo(null);
    }
  }

  const naoLidos = avisos.filter((a) => !a.lida).length;
  const total = naoLidos + inspecoes.length + feedbacks.length;

  async function abrir() {
    setAberto(true);
    if (naoLidos > 0) {
      await fetch("/api/notificacoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ todas: true }) }).catch(() => {});
      setAvisos((prev) => prev.map((a) => ({ ...a, lida: true })));
    }
  }

  return (
    <>
      <button onClick={abrir} title="Notificações"
        style={{ position: "relative", background: "none", border: "1px solid #3a3529", borderRadius: 8,
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", fontSize: 15, color: "#c9c4b6" }}>
        🔔
        {total > 0 && (
          <span style={{ position: "absolute", top: -5, right: -5, background: "var(--acento)", color: "var(--escuro)",
            borderRadius: 999, fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, padding: "0 3px",
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
            {total}
          </span>
        )}
      </button>

      {aberto && (
        <Modal titulo="🔔 Notificações" onFechar={() => setAberto(false)}>
          {push !== "indisponivel" && push !== "sem-chave" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              border: "1px solid #3a3529", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
              <div>
                <strong style={{ fontSize: 13 }}>Notificações no aparelho</strong>
                <span className="detalhe" style={{ display: "block" }}>
                  {push === "ativo" ? "Ativas neste dispositivo."
                    : push === "negado" ? "Permissão bloqueada no navegador."
                    : "Receba avisos mesmo com o app fechado."}
                  {pushMsg ? ` ${pushMsg}` : ""}
                </span>
              </div>
              {push !== "negado" && (
                <button type="button" className="btn-doc" disabled={pushBusy} onClick={alternarPush}>
                  {pushBusy ? "…" : push === "ativo" ? "Desativar" : "Ativar"}
                </button>
              )}
            </div>
          )}
          <span className="detalhe" style={{ fontWeight: 700, display: "block", margin: "0 0 8px" }}>📣 Avisos</span>
          {avisos.length === 0 ? (
            <p className="vazio" style={{ marginBottom: 16 }}>Nenhum aviso.</p>
          ) : (
            avisos.slice(0, 20).map((a) => {
              const conteudo = (
                <div>
                  <strong>{a.titulo}</strong>
                  {a.mensagem && <span className="detalhe">{a.mensagem}</span>}
                  <span className="detalhe">{fmtData(a.criado_em)}</span>
                </div>
              );
              return a.link ? (
                <Link href={a.link} className="item notif" key={a.id} onClick={() => setAberto(false)}
                  style={{ display: "block", textDecoration: "none", color: "inherit", cursor: "pointer", marginBottom: 8 }}>
                  {conteudo}
                </Link>
              ) : (
                <div className="item notif" key={a.id} style={{ display: "block", marginBottom: 8 }}>{conteudo}</div>
              );
            })
          )}

          {perfil === "admin" && (
            <>
              <span className="detalhe" style={{ fontWeight: 700, display: "block", margin: "12px 0 8px" }}>💬 Erros e sugestões</span>
              {feedbacks.length === 0 ? (
                <p className="vazio" style={{ marginBottom: 8 }}>Nenhum aberto.</p>
              ) : (
                feedbacks.map((f) => (
                  <div className="item notif" key={f.id} style={{ display: "block", marginBottom: 8 }}>
                    <strong>{f.tipo === "erro" ? "🐞 Erro" : "💡 Sugestão"} — {f.autor}</strong>
                    <span className="detalhe" style={{ whiteSpace: "pre-wrap" }}>{f.mensagem}</span>
                    <span className="detalhe">{f.pagina ? `Página: ${f.pagina} — ` : ""}{fmtData(f.criado_em)}</span>
                    <button type="button" className="btn-doc" style={{ marginTop: 6 }} disabled={resolvendo === f.id} onClick={() => resolverFeedback(f.id)}>
                      {resolvendo === f.id ? "Salvando…" : "✓ Marcar como resolvido"}
                    </button>
                  </div>
                ))
              )}
            </>
          )}

          <span className="detalhe" style={{ fontWeight: 700, display: "block", margin: "12px 0 8px" }}>
            ⏳ Aguardando sua atuação{perfil ? ` (${NOME_PERFIL[perfil] || perfil})` : ""}
          </span>
          {inspecoes.length === 0 ? (
            <p className="vazio">✅ Nenhuma inspeção aguardando a sua área.</p>
          ) : (
            inspecoes.map((i) => (
              <Link href={`/inspecoes/${i.id}`} className="item notif" key={i.id}
                style={{ display: "block", textDecoration: "none", color: "inherit", cursor: "pointer", marginBottom: 8 }}
                onClick={() => setAberto(false)}>
                <div>
                  <strong>{i.identificacao}</strong>
                  <span className="detalhe">
                    {i.projeto?.codigo_projeto || i.projeto?.pedido_compra || "Projeto"}
                    {i.projeto?.cliente ? ` · ${i.projeto.cliente.razao_social}` : ""}
                  </span>
                  <span className="detalhe">Fase {i.fase} · {tituloFase(i.fase)}</span>
                </div>
              </Link>
            ))
          )}
        </Modal>
      )}
    </>
  );
}
