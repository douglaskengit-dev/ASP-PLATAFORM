"use client";

/** Foto em tamanho grande numa caixa por cima da tela atual.
 *
 *  Antes a miniatura era um link para a imagem: no app instalado (PWA) a foto
 *  abria na própria janela e o "voltar" do celular saía da plataforma, caindo
 *  na tela inicial. Aqui a caixa empurra uma entrada no histórico — o
 *  "voltar" do aparelho só fecha a caixa. Fecha também com Esc, ✕ ou toque
 *  fora da foto. Com mais de uma foto: setas (teclado/tela) ou deslizar. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** history.back() agendado pela caixa que acabou de fechar. */
let voltarPendente: number | null = null;

const botao: React.CSSProperties = {
  position: "absolute", border: "none", borderRadius: "50%", width: 44, height: 44,
  background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 20, lineHeight: "44px", padding: 0, cursor: "pointer",
};

export default function VisualizadorFoto({ fotos, inicio = 0, legenda, onFechar }: {
  fotos: string[];
  inicio?: number;
  legenda?: string;
  onFechar: () => void;
}) {
  const [i, setI] = useState(Math.min(Math.max(inicio, 0), fotos.length - 1));
  const toqueX = useRef<number | null>(null);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  const varias = fotos.length > 1;
  const ir = (passo: number) => setI((a) => (a + passo + fotos.length) % fotos.length);

  // "Voltar" do aparelho/navegador fecha a caixa em vez de sair da tela.
  useEffect(() => {
    if (voltarPendente !== null) {
      // remontagem imediata (React Strict Mode): a entrada continua lá
      clearTimeout(voltarPendente);
      voltarPendente = null;
    } else {
      // Copia o estado atual: o roteador do Next recarrega a página ao
      // voltar para uma entrada sem os dados dele.
      window.history.pushState({ ...(window.history.state || {}), visualizadorFoto: true }, "");
    }
    let fechouPeloVoltar = false;
    const onPop = () => { fechouPeloVoltar = true; fecharRef.current(); };
    window.addEventListener("popstate", onPop);
    const corpo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = corpo;
      // fechou pelo ✕/Esc/fora: tira a entrada que a caixa pôs no histórico.
      // Adiado: se a caixa remontar em seguida, a remontagem cancela.
      if (!fechouPeloVoltar) {
        voltarPendente = window.setTimeout(() => {
          voltarPendente = null;
          if (window.history.state?.visualizadorFoto) window.history.back();
        }, 0);
      }
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); fecharRef.current(); }
      else if (varias && e.key === "ArrowRight") ir(1);
      else if (varias && e.key === "ArrowLeft") ir(-1);
    }
    // captura na window: o Esc não chega ao modal de baixo (que fecharia junto)
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });   // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Foto ampliada" onClick={onFechar}
      onTouchStart={(e) => { toqueX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (!varias || toqueX.current === null) return;
        const dx = e.changedTouches[0].clientX - toqueX.current;
        toqueX.current = null;
        if (Math.abs(dx) > 50) ir(dx < 0 ? 1 : -1);
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "56px 12px calc(56px + env(safe-area-inset-bottom))" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fotos[i]} alt={legenda || "Foto"} onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,.5)" }} />
      <button type="button" aria-label="Fechar" onClick={onFechar}
        style={{ ...botao, top: "calc(10px + env(safe-area-inset-top))", right: 10 }}>✕</button>
      {varias && (
        <>
          <button type="button" aria-label="Foto anterior" onClick={(e) => { e.stopPropagation(); ir(-1); }}
            style={{ ...botao, left: 10, top: "50%", transform: "translateY(-50%)" }}>‹</button>
          <button type="button" aria-label="Próxima foto" onClick={(e) => { e.stopPropagation(); ir(1); }}
            style={{ ...botao, right: 10, top: "50%", transform: "translateY(-50%)" }}>›</button>
        </>
      )}
      {(legenda || varias) && (
        <div onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", left: 0, right: 0, bottom: "calc(14px + env(safe-area-inset-bottom))",
            textAlign: "center", color: "#fff", fontSize: 13, padding: "0 60px" }}>
          {legenda}{legenda && varias ? " · " : ""}{varias ? `${i + 1} de ${fotos.length}` : ""}
        </div>
      )}
    </div>,
    document.body,
  );
}
