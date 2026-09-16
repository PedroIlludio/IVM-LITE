/**
 * Alarga a faixa até o múltiplo do passo mais próximo (para baixo no mínimo,
 * para cima no máximo). Um `<input type="range">` só produz `min + k × passo`:
 * sem isto o polegar nunca alcançava o fim e a maior unidade ficava de fora.
 * Quem chama usa o MESMO passo aqui e no slider.
 */
export function faixaNoPasso(
  faixa: [number, number] | null,
  passo: number,
): [number, number] | null {
  if (!faixa || !(passo > 0)) return faixa;
  const limpo = (v: number) => Math.round(v * 1e6) / 1e6;
  return [limpo(Math.floor(faixa[0] / passo) * passo), limpo(Math.ceil(faixa[1] / passo) * passo)];
}

/**
 * Slider de faixa com dois polegares, no visual de vidro: trilha de 2px,
 * trecho escolhido em bronze. Dois ranges nativos sobrepostos (ver
 * `.faixa-dupla` em index.css) — teclado e toque de graça.
 */
export default function FaixaVidro({
  label, min, max, step = 1, value, onChange, format = (v) => String(v),
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  format?: (v: number) => string;
}) {
  const [lo, hi] = value;
  const vazio = max <= min;
  const pct = (v: number) => (vazio ? 0 : ((v - min) / (max - min)) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="vd-micro vd-3">{label}</span>
        <span className="vd-num text-[11px] vd-2">
          {vazio ? format(min) : `${format(lo)} – ${format(hi)}`}
        </span>
      </div>
      {!vazio && (
        <div className="faixa-dupla vd-faixa">
          <div className="pointer-events-none absolute inset-x-[6px] top-1/2 -translate-y-1/2">
            <div className="h-[2px] w-full rounded-full bg-white/25" />
            <div className="absolute top-0 h-[2px] rounded-full bg-[var(--vd-bronze)]"
              style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }} />
          </div>
          <input type="range" aria-label={`${label} — mínimo`} min={min} max={max} step={step} value={lo}
            onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])} />
          <input type="range" aria-label={`${label} — máximo`} min={min} max={max} step={step} value={hi}
            onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])} />
        </div>
      )}
    </div>
  );
}
