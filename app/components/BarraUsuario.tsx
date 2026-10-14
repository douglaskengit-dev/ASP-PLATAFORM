"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import Modal from "./Modal";
import ThemeToggle from "./ThemeToggle";
import NotificacoesBotao from "./NotificacoesBotao";
import FeedbackBotao from "./FeedbackBotao";
import SyncStatus from "./SyncStatus";
import OrgaosConteudo from "./OrgaosConteudo";
import HistoricoConteudo from "./HistoricoConteudo";
import PerfilConteudo from "./PerfilConteudo";
import AdminUsuariosConteudo from "./AdminUsuariosConteudo";
import { corPerfil, NOMES_PERFIL, textoAvatarPerfil } from "@/lib/perfil";

type ModalId = "orgaos" | "historico" | "perfil" | "admin" | null;
type TipoPerfil = "admin" | "editor" | "visualizador" | null;

const ID_MENU = "menu-principal";

const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Barra de navegação principal (D18): Dashboard → Follow-up → Arquivos como
 * abas (Análise TR saiu da navegação fixa — acessada pelo card do Follow-up).
 * Órgãos, Histórico, Administração e Perfil abrem em modal, sem sair da tela
 * atual. Não aparece na tela de login.
 *
 * Responsividade: a linha nunca é espremida — compacta por faixas de largura
 * (media queries em globals.css) e, em telas estreitas, troca abas/ações por
 * um menu hambúrguer (gaveta acessível: aria-expanded/aria-controls, Esc
 * fecha, foco preso na gaveta e devolvido ao botão ao fechar). Como rede de
 * segurança, a barra é medida: se o conteúdo não couber mesmo assim, aplica
 * os mesmos degraus antes (.compacta → .forcar-menu). */
