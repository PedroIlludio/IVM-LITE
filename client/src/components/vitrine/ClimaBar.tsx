import type { CSSProperties } from "react";
import { Flower2, Leaf, Moon, Snowflake, Sun } from "lucide-react";
import { SEASONS, type Season, type SunReadout } from "@/lib/solar";

const ICONE: Record<Season, typeof Sun> = {
  verao: Sun,
  outono: Leaf,
  inverno: Snowflake,
  primavera: Flower2,
};

const DIA_MIN = 1439;

/**
 * Marcas do trilho, em fração do dia.
 *
 * São as três horas que orientam a leitura — nascer, meio-dia e pôr do sol
 * aproximados. Não são rótulos: quem diz a hora exata é a bolha sobre o cursor.
 * Servem para o olho medir a distância até o meio-dia sem contar pixels.
 */
const MARCAS = [6 / 24, 12 / 24, 18 / 24];

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
  const Astro = sol.isDay ? Sun : Moon;

  return (
    <section className="vd-clima vd-vidro-barra" aria-label="Controle de luz">
      <div className="vd-clima-linha">
        <span className="vd-clima-astro" data-dia={sol.isDay ? "1" : undefined} aria-hidden="true">
          <Astro />
        </span>

        {/*
          `--pos` é a fração do dia, sem unidade, para o CSS posicionar a bolha
          da hora em cima do cursor. O cursor de um `input[type=range]` não vai
          de borda a borda: ele para a meio raio de cada ponta, e é por isso que
          a conta no CSS soma metade da bolinha em vez de usar a fração pura.
        */}
        <div className="vd-clima-trilho" style={{ "--pos": minutos / DIA_MIN } as CSSProperties}>
          <span className="vd-clima-hora vd-num" aria-hidden="true">{formatarHora(minutos)}</span>

          <span className="vd-clima-rail" aria-hidden="true">
            {MARCAS.map((m) => (
              <i key={m} className="vd-clima-marca" style={{ left: `${m * 100}%` }} />
            ))}
          </span>

          <input
            type="range"
            min={0}
            max={DIA_MIN}
            step={5}
            value={minutos}
            onInput={(e) => onMinutos(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => onMinutos(Number(e.target.value))}
            className="vd-range"
            aria-label="Hora do dia"
            aria-valuetext={formatarHora(minutos)}
          />

          <span className="vd-clima-pontas vd-num" aria-hidden="true">
            <span>00:00</span>
            <span>23:59</span>
          </span>
        </div>
      </div>

      <div className="vd-clima-estacoes vd-clima-extra" role="group" aria-label="Estação do ano">
        {SEASONS.map((s) => {
          const Icone = ICONE[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onEstacao(s.id)}
              data-on={estacao === s.id ? "1" : undefined}
              className="vd-clima-estacao"
            >
              <Icone aria-hidden="true" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
