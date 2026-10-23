"use client";

/** /esqueci-senha — pede o link de redefinição (1 h) por e-mail. Pública.
 * A resposta é sempre a mesma, exista a conta ou não (sem enumeração). */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ThemeToggle from "@/app/components/ThemeToggle";
import { CHAVE_EMAIL_ESQUECI, emailValido, MSG_ESQUECI_NEUTRA, normalizarEmail } from "@/lib/validacao";

async function lerJson(resp: Response): Promise<any> {
  try { return await resp.json(); } catch { return {}; }
}

function EsqueciForm() {
  const params = useSearchParams();
  const proximo = params.get("proximo");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);

  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(CHAVE_EMAIL_ESQUECI);
      if (salvo) { setEmail(salvo); sessionStorage.removeItem(CHAVE_EMAIL_ESQUECI); }
    } catch { /* sem storage */ }
  }, []);

  const emailOk = emailValido(normalizarEmail(email));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTentou(true);
    setErro(null);
    if (!emailOk) return;
    setEnviando(true);
    try {
      const resp = await fetch("/api/acesso/esqueci", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizarEmail(email), ...(proximo ? { proximo } : {}) }),
      });
      const d = await lerJson(resp);
      if (resp.ok) setEnviado(d.mensagem || MSG_ESQUECI_NEUTRA);
      else setErro(d.erro || "Não foi possível enviar agora. Tente de novo.");
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const erroEmail = tentou && !emailOk ? (email.trim() ? "E-mail inválido (use o formato nome@dominio.com)." : "Informe seu e-mail.") : null;
  const voltar = `/login${proximo ? `?proximo=${encodeURIComponent(proximo)}` : ""}`;

  return (
    <div id="tela-login">
      <div className="login-tema">
        <ThemeToggle variante="auto" />
      </div>
      <div className="card-login">
        <div className="login-marca">
          <img src="/assets/asp-badge.svg" alt="ASP" className="logo" />
        </div>
        <h1>Esqueci minha senha</h1>
        {!enviado ? (
          <>
            <p className="sub">Informe seu e-mail de acesso. Enviaremos um link para você criar uma nova senha.</p>
            <form onSubmit={enviar} className="login-form" noValidate>
              <div className="login-campo">
                <label htmlFor="esqueci-email">E-mail</label>
                <input id="esqueci-email" type="email" placeholder="voce@empresa.com.br" value={email}
                  onChange={(e) => { setEmail(e.target.value); setErro(null); }}
                  autoComplete="username" autoFocus required
                  aria-invalid={!!erroEmail} aria-describedby={erroEmail ? "erro-esqueci-email" : undefined}
                  className={erroEmail ? "val-invalido" : undefined} />
                {erroEmail && <p id="erro-esqueci-email" className="erro-texto" style={{ margin: 0 }}>{erroEmail}</p>}
              </div>
              <button type="submit" className="btn-azul" disabled={enviando} aria-busy={enviando}>
                {enviando ? "Enviando..." : "Enviar link"}
              </button>
              {erro && <p className="erro-texto" role="alert">{erro}</p>}
            </form>
          </>
        ) : (
          <div role="status">
            <p className="msg ok" style={{ margin: "12px 0 8px", textAlign: "center" }}>✉️ {enviado}</p>
            <p className="sub" style={{ marginBottom: 16 }}>
              O link vale por <strong>1 hora</strong> e só pode ser usado uma vez. Confira também a caixa de spam.
            </p>
            <div className="login-form">
              <button type="button" className="btn-doc" onClick={() => { setEnviado(null); setTentou(false); }}>
                Usar outro e-mail
              </button>
            </div>
          </div>
        )}
        <p className="login-rodape"><a href={voltar}>← Voltar para o login</a></p>
      </div>
    </div>
  );
}

export default function EsqueciSenhaPage() {
  return (
    <Suspense>
      <EsqueciForm />
    </Suspense>
  );
}
