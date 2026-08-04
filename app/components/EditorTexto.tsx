"use client";

/** Editor de texto com formatação para os campos do relatório.
 *
 * Usa uma área editável do próprio navegador com uma barra de ferramentas —
 * sem biblioteca externa, o que mantém o pacote leve e o funcionamento
 * offline (o app é PWA e roda em campo). O conteúdo sai como HTML simples
 * (negrito, itálico, sublinhado, fonte, tamanho, cor, alinhamento e listas),
 * que o gerador converte para as marcações equivalentes do Word.
 */
import { useEffect, useRef } from "react";

const FONTES = ["Arial", "Times New Roman", "Calibri", "Verdana", "Georgia", "Courier New"];
const TAMANHOS = [8, 9, 10, 11, 12, 14, 16, 18, 24];

const btn: React.CSSProperties = {
  minWidth: 30, height: 30, padding: "0 7px", borderRadius: 6, cursor: "pointer",
  border: "1px solid var(--borda)", background: "var(--bg-card)", color: "var(--texto)", fontSize: 13,
};
const sel: React.CSSProperties = { ...btn, minWidth: 0, height: 30, padding: "0 4px" };

export default function EditorTexto({ valor, onChange, altura = 120 }: {
  valor: string;
  onChange: (html: string) => void;
  altura?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Só escreve no DOM quando o valor vem de fora (carga inicial, sugestão do
  // procedimento). Reescrever a cada tecla jogaria o cursor para o início.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (valor || "")) el.innerHTML = valor || "";
  }, [valor]);

  function cmd(comando: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(comando, false, arg);
    onChange(ref.current?.innerHTML || "");
  }

  return (
    <div style={{ border: "1px solid var(--borda)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 4, padding: 6,
        borderBottom: "1px solid var(--borda)", background: "var(--bg-suave)",
      }}>
        <select style={{ ...sel, width: 118 }} defaultValue="" title="Fonte"
          onChange={(e) => { if (e.target.value) cmd("fontName", e.target.value); }}>
          <option value="">Fonte</option>
          {FONTES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select style={{ ...sel, width: 62 }} defaultValue="" title="Tamanho"
          onChange={(e) => {
            if (!e.target.value) return;
            // execCommand usa escala 1-7; aplicamos o tamanho real em seguida.
            cmd("fontSize", "7");
            const el = ref.current;
            el?.querySelectorAll('font[size="7"]').forEach((f) => {
              f.removeAttribute("size");
              (f as HTMLElement).style.fontSize = `${e.target.value}pt`;
            });
            onChange(el?.innerHTML || "");
          }}>
          <option value="">Tam.</option>
          {TAMANHOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <button type="button" style={{ ...btn, fontWeight: 800 }} title="Negrito" onClick={() => cmd("bold")}>B</button>
        <button type="button" style={{ ...btn, fontStyle: "italic" }} title="Itálico" onClick={() => cmd("italic")}>I</button>
        <button type="button" style={{ ...btn, textDecoration: "underline" }} title="Sublinhado" onClick={() => cmd("underline")}>S</button>

        <input type="color" title="Cor do texto" style={{ ...btn, width: 34, padding: 2 }}
          onChange={(e) => cmd("foreColor", e.target.value)} />

        <button type="button" style={btn} title="Alinhar à esquerda" onClick={() => cmd("justifyLeft")}>⯇</button>
        <button type="button" style={btn} title="Centralizar" onClick={() => cmd("justifyCenter")}>≡</button>
        <button type="button" style={btn} title="Justificar" onClick={() => cmd("justifyFull")}>▤</button>
        <button type="button" style={btn} title="Lista com marcadores" onClick={() => cmd("insertUnorderedList")}>• —</button>
        <button type="button" style={btn} title="Lista numerada" onClick={() => cmd("insertOrderedList")}>1.</button>
        <button type="button" style={btn} title="Limpar formatação" onClick={() => cmd("removeFormat")}>✕</button>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML || "")}
        onBlur={() => onChange(ref.current?.innerHTML || "")}
        style={{
          minHeight: altura, padding: "10px 12px", outline: "none",
          background: "var(--bg-card)", color: "var(--texto)", fontSize: 14, lineHeight: 1.5,
        }}
      />
    </div>
  );
}
