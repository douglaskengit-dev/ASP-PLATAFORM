"use client";

/** Modal genérico (D18) — usado por Órgãos, Histórico, Perfil e Administração
 * a partir do header, sem sair da tela atual. Fecha com Esc, clique fora ou
 * o botão de fechar. */
import { useEffect } from "react";

// D38: contador global de modais abertos — com dois modais empilhados
// (ex.: "Cadastrar órgão" por cima de "Abrir novo processo"), o scroll do
// body só pode voltar quando o ÚLTIMO deles fechar, senão fechar o de cima
// destrava o scroll com o de baixo ainda aberto.
let modaisAbertos = 0;

export default function Modal({
  titulo,
  onFechar,
  children,
  zIndex = 100,
  largo = false,
  semPadding = false,
}: {
  titulo: string;
  onFechar: () => void;
  children: React.ReactNode;
  /** D38: permite abrir um modal por cima de outro (ex.: cadastro de órgão
   * disparado de dentro do modal "Abrir novo processo") sem que os dois
   * fundos escurecidos se somem de forma confusa. */
  zIndex?: number;
  /** Modal mais largo — usado para conteúdo que precisa de mais espaço
   * (ex.: ferramentas embutidas por iframe). */
  largo?: boolean;
  /** Remove o padding interno — usado quando o filho (ex.: iframe) já
   * preenche a área sozinho, sem margem em volta. */
  semPadding?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", onKey);
    modaisAbertos += 1;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      modaisAbertos = Math.max(0, modaisAbertos - 1);
      if (modaisAbertos === 0) document.body.style.overflow = "";
    };
  }, [onFechar]);

  return (
    <div onClick={onFechar} style={{ zIndex }} className="modal-overlay">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`modal-caixa${largo ? " largo" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div className="modal-cabeca">
          <strong className="modal-titulo">{titulo}</strong>
          <button type="button" onClick={onFechar} title="Fechar" aria-label="Fechar" className="modal-fechar">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className={`modal-corpo${semPadding ? " sem-padding" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
