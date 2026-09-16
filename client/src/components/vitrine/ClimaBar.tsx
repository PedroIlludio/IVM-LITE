import { SEASONS, type Season, type SunReadout } from "@/lib/solar";

/** Rótulo curto da estação na pílula (Ver/Out/Inv/Pri). */
const CURTO: Record<Season, string> = {
  verao: "Ver",
  outono: "Out",
  inverno: "Inv",
  primavera: "Pri",
};

const CARDEAL: Record<string, string> = {
  N: "norte", NE: "nordeste", L: "leste", SE: "sudeste",
  S: "sul", SO: "sudoeste", O: "oeste", NO: "noroeste",
};

/** Noite para o escurecimento da cena: é a HORA que decide, não um botão. */
export const ehNoite = (minutos: number) => minutos < 340 || minutos > 1090;

export function formatarHora(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
}

/**
 * Controle fixo de luz — não é seção do menu. Aparece sempre que o 3D está na
 * tela (Home, Projeto, Unidades).
 *
 * A leitura solar vem do cálculo astronômico real (`getSunReadout`), não da
 * aproximação do protótipo.
 */
export default function ClimaBar({ minutos, onMinutos, estacao, onEstacao, sol }: {
  minutos: number;
  onMinutos: (v: number) => void;
  estacao: Season;
  onEstacao: (s: Season) => void;
  sol: SunReadout;
}) {
  const leitura = sol.isDay
    ? `${Math.round(sol.altitude)}° · ${CARDEAL[sol.compass] ?? sol.compass}`
    : "abaixo do horizonte";

  return (
    <section className="vd-clima vd-vidro-barra" aria-label="Controle de luz">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="vd-micro" style={{ color: "var(--vd-pedra)" }}>Luz</span>
        <strong className="vd-num text-[15px] font-light">{formatarHora(minutos)}</strong>
      </div>
      <input
        type="range"
        min={0}
        max={1439}
        step={5}
        value={minutos}
        onInput={(e) => onMinutos(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => onMinutos(Number(e.target.value))}
        className="vd-range min-w-[80px] flex-1"
        aria-label="Hora do dia"
        aria-valuetext={formatarHora(minutos)}
      />
      <span className="vd-clima-extra vd-micro vd-num shrink-0 whitespace-nowrap vd-bronze">{leitura}</span>
      <div className="vd-clima-extra flex shrink-0 gap-1" role="group" aria-label="Estação do ano">
        {SEASONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onEstacao(s.id)}
            data-on={estacao === s.id ? "1" : undefined}
            title={s.label}
            aria-label={s.label}
            className="vd-pilula !h-[26px] !px-2.5"
          >
            {CURTO[s.id]}
          </button>
        ))}
      </div>
    </section>
  );
}
