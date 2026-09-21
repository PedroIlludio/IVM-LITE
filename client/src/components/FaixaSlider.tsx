/**
 * Slider de faixa com dois polegares (mínimo e máximo).
 *
 * Feito com dois `<input type="range">` sobrepostos em vez de uma dependência
 * nova: é acessível pelo teclado de graça, funciona no toque e o comportamento
 * de arrasto é o nativo do sistema. O visual da trilha vem do CSS
 * `.faixa-dupla` em index.css.
 */

interface FaixaSliderProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  /** [mínimo, máximo] selecionados. */
  value: [number, number];
  onChange: (v: [number, number]) => void;
  /** Como escrever os números na etiqueta (ex.: "48 m²", "R$ 450 mil"). */
  format?: (v: number) => string;
}

export default function FaixaSlider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  format = (v) => String(v),
}: FaixaSliderProps) {
  const [lo, hi] = value;
  // Faixa degenerada (um único valor possível): mostra o valor e não o slider.
  const vazio = max <= min;
  const pct = (v: number) => (vazio ? 0 : ((v - min) / (max - min)) * 100);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-[var(--v-ink-2)]">{label}</span>
        <span className="v-num text-[12.5px] font-semibold text-[var(--v-ink)]">
          {vazio ? format(min) : `${format(lo)} – ${format(hi)}`}
        </span>
      </div>

      {vazio ? (
        <div className="h-1 rounded bg-[var(--v-line-2)]" />
      ) : (
        <div className="faixa-dupla">
          {/* Trilha e trecho selecionado (atrás dos inputs). */}
          <div className="pointer-events-none absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-[var(--v-line-2)]" />
          <div
            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--v-accent)]"
            style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }}
          />
          <input
            type="range"
            aria-label={`${label} — mínimo`}
            min={min}
            max={max}
            step={step}
            value={lo}
            // Um polegar nunca ultrapassa o outro: os valores se limitam entre si.
            onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          />
          <input
            type="range"
            aria-label={`${label} — máximo`}
            min={min}
            max={max}
            step={step}
            value={hi}
            onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          />
        </div>
      )}
    </div>
  );
}
