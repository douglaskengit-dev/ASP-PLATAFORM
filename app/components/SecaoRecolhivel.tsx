"use client";

/** Seção "sanfona" da página da inspeção: título que abre/recolhe, resumo
 * de uma linha quando recolhida e botões de ação no cabeçalho.
 *
 * Controlada (quem decide aberta/recolhida é a página, via useSecoes) e
 * deliberadamente NÃO é <details>: o corpo recolhido continua MONTADO, só
 * com `hidden`. Componentes de dentro seguem vivos — a coleta de fotos
 * alimenta o aviso de fase e o relatório, inputs de arquivo escondidos
 * continuam clicáveis pelos botões do cabeçalho e os fetches não recomeçam
 * a cada abertura.
 *
 * Acessibilidade: o botão de alternar fica DENTRO do <h3> (navegação por
 * títulos continua funcionando) e as ações ficam FORA dele — nada de botão
 * dentro de botão. Enter/Espaço vêm de graça do <button>. */

export default function SecaoRecolhivel({ id, titulo, resumo, acoesCabecalho, aberta, onAlternar, children, style }: {
  /** Também é a âncora da URL (#relatorios). */
  id: string;
  titulo: React.ReactNode;
  /** Uma linha de situação, mostrada só com a seção recolhida. */
  resumo?: React.ReactNode;
  /** Botões que funcionam mesmo recolhida (+ Agendar, Gerar relatório…). */
  acoesCabecalho?: React.ReactNode;
  aberta: boolean;
  onAlternar: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const idCorpo = `${id}-corpo`;
  const idResumo = `${id}-resumo`;
  const mostrarResumo = !aberta && resumo != null && resumo !== "";
  return (
    <section id={id} className="card secao" style={style}>
      <div className="secao-topo">
        <div className="secao-cabeca">
          <h3 className="secao-titulo">
            <button type="button" className="secao-alternar" aria-expanded={aberta} aria-controls={idCorpo}
              aria-describedby={mostrarResumo ? idResumo : undefined} onClick={onAlternar}>
              <span className="secao-chevron" aria-hidden="true">▸</span>
              <span>{titulo}</span>
            </button>
          </h3>
          {/* Clique no resumo também abre (atalho de mouse/toque); pelo teclado
              o caminho é o botão do título, que já anuncia o resumo. */}
          {mostrarResumo && (
            <p id={idResumo} className="secao-resumo" onClick={onAlternar}>{resumo}</p>
          )}
        </div>
        {acoesCabecalho && <div className="secao-acoes">{acoesCabecalho}</div>}
      </div>
      <div id={idCorpo} className="secao-corpo" hidden={!aberta}>
        {children}
      </div>
    </section>
  );
}
