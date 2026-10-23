"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import ThemeToggle from "@/app/components/ThemeToggle";
import { CHAVE_EMAIL_ESQUECI } from "@/lib/validacao";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(
    searchParams.get("erro") === "inativo"
      ? "Sua conta ainda não foi ativada por um administrador. Fale com quem cuida do sistema."
      : null
  );

  function irParaEsqueci(e: React.MouseEvent<HTMLAnchorElement>) {
    // Leva o e-mail digitado sem colocá-lo na URL.
    try { if (email.trim()) sessionStorage.setItem(CHAVE_EMAIL_ESQUECI, email.trim()); } catch { /* sem storage */ }
    e.preventDefault();
    router.push(linkEsqueci);
  }
  const proximoAtual = searchParams.get("proximo");
  const linkEsqueci = `/esqueci-senha${proximoAtual ? `?proximo=${encodeURIComponent(proximoAtual)}` : ""}`;

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEntrando(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) {
        throw new Error(
          error.message === "Invalid login credentials" ? "E-mail ou senha inválidos." : error.message
        );
      }
      const proximo = searchParams.get("proximo") || "/";
      router.replace(proximo);
      router.refresh();
    } catch (err: any) {
      setErro(err.message || "Erro inesperado ao entrar.");
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div id="tela-login">
      <div className="login-tema">
        <ThemeToggle variante="auto" />
      </div>
      <div className="card-login">
        <div className="login-marca">
          <img src="/assets/asp-badge.svg" alt="ASP" className="logo" />
          <img src="/assets/asp-mascote.svg" alt="" aria-hidden="true" className="login-mascote" />
        </div>
        <h1>Plataforma ASP</h1>
        <p className="sub">Acesse com seu e-mail e senha</p>
        <form onSubmit={entrar} className="login-form">
          <div className="login-campo">
            <label htmlFor="login-email">E-mail</label>
            <input
              id="login-email"
              type="email"
              placeholder="voce@empresa.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="login-campo">
            <label htmlFor="login-senha">Senha</label>
            <div className="login-senha">
              <input
                id="login-senha"
                type={mostrarSenha ? "text" : "password"}
                placeholder="Sua senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="login-olho"
                onClick={() => setMostrarSenha((v) => !v)}
                title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={mostrarSenha}
              >
                {mostrarSenha ? "🙈" : "👁️"}
              </button>
            </div>
            <a href={linkEsqueci} onClick={irParaEsqueci} className="login-esqueci">Esqueci minha senha</a>
          </div>
          <button type="submit" className="btn-azul" disabled={entrando} aria-busy={entrando}>
            {entrando ? "Entrando..." : "Entrar"}
          </button>
          {erro && <p className="erro-texto" role="alert">{erro}</p>}
        </form>
        <p className="login-rodape">
          Não tem uma conta? Peça a um administrador do sistema para criar seu acesso.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
