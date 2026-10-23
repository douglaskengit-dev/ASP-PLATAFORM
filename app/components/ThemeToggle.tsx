"use client";

/** D22: alterna entre tema claro e escuro. Persiste em localStorage e aplica
 * via atributo data-theme na <html> (definido cedo por um script inline no
 * layout para evitar flash do tema errado ao carregar a página). */
import { useEffect, useState } from "react";

export default function ThemeToggle({
  variante = "header",
}: {
  /** "header": estilo claro-sobre-escuro fixo, para a barra superior (que
   * tem fundo escuro fixo nos dois temas). "auto": usa as variáveis de tema,
   * para telas fora da barra (ex.: login) onde o fundo muda com o tema. */
  variante?: "header" | "auto";
}) {
  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    setEscuro(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function alternar() {
    const novo = escuro ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", novo);
    localStorage.setItem("tema", novo);
    setEscuro(!escuro);
  }

  return (
    <button
      type="button"
      onClick={alternar}
      title={escuro ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label={escuro ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className={variante === "auto" ? "btn-icone" : "barra-icone"}
    >
      {escuro ? "☀️" : "🌙"}
    </button>
  );
}
