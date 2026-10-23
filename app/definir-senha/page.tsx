"use client";

/** /definir-senha#t=… — aberta pelo link do convite ("Criar minha senha",
 * 24 h) ou da redefinição (1 h). Pública (middleware). Confere o link, pede
 * a senha duas vezes e, ao gravar, a pessoa já entra (cookie de sessão) e
 * vai ao Dashboard (ou à página que tentava abrir). Expirado / já usado /
 * inválido → "Pedir novo link" (Esqueci minha senha, com o e-mail). */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ThemeToggle from "@/app/components/ThemeToggle";
import { CHAVE_EMAIL_ESQUECI, SENHA_MINIMA, tokenDoLink, validarNovaSenha } from "@/lib/validacao";

type Estado =
  | { fase: "carregando" }
  | { fase: "form"; tipo: "convite" | "redefinicao"; email: string }
  | { fase: "erro"; estado: "expirado" | "usado" | "invalido" | "falha"; mensagem: string; email?: string }
  | { fase: "pronto"; destino: string; entrou: boolean };

async function lerJson(resp: Response): Promise<any> {
  try { return await resp.json(); } catch { return {}; }
}

function DefinirSenhaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenQuery = params.get("t");
  // O token vem no fragmento (#t=…), que só existe no navegador.
  const [token, setToken] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<{ campo?: string; texto: string } | null>(null);

  useEffect(() => {
    setToken(tokenDoLink(window.location.hash, tokenQuery));
  }, [tokenQuery]);

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      setEstado({ fase: "erro", estado: "invalido", mensagem: "Link incompleto. Abra o link exatamente como veio no e-mail." });
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const resp = await fetch("/api/acesso/validar", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token }),
        });
        const d = await lerJson(resp);
        if (!vivo) return;
        if (resp.ok && d.ok) setEstado({ fase: "form", tipo: d.tipo, email: d.email || "" });
        else setEstado({ fase: "erro", estado: d.estado || "falha", mensagem: d.erro || "Não foi possível conferir o link.", email: d.email });
      } catch {
        if (vivo) setEstado({ fase: "erro", estado: "falha", mensagem: "Sem conexão com o servidor. Tente de novo." });
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  const v = validarNovaSenha(senha, confirmar);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setTentou(true);
    setErro(null);
    if (v) return;
    setSalvando(true);
    try {
      const resp = await fetch("/api/acesso/definir-senha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, senha, confirmacao: confirmar }),
      });
      const d = await lerJson(resp);
      if (resp.ok && d.ok) {
        setEstado({ fase: "pronto", destino: d.destino || "/dashboard", entrou: d.entrou !== false });
        setSenha(""); setConfirmar("");
        setTimeout(() => { router.replace(d.destino || "/dashboard"); router.refresh(); }, 900);
        return;
      }
      if (d.estado && d.estado !== "valido" && resp.status !== 400) {
        setEstado({ fase: "erro", estado: d.estado, mensagem: d.erro, email: d.email });
        return;
      }
      setErro({ campo: d.campo, texto: d.erro || "Não foi possível definir a senha." });
    } catch {
      setErro({ texto: "Sem conexão com o servidor. Tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  function pedirNovoLink(email?: string) {
    try { if (email) sessionStorage.setItem(CHAVE_EMAIL_ESQUECI, email); } catch { /* sem storage: digita de novo */ }
    router.push("/esqueci-senha");
  }

  const convite = estado.fase === "form" && estado.tipo === "convite";
  const erroSenha = tentou && v?.campo === "senha" ? v.erro : erro?.campo === "senha" ? erro.texto : null;
  const erroConfirmar = tentou && v?.campo === "confirmar" ? v.erro : null;

  return (
    <div id="tela-login">
      <div className="login-tema">
        <ThemeToggle variante="auto" />
      </div>
      <div className="card-login">
        <div className="login-marca">
          <img src="/assets/asp-badge.svg" alt="ASP" className="logo" />
        </div>

        {estado.fase === "carregando" && (
          <>
            <h1>Plataforma ASP</h1>
            <p className="sub" role="status">Conferindo o link…</p>
          </>
        )}

        {estado.fase === "form" && (
          <>
            <h1>{convite ? "Crie sua senha" : "Nova senha"}</h1>
            <p className="sub">
              {convite ? "Bem-vindo! " : ""}Defina a senha de <strong>{estado.email}</strong>
            </p>
            <form onSubmit={salvar} className="login-form" noValidate>
              {/* Para o gerenciador de senhas associar ao login certo. */}
              <input type="email" name="username" autoComplete="username" value={estado.email} readOnly hidden />
              <div className="login-campo">
                <label htmlFor="nova-senha">Nova senha</label>
                <div className="login-senha">
                  <input id="nova-senha" type={mostrar ? "text" : "password"} value={senha} autoFocus
                    onChange={(e) => { setSenha(e.target.value); setErro(null); }}
                    autoComplete="new-password" placeholder={`Mínimo ${SENHA_MINIMA} caracteres`}
                    aria-invalid={!!erroSenha} aria-describedby={erroSenha ? "erro-nova-senha" : undefined}
                    className={erroSenha ? "val-invalido" : undefined} />
                  <button type="button" className="login-olho" onClick={() => setMostrar((m) => !m)}
                    title={mostrar ? "Ocultar senha" : "Mostrar senha"} aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"} aria-pressed={mostrar}>
                    {mostrar ? "🙈" : "👁️"}
                  </button>
                </div>
                {erroSenha && <p id="erro-nova-senha" className="erro-texto" style={{ margin: 0 }}>{erroSenha}</p>}
              </div>
              <div className="login-campo">
                <label htmlFor="confirmar-senha">Confirmar nova senha</label>
                <input id="confirmar-senha" type={mostrar ? "text" : "password"} value={confirmar}
                  onChange={(e) => { setConfirmar(e.target.value); setErro(null); }}
                  autoComplete="new-password" placeholder="Repita a senha"
                  aria-invalid={!!erroConfirmar} aria-describedby={erroConfirmar ? "erro-confirmar-senha" : undefined}
                  className={erroConfirmar ? "val-invalido" : undefined} />
                {erroConfirmar && <p id="erro-confirmar-senha" className="erro-texto" style={{ margin: 0 }}>{erroConfirmar}</p>}
              </div>
              <button type="submit" className="btn-azul" disabled={salvando} aria-busy={salvando}>
                {salvando ? "Salvando..." : convite ? "Criar senha e entrar" : "Salvar senha e entrar"}
              </button>
              {erro && erro.campo !== "senha" && <p className="erro-texto" role="alert">{erro.texto}</p>}
            </form>
            <p className="login-rodape">O link é de uso único{convite ? " e vale por 24 horas" : " e vale por 1 hora"}.</p>
          </>
        )}

        {estado.fase === "erro" && (
          <>
            <h1>{estado.estado === "expirado" ? "Link expirado" : estado.estado === "usado" ? "Link já usado" : estado.estado === "falha" ? "Algo deu errado" : "Link inválido"}</h1>
            <p className="erro-texto" role="alert" style={{ margin: "12px 0 20px" }}>{estado.mensagem}</p>
            <div className="login-form">
              {estado.estado !== "falha" ? (
                <button type="button" className="btn-azul" onClick={() => pedirNovoLink(estado.email)}>Pedir novo link</button>
              ) : (
                <button type="button" className="btn-azul" onClick={() => window.location.reload()}>Tentar de novo</button>
              )}
              <a href="/login" className="btn-doc" style={{ textAlign: "center" }}>Ir para o login</a>
            </div>
          </>
        )}

        {estado.fase === "pronto" && (
          <>
            <h1>Senha definida ✓</h1>
            <p className="sub" role="status">
              {estado.entrou ? "Entrando na Plataforma ASP…" : "Agora entre com seu e-mail e a nova senha."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function DefinirSenhaPage() {
  return (
    <Suspense>
      <DefinirSenhaForm />
    </Suspense>
  );
}
