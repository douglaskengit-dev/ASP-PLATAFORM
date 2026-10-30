"use client";

/** Assistente da plataforma (Robô ASP): tira dúvidas de uso (manual) e
 * responde sobre clientes, projetos e OS consultando o banco com o acesso de
 * quem pergunta (só leitura; ver app/api/assistente).
 *
 * O robô flutua no canto da tela e abre o chat num painel ao lado. O × no
 * robô o esconde (fica salvo no navegador): aí o atalho passa a ser a cabeça
 * do robô na barra, e o painel tem a opção de trazê-lo de volta. A conversa
 * fica só nesta aba (sessionStorage). */
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import RoboAssistente from "./RoboAssistente";

/** foraDoEscopo: recusa padrão do servidor (mostra as sugestões de novo). */
interface Mensagem { papel: "usuario" | "assistente"; texto: string; foraDoEscopo?: boolean }

const CHAVE = "assistente-conversa";
const CHAVE_OCULTO = "assistente-robo-oculto";
const SUGESTOES = [
  "Como gero o relatório de execução?",
  "Quais OS estão aguardando aprovação de relatório?",
  "O que está agendado para esta semana?",
];

function Sugestoes({ onEscolher }: { onEscolher: (s: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {SUGESTOES.map((s) => (
        <button key={s} type="button" className="btn-doc" onClick={() => onEscolher(s)}>{s}</button>
      ))}
    </div>
  );
}

export default function AssistenteBotao() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  /** null até ler a preferência (evita o robô "piscar" na carga). */
  const [oculto, setOculto] = useState<boolean | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acenando, setAcenando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const atalhoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(CHAVE);
      if (salvo) setMensagens(JSON.parse(salvo));
    } catch {}
    let o = false;
    try { o = localStorage.getItem(CHAVE_OCULTO) === "1"; } catch {}
    setOculto(o);
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(CHAVE, JSON.stringify(mensagens)); } catch {}
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens, enviando, aberto]);
  useEffect(() => {
    if (!aberto) return;
    campoRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  function acenar() {
    setAcenando(true);
    setTimeout(() => setAcenando(false), 1100);
  }

  function abrir() {
    setAberto(true);
    acenar();
  }

  function fechar() {
    setAberto(false);
    atalhoRef.current?.focus();
  }

  function definirOculto(o: boolean) {
    setOculto(o);
    try { o ? localStorage.setItem(CHAVE_OCULTO, "1") : localStorage.removeItem(CHAVE_OCULTO); } catch {}
    acenar();
  }

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
        body: JSON.stringify({ mensagens: nova.map(({ papel, texto }) => ({ papel, texto })) }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || typeof j.resposta !== "string") throw new Error(j.erro || "O assistente não respondeu.");
      setMensagens((m) => [...m, { papel: "assistente", texto: j.resposta, ...(j.fora_do_escopo ? { foraDoEscopo: true } : {}) }]);
    } catch (e: any) {
      setErro(e.message || "Falha ao consultar o assistente.");
    } finally {
      setEnviando(false);
    }
  }

  function abrirLink(href: string) {
    setAberto(false);
    router.push(href);
  }

  if (oculto === null) return null;
  const estado = enviando ? "pensando" : acenando ? "acenando" : "parado";

  const painel = aberto && (
    <section className={`assistente-painel${oculto ? " assistente-painel-topo" : ""}`} role="dialog" aria-modal="false" aria-labelledby="assistente-titulo">
      <header className="assistente-painel-cabeca">
        <RoboAssistente largura={30} modo="cabeca" estado={estado} />
        <h2 id="assistente-titulo" style={{ margin: 0, fontSize: 16, flex: 1 }}>Robô ASP</h2>
        <button type="button" className="assistente-fechar" onClick={fechar} aria-label="Fechar o chat" title="Fechar (Esc)">×</button>
      </header>

      <div className="assistente-painel-corpo">
        {!mensagens.length && (
          <>
            <p className="detalhe" style={{ margin: 0 }}>
              <strong>Olá! Sou o Robô ASP.</strong> Pergunte como usar a plataforma ou sobre clientes, projetos e OS. Eu só consulto — não altero nada — e vejo apenas o que você pode ver.
            </p>
            <Sugestoes onEscolher={perguntar} />
          </>
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
        {!enviando && mensagens[mensagens.length - 1]?.foraDoEscopo && <Sugestoes onEscolher={perguntar} />}
        {enviando && (
          <span className="detalhe" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="assistente-digitando" aria-hidden="true"><i /><i /><i /></span> Consultando…
          </span>
        )}
        {erro && <span className="msg erro" style={{ margin: 0 }}>{erro}</span>}
        <div ref={fimRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); perguntar(texto); }} className="assistente-painel-pe">
        <div style={{ display: "flex", gap: 8 }}>
          <textarea ref={campoRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={4000}
            aria-label="Sua pergunta" placeholder="Escreva sua pergunta…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(texto); } }}
            style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--borda)", borderRadius: 8, fontSize: 14, resize: "none" }} />
          <button type="submit" className="btn-azul" disabled={enviando || !texto.trim()}>Enviar</button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12.5 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={!oculto} onChange={(e) => definirOculto(!e.target.checked)} />
            Robô flutuante na tela
          </label>
          {mensagens.length > 0 && (
            <button type="button" className="assistente-link" disabled={enviando}
              onClick={() => { setMensagens([]); setErro(null); }}>Nova conversa</button>
          )}
        </div>
      </form>
    </section>
  );

  return (
    <>
      {oculto && (
        <button ref={atalhoRef} onClick={() => (aberto ? fechar() : abrir())} title="Robô ASP: dúvidas sobre o sistema e os projetos"
          aria-label="Abrir o assistente" aria-expanded={aberto} type="button" className="barra-icone" style={{ padding: "0 4px" }}>
          <RoboAssistente largura={28} modo="cabeca" />
        </button>
      )}
      {createPortal(
        <>
          {painel}
          {!oculto && (
            <div className="robo-flutuante">
              <button ref={atalhoRef} type="button" className="robo-flutuante-botao" onClick={() => (aberto ? fechar() : abrir())}
                aria-label={aberto ? "Fechar o assistente" : "Abrir o assistente (Robô ASP)"} aria-expanded={aberto}
                title="Robô ASP: dúvidas sobre o sistema e os projetos">
                <RoboAssistente largura={58} estado={estado} />
              </button>
              <button type="button" className="robo-flutuante-x" onClick={() => { setAberto(false); definirOculto(true); }}
                aria-label="Esconder o robô flutuante" title="Esconder o robô (ele fica na barra superior)">×</button>
            </div>
          )}
        </>,
        document.body,
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
