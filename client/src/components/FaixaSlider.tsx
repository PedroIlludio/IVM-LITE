/**
 * Slider de faixa com dois polegares (mínimo e máximo).
 *
 * Feito com dois `<input type="range">` sobrepostos em vez de uma dependência
 * nova: é acessível pelo teclado de graça, funciona no toque e o comportamento
 * de arrasto é o nativo do sistema. O visual da trilha vem do CSS
 * `.faixa-dupla` em index.css.
 */

/**
 * Alarga a faixa até o múltiplo do passo mais próximo, para BAIXO no mínimo e
 * para CIMA no máximo.
 *
 * Um `<input type="range">` só produz valores em `min + k × passo`. Com a área
 * real do projeto indo de 29,59 a 44,05 m² e passo de 1 m², os valores
 * possíveis eram 29,59 · 30,59 · … · 43,59 — o próximo passaria de 44,05 e o
 * navegador o descarta. O polegar da direita simplesmente nunca alcançava o
 * fim da barra, e "até o máximo" deixava de fora a unidade maior de todas.
 *
 * Arredondado para 29–45, cada extremo é uma posição real do controle e todo
 * valor do projeto continua dentro. Quem chama tem de usar o MESMO passo aqui
 * e no slider, senão o desencontro volta.
 */
export function faixaNoPasso(
  faixa: [number, number] | null,
  passo: number,
): [number, number] | null {
  if (!faixa || !(passo > 0)) return faixa;
  // Poeira de ponto flutuante (0.1 + 0.2) vira valor fora da grade de novo.
  const limpo = (v: number) => Math.round(v * 1e6) / 1e6;
  return [limpo(Math.floor(faixa[0] / passo) * passo), limpo(Math.ceil(faixa[1] / passo) * passo)];
}

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
          {/*
            Trilha e trecho selecionado (atrás dos inputs), recuados meio
            polegar de cada lado: o centro do polegar nunca passa desse ponto,
            e sem o recuo o trecho pintado corria adiante dele — no máximo, a
            barra parecia cheia com o polegar ainda a alguns pixels do fim.
          */}
          <div className="pointer-events-none absolute inset-x-[7px] top-1/2 -translate-y-1/2">
            <div className="h-1 w-full rounded-full bg-[var(--v-line-2)]" />
            <div
              className="absolute top-0 h-1 rounded-full bg-[var(--v-accent)]"
              style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }}
            />
          </div>
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