export default function BarraUsuario() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [tipoPerfil, setTipoPerfil] = useState<TipoPerfil>(null);
  const [ehAdmin, setEhAdmin] = useState(false);
  const [modalAberto, setModalAberto] = useState<ModalId>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const barraRef = useRef<HTMLElement>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function carregarPerfil() {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
      if (data.user) {
        const { data: perfil } = await supabase
          .from("gp_profiles")
          .select("perfil, nome_completo")
          .eq("id", data.user.id)
          .single();
        setEhAdmin(perfil?.perfil === "admin");
        setNome(perfil?.nome_completo || null);
        setTipoPerfil((perfil?.perfil as TipoPerfil) || null);
      } else {
        setEhAdmin(false);
        setNome(null);
        setTipoPerfil(null);
      }
    }
    carregarPerfil();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      carregarPerfil();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Fecha o modal e o menu automaticamente ao navegar (ex.: clicar num órgão
  // dentro do modal de Órgãos abre a página de detalhe /orgaos/[id]).
  useEffect(() => {
    setModalAberto(null);
    setMenuAberto(false);
  }, [pathname]);

  /** Fecha a gaveta; `devolverFoco` volta o foco ao botão ☰ (Esc, ✕, clique
   * fora). Não devolve quando a gaveta fecha para abrir um modal. */
  const fecharMenu = useCallback((devolverFoco = false) => {
    setMenuAberto(false);
    if (devolverFoco) requestAnimationFrame(() => botaoMenuRef.current?.focus());
  }, []);

  // Gaveta aberta: foco no primeiro item, Esc fecha, Tab circula dentro dela,
  // rolagem da página travada e fecha sozinha se a janela alargar.
  useEffect(() => {
    if (!menuAberto) return;
    const painel = painelRef.current;
    painel?.querySelector<HTMLElement>(SELETOR_FOCAVEL)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        fecharMenu(true);
        return;
      }
      if (e.key !== "Tab" || !painel) return;
      const focaveis = Array.from(painel.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL));
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      if (e.shiftKey && (ativo === primeiro || !painel.contains(ativo))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (ativo === ultimo || !painel.contains(ativo))) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflowAnterior;
    };
  }, [menuAberto, fecharMenu]);

  // Rede de segurança contra sobreposição: mede a linha a cada mudança de
  // tamanho (janela ou conteúdo, ex.: indicador de sincronização aparecendo).
  // Se não couber, esconde nome/wordmark (.compacta); se ainda não couber,
  // força o hambúrguer (.forcar-menu). A medição é síncrona (sem pintar o
  // estado intermediário). Também fecha a gaveta quando o ☰ deixa de existir
  // (janela alargada).
  const visivel = !(pathname === "/" || pathname === "/login" || !email);
  useEffect(() => {
    const barra = barraRef.current;
    if (!visivel || !barra) return;
    const cabe = () => barra.scrollWidth <= barra.clientWidth + 1;

    function ajustar() {
      if (!barra) return;
      barra.classList.remove("compacta", "forcar-menu");
      if (!cabe()) {
        barra.classList.add("compacta");
        if (!cabe()) barra.classList.add("forcar-menu");
      }
      const botao = botaoMenuRef.current;
      if (botao && getComputedStyle(botao).display === "none") setMenuAberto(false);
    }

    ajustar();
    const ro = new ResizeObserver(() => ajustar());
    ro.observe(barra);
    Array.from(barra.children).forEach((filho) => ro.observe(filho));
    // Com .forcar-menu o indicador de sincronização fica oculto (tamanho 0),
    // então o ResizeObserver não percebe quando ele some — remede nos eventos
    // que o alteram (após o React renderizar).
    let quadro = 0;
    const remedir = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(ajustar); };
    const eventos = ["asp:fila", "online", "offline"];
    eventos.forEach((ev) => window.addEventListener(ev, remedir));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(quadro);
      eventos.forEach((ev) => window.removeEventListener(ev, remedir));
    };
  }, [visivel, ehAdmin, nome]);

  if (!visivel) return null;

  async function sair() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    // D52: ao sair, volta para a página inicial (landing com "Acessar o
    // sistema"). Navegação completa (window.location) para a página atual não
    // disparar seu próprio redirect de 401 para /login no meio do caminho.
    window.location.href = "/";
  }

  /** Abre um modal a partir da gaveta (fecha a gaveta antes). */
  function abrirModalDoMenu(id: Exclude<ModalId, null>) {
    fecharMenu();
    setModalAberto(id);
  }

  const abas = [
    { href: "/dashboard", rotulo: "Dashboard" },
    { href: "/projetos", rotulo: "Projetos" },
    { href: "/arquivos", rotulo: "Arquivos" },
    { href: "/catalogo", rotulo: "Catálogo" },
    { href: "/lixeira", rotulo: "Lixeira" },
  ];

  const nomeExibido = nome || email;
  const tituloPerfil = `Editar nome, e-mail e senha — ${tipoPerfil ? NOMES_PERFIL[tipoPerfil] : "perfil"}`;
  const avatar = (
    <span
      className="barra-avatar"
      aria-hidden="true"
      style={{ background: corPerfil(tipoPerfil), color: textoAvatarPerfil(tipoPerfil) }}
    >
      {(nome || email || "?").trim().charAt(0).toUpperCase()}
    </span>
  );

  return (
    <>
      <header className="barra" ref={barraRef}>
        <div className="barra-esq">
          <Link href="/" title="Voltar à página inicial" className="barra-logo">
            <Image src="/assets/asp-badge.svg" alt="ASP" width={38} height={38} priority />
            <span className="barra-wordmark" aria-hidden="true">
              <span>ADVANCED</span>
              <span>SERVICES</span>
              <span>PROVIDER</span>
            </span>
          </Link>
          <nav className="barra-nav-desktop" aria-label="Navegação principal">
            {abas.map((a) => {
              const ativa = pathname.startsWith(a.href);
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className={`barra-aba${ativa ? " ativo" : ""}`}
                  aria-current={ativa ? "page" : undefined}
                >
                  {a.rotulo}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="barra-dir">
          {/* Desktop: ações em linha (somem abaixo do breakpoint do menu). */}
          <div className="barra-acoes-desktop">
            <button type="button" onClick={() => setModalAberto("orgaos")} title="Clientes cadastrados" className="barra-link">
              Clientes
            </button>
            <button type="button" onClick={() => setModalAberto("historico")} title="Projetos em aberto" className="barra-link">
              Histórico
            </button>
            {ehAdmin && (
              <button type="button" onClick={() => setModalAberto("admin")} title="Administração de usuários" className="barra-link">
                Administração
              </button>
            )}
            <button
              type="button"
              onClick={() => setModalAberto("perfil")}
              title={`${nomeExibido} — ${tituloPerfil}`}
              aria-label={`Meu perfil: ${nomeExibido}`}
              className="barra-perfil"
            >
              {avatar}
              <span className="barra-perfil-nome">{nomeExibido}</span>
            </button>
            <SyncStatus />
          </div>

          {/* Sempre visíveis (desktop e celular): ações de uso frequente. */}
          <FeedbackBotao />
          <NotificacoesBotao />
          <ThemeToggle />

          <button type="button" onClick={sair} title="Sair do sistema" className="barra-sair">
            Sair
          </button>

          <button
            ref={botaoMenuRef}
            type="button"
            className="barra-hamburguer"
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuAberto}
            aria-controls={ID_MENU}
            aria-haspopup="dialog"
            onClick={() => (menuAberto ? fecharMenu(true) : setMenuAberto(true))}
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </header>

      {menuAberto && (
        <div className="menu-mobile" onClick={() => fecharMenu(true)}>
          <div
            id={ID_MENU}
            ref={painelRef}
            className="menu-mobile-painel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${ID_MENU}-titulo`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-mobile-topo">
              <span id={`${ID_MENU}-titulo`} className="menu-mobile-titulo">MENU</span>
              <button type="button" aria-label="Fechar menu" className="menu-mobile-fechar" onClick={() => fecharMenu(true)}>
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            <nav aria-label="Navegação principal" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {abas.map((a) => {
                const ativa = pathname.startsWith(a.href);
                return (
                  <Link
                    key={a.href}
                    href={a.href}
                    onClick={() => fecharMenu()}
                    aria-current={ativa ? "page" : undefined}
                    className={`menu-mobile-item${ativa ? " ativo" : ""}`}
                  >
                    {a.rotulo}
                  </Link>
                );
              })}
            </nav>

            <div className="menu-mobile-sep" />

            <button type="button" className="menu-mobile-item" onClick={() => abrirModalDoMenu("orgaos")}>Clientes</button>
            <button type="button" className="menu-mobile-item" onClick={() => abrirModalDoMenu("historico")}>Histórico</button>
            {ehAdmin && (
              <button type="button" className="menu-mobile-item" onClick={() => abrirModalDoMenu("admin")}>Administração</button>
            )}
            <button type="button" className="menu-mobile-item" title={tituloPerfil} onClick={() => abrirModalDoMenu("perfil")}>
              {avatar}
              <span className="menu-mobile-nome">{nomeExibido}</span>
            </button>

            <div className="menu-mobile-sep" />

            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 12px" }}>
              <SyncStatus />
            </div>

            <button type="button" className="menu-mobile-item sair" onClick={() => { fecharMenu(); sair(); }}>
              Sair
            </button>
          </div>
        </div>
      )}

      {modalAberto === "orgaos" && (
        <Modal titulo="Clientes" onFechar={() => setModalAberto(null)}>
          <OrgaosConteudo />
        </Modal>
      )}
      {modalAberto === "historico" && (
        <Modal titulo="Projetos em Aberto" onFechar={() => setModalAberto(null)}>
          <HistoricoConteudo />
        </Modal>
      )}
      {modalAberto === "admin" && ehAdmin && (
        <Modal titulo="Administração de usuários" onFechar={() => setModalAberto(null)}>
          <AdminUsuariosConteudo />
        </Modal>
      )}
      {modalAberto === "perfil" && (
        <Modal titulo="Meu perfil" onFechar={() => setModalAberto(null)}>
          <PerfilConteudo />
        </Modal>
      )}
    </>
  );
}
