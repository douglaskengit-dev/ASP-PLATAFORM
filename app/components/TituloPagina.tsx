/** Título de página com o mascote ASP ao lado — identidade visual da marca.
 * Ver COWORK-ASP (frontend). O mascote é o robô oficial (public/assets). */
import Image from "next/image";

export default function TituloPagina({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <Image src="/assets/asp-mascote.svg" alt="Mascote ASP" width={46} height={53} priority style={{ flexShrink: 0 }} />
      <div>
        <h1 style={{ margin: 0, fontFamily: "var(--fonte-titulo)", color: "var(--texto)" }}>{titulo}</h1>
        {subtitulo && <p className="detalhe" style={{ margin: "2px 0 0" }}>{subtitulo}</p>}
      </div>
    </div>
  );
}
