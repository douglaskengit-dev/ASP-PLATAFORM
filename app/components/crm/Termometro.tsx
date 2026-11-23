/** Escala de cores da temperatura: degradê contínuo Frio (azul) → Morno
 * (laranja) → Quente (vermelho), com o marcador no percentual atual. As cores
 * vêm dos tokens --temp-* (globals.css), com tema escuro. */
import { rotuloPct, TEMPERATURAS } from "@/lib/validacao/crm";
import s from "./crm.module.css";

/** Cor na escala contínua para um percentual (fração 0 a 1). Âncoras nos
 *  percentuais das temperaturas: 15% = cor do Frio, 50% = Morno, 85% = Quente;
 *  entre elas, mistura proporcional. */
export function corPorPct(pct: number | null): string {
  if (pct == null) return "var(--temp-sem)";
  const p = Math.max(0, Math.min(1, pct));
  if (p <= 0.15) return "var(--temp-frio)";
  if (p >= 0.85) return "var(--temp-quente)";
  if (p <= 0.5) return `color-mix(in oklab, var(--temp-morno) ${Math.round(((p - 0.15) / 0.35) * 100)}%, var(--temp-frio))`;
  return `color-mix(in oklab, var(--temp-quente) ${Math.round(((p - 0.5) / 0.35) * 100)}%, var(--temp-morno))`;
}
export const fundoPorPct = (pct: number | null) =>
  pct == null ? "var(--bg-suave)" : `color-mix(in oklab, ${corPorPct(pct)} 14%, var(--bg-card))`;

export default function Termometro({ pct, compacto = false }: { pct?: number | null; compacto?: boolean }) {
  const tem = pct != null;
  return (
    <div className={s.termometro} role="img"
      aria-label={`Escala de temperatura: Frio 15%, Morno 50%, Quente 85%${tem ? `. Atual: ${rotuloPct(pct!)}` : ""}`}>
      <div className={s.termometroBarra}>
        {tem && <span className={s.termometroMarca} style={{ left: `${Math.max(0, Math.min(1, pct!)) * 100}%`, borderTopColor: corPorPct(pct!) }} />}
      </div>
      {!compacto && (
        <div className={s.termometroRotulos}>
          {TEMPERATURAS.map((t) => (
            <span key={t.valor} style={{ left: `${t.pct * 100}%`, color: corPorPct(t.pct) }}>{t.icone} {t.rotulo} {rotuloPct(t.pct)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

