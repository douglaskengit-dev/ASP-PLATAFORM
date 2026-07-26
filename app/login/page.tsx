"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import ThemeToggle from "@/app/components/ThemeToggle";

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
      <div style={{ position: "fixed", top: 16, right: 16 }}>
        <ThemeToggle variante="auto" />
      </div>
      <div className="card-login">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
          <img src="/assets/asp-badge.svg" alt="ASP" className="logo" style={{ margin: 0 }} />
          <img src="/assets/asp-mascote.svg" alt="Mascote ASP" style={{ height: 64, width: "auto" }} />
        </div>
        <h1>Plataforma ASP</h1>
        <p className="sub">Acesse com seu e-mail e senha</p>
        <form onSubmit={entrar}>
          <input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
          <div style={{ position: "relative", marginTop: 20 }}>
            <input
              type={mostrarSenha ? "text" : "password"}
              placeholder="Senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
              style={{ margin: 0, paddingRight: 46 }}
            />
            <button
              type="button"
              onClick={() => setMostrarSenha((v) => !v)}
              title={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                width: "auto", minWidth: 0, margin: 0, padding: "4px 8px",
                background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, color: "var(--cinza)",
              }}
            >
              {mostrarSenha ? "🙈" : "👁️"}
            </button>
          </div>
          <button type="submit" disabled={entrando}>
            {entrando ? "Entrando..." : "Entrar"}
          </button>
          {erro && <p className="erro-texto">{erro}</p>}
        </form>
        <p style={{ fontSize: 12, color: "var(--cinza)", marginTop: 16 }}>
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
