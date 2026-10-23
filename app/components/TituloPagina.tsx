/** Título de página com o mascote ASP ao lado — identidade visual da marca.
 * Ver COWORK-ASP (frontend). O mascote é o robô oficial (public/assets). */
import Image from "next/image";

export default function TituloPagina({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="titulo-pagina">
      <Image src="/assets/asp-mascote.svg" alt="" aria-hidden="true" width={46} height={53} priority className="titulo-pagina-mascote" />
      <div style={{ minWidth: 0 }}>
        <h1>{titulo}</h1>
        {subtitulo && <p>{subtitulo}</p>}
      </div>
    </div>
  );
}
