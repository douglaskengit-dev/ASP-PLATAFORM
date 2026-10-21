"use client";

/** Mensagens de validação (lib/validacao) na tela.
 *
 *   <MensagensCampo r={r} campo="cnpj" />  → logo abaixo do campo
 *   <ResumoValidacao r={r} rotulos={…} />  → junto do botão de salvar
 *
 * ⛔ erro (vermelho) bloqueia o salvar; ⚠️ aviso (âmbar) só alerta.
 * `mostrarErros` = false esconde os erros (ex.: "campo obrigatório" antes
 * de o usuário mexer no campo ou tentar salvar); avisos aparecem sempre. */
import type { ReactNode } from "react";
import { resumoValidacao, type ResultadoValidacao } from "@/lib/validacao";

export function MensagensCampo({ r, campo, mostrarErros = true, children }: {
  r: ResultadoValidacao;
  campo: string;
  mostrarErros?: boolean;
  /** Ação extra junto dos avisos (ex.: botão "Usar o contato X"). */
  children?: ReactNode;
}) {
  const erros = mostrarErros ? r.erros[campo] || [] : [];
  const avisos = r.avisos[campo] || [];
  if (!erros.length && !avisos.length && !children) return null;
  return (
    <div className="val-campo" aria-live="polite">
      {erros.map((m) => <p key={"e" + m} className="val-msg val-erro">⛔ {m}</p>)}
      {avisos.map((m) => <p key={"a" + m} className="val-msg val-aviso">⚠️ {m}</p>)}
      {children}
    </div>
  );
}

export function ResumoValidacao({ r, rotulos = {}, mostrarErros = true }: {
  r: ResultadoValidacao;
  rotulos?: Record<string, string>;
  mostrarErros?: boolean;
}) {
  const { erros, avisos } = resumoValidacao(r, rotulos);
  const e = mostrarErros ? erros : [];
  if (!e.length && !avisos.length) return null;
  return (
    <div className="val-resumo" role="status">
      {e.length > 0 && (
        <>
          <strong className="val-erro">⛔ Corrija para salvar:</strong>
          <ul>{e.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </>
      )}
      {avisos.length > 0 && (
        <>
          <strong className="val-aviso">⚠️ Confira (não impede salvar):</strong>
          <ul>{avisos.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export default MensagensCampo;
