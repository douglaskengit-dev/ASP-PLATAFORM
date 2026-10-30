"use client";

/** Botão do Robô ASP no header — abre o Assistente da plataforma: tira dúvidas de uso
 * (manual) e responde sobre clientes, projetos e OS consultando o banco com
 * o acesso de quem pergunta (só leitura; ver app/api/assistente). A conversa
 * fica só nesta aba (sessionStorage). */
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import RoboAssistente from "./RoboAssistente";

interface Mensagem { papel: "usuario" | "assistente"; texto: string }

const CHAVE = "assistente-conversa";
const SUGESTOES = [
  "Como gero o relatório de execução?",
  "Quais OS estão aguardando aprovação de relatório?",
  "O que está agendado para esta semana?",
];

export default function AssistenteBotao() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acenando, setAcenando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(CHAVE);
      if (salvo) setMensagens(JSON.parse(salvo));
    } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(CHAVE, JSON.stringify(mensagens)); } catch {}
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens, enviando, aberto]);

  async function perguntar(pergunta: string) {
    const p = pergunta.trim();
    if (!p || enviando) return;
    const nova = [...mensagens, { papel: "usuario" as const, texto: p }];
    setMensagens(nova);
    setTexto("");
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch("/api/assistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagens: nova }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || typeof j.resposta !== "string") throw new Error(j.erro || "O assistente não respondeu.");
      setMensagens((m) => [...m, { papel: "assistente", texto: j.resposta }]);
    } catch (e: any) {
      setErro(e.message || "Falha ao consultar o assistente.");
    } finally {
      setEnviando(false);
    }
  }

  function abrir() {
    setAberto(true);
    setAcenando(true);
    setTimeout(() => setAcenando(false), 1100);
  }

  function abrirLink(href: string) {
    setAberto(false);
    router.push(href);
  }

  return (
    <>
      <button onClick={abrir} title="Assistente: dúvidas sobre o sistema e os projetos"
        aria-label="Abrir o assistente" type="button" className="barra-icone" style={{ padding: "0 4px" }}>
        <RoboAssistente largura={28} modo="cabeca" />
      </button>

      {aberto && (
        <Modal titulo="Assistente ASP" onFechar={() => setAberto(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 300 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <RoboAssistente largura={mensagens.length ? 52 : 78} estado={enviando ? "pensando" : acenando ? "acenando" : "parado"}
                rotulo="Robô ASP, o assistente" />
              <p className="detalhe" style={{ margin: 0 }}>
                {mensagens.length ? "" : <><strong>Olá! Sou o Robô ASP.</strong><br /></>}
                Pergunte como usar a plataforma ou sobre clientes, projetos e OS. Eu só consulto — não altero nada — e vejo apenas o que você pode ver.
              </p>
            </div>

            <div style={{ maxHeight: "55vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {!mensagens.length && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SUGESTOES.map((s) => (
                    <button key={s} type="button" className="btn-doc" onClick={() => perguntar(s)}>{s}</button>
                  ))}
                </div>
              )}
              {mensagens.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.papel === "usuario" ? "flex-end" : "flex-start", maxWidth: "88%",
                  background: m.papel === "usuario" ? "var(--primaria-claro)" : "var(--bg-suave)",
                  border: "1px solid var(--borda)", borderRadius: 10, padding: "8px 12px", fontSize: 14, lineHeight: 1.45,
                }}>
                  {m.papel === "usuario" ? m.texto : <TextoFormatado texto={m.texto} onLink={abrirLink} />}
                </div>
              ))}
              {enviando && (
                <span className="detalhe" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span className="assistente-digitando" aria-hidden="true"><i /><i /><i /></span> Consultando…
                </span>
              )}
              <div ref={fimRef} />
            </div>

            {erro && <span className="msg erro" style={{ margin: 0 }}>{erro}</span>}

            <form onSubmit={(e) => { e.preventDefault(); perguntar(texto); }} style={{ display: "flex", gap: 8 }}>
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={4000}
                aria-label="Sua pergunta" placeholder="Escreva sua pergunta…"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(texto); } }}
                style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--borda)", borderRadius: 8, fontSize: 14, resize: "vertical" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button type="submit" className="btn-azul" disabled={enviando || !texto.trim()}>Enviar</button>
                {mensagens.length > 0 && (
                  <button type="button" className="btn-doc" disabled={enviando}
                    onClick={() => { setMensagens([]); setErro(null); }} title="Começar uma conversa nova">Limpar</button>
                )}
              </div>
            </form>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Markdown mínimo da resposta: parágrafos, listas (- / 1.), **negrito** e
 *  links. Links internos (/...) navegam no app; externos não viram link. */
function TextoFormatado({ texto, onLink }: { texto: string; onLink: (href: string) => void }) {
  const linhas = texto.split("\n");
  const blocos: React.ReactNode[] = [];
  let lista: { ordenada: boolean; itens: string[] } | null = null;
  const fecharLista = () => {
    if (!lista) return;
    const Tag = lista.ordenada ? "ol" : "ul";
    blocos.push(<Tag key={blocos.length} style={{ margin: "4px 0", paddingLeft: 20 }}>
      {lista.itens.map((it, k) => <li key={k}>{inline(it, onLink)}</li>)}
    </Tag>);
    lista = null;
  };
  for (const l of linhas) {
    const item = l.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (item) {
      const ordenada = !!item[1];
      if (lista && lista.ordenada !== ordenada) fecharLista();
      if (!lista) lista = { ordenada, itens: [] };
      lista.itens.push(item[2]);
      continue;
    }
    fecharLista();
    if (!l.trim()) continue;
    const t = l.replace(/^#{1,6}\s+/, "");
    blocos.push(<p key={blocos.length} style={{ margin: "4px 0", fontWeight: t !== l ? 600 : undefined }}>{inline(t, onLink)}</p>);
  }
  fecharLista();
  return <>{blocos}</>;
}

function inline(s: string, onLink: (href: string) => void): React.ReactNode {
  const partes = s.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return partes.map((p, i) => {
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2].trim();
      if (!href.startsWith("/") || href.startsWith("//")) return <Fragment key={i}>{link[1]}</Fragment>;
      return <a key={i} href={href} onClick={(e) => { e.preventDefault(); onLink(href); }}>{link[1]}</a>;
    }
    const negrito = p.match(/^\*\*([^*]+)\*\*$/);
    if (negrito) return <strong key={i}>{negrito[1]}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
