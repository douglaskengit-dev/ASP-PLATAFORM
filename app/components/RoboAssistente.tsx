"use client";

/** Robô ASP (mascote do capacete) animado — rosto do Assistente.
 *  A imagem é uma só (public/assistente/robo-asp.webp, recorte do "Logo para
 *  capacete"); a piscada são "pálpebras" na cor do visor por cima de cada
 *  olho. Animações em globals.css (.robo-*), desligadas com
 *  prefers-reduced-motion.
 *
 *  estado: "parado" (flutua, balança e pisca), "pensando" (enquanto consulta)
 *  e "acenando" (cumprimento ao abrir). modo "cabeca" mostra só o capacete e
 *  o rosto (botão da barra e avatar das respostas). */

/** Tamanho da imagem original (px) — base das posições em %. */
const W = 375, H = 658;
/** Olhos: centro e raio no original. */
const OLHOS = [{ x: 146, y: 149, r: 33 }, { x: 252, y: 159, r: 35 }];
/** Recorte da cabeça no original. */
const CABECA = { x: 10, y: 0, w: 355, h: 270 };

export type EstadoRobo = "parado" | "pensando" | "acenando";

export default function RoboAssistente({ largura, estado = "parado", modo = "inteiro", rotulo }: {
  /** Largura em px. */
  largura: number;
  estado?: EstadoRobo;
  modo?: "inteiro" | "cabeca";
  /** Texto para leitores de tela; sem ele, a imagem é decorativa. */
  rotulo?: string;
}) {
  const cabeca = modo === "cabeca";
  const alturaCaixa = cabeca ? (largura * CABECA.h) / CABECA.w : (largura * H) / W;
  return (
    <span className={`robo robo-${estado}`} role={rotulo ? "img" : undefined} aria-label={rotulo} aria-hidden={rotulo ? undefined : true}
      style={{ display: "inline-block", position: "relative", width: largura, height: alturaCaixa, overflow: cabeca ? "hidden" : "visible", flex: "none" }}>
      <span className="robo-corpo" style={{
        position: "absolute", display: "block",
        width: cabeca ? `${(W / CABECA.w) * 100}%` : "100%",
        left: cabeca ? `${(-CABECA.x / CABECA.w) * 100}%` : 0, top: 0,
        aspectRatio: `${W} / ${H}`,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assistente/robo-asp.webp" alt="" draggable={false}
          style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }} />
        {OLHOS.map((o, i) => (
          <span key={i} className="robo-palpebra" style={{
            left: `${((o.x - o.r) / W) * 100}%`, top: `${((o.y - o.r) / H) * 100}%`,
            width: `${((2 * o.r) / W) * 100}%`, height: `${((2 * o.r) / H) * 100}%`,
          }} />
        ))}
      </span>
    </span>
  );
}
