import { Sunrise, Sun, Sunset } from "lucide-react";
import type { CSSProperties } from "react";
import { SEASONS, type Season, type SunReadout } from "@/lib/solar";

interface SolarBarProps {
  timeMinutes: number;
  onTimeChange: (v: number) => void;
  season: Season;
  onSeasonChange: (s: Season) => void;
  sun: SunReadout;
  sunriseMin?: number;
  sunsetMin?: number;
}

const MIN = 0;
const MAX = 24 * 60 - 1;

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function SolarBar({
  timeMinutes,
  onTimeChange,
  season,
  onSeasonChange,
  sun,
  sunriseMin = 6 * 60,
  sunsetMin = 18 * 60,
}: SolarBarProps) {
  const duracaoDia = Math.max(1, sunsetMin - sunriseMin);
  const progresso = Math.max(0, Math.min(1, (timeMinutes - sunriseMin) / duracaoDia));
  // A altura visual acompanha a elevacao astronomica, em vez de inventar um
  // meio-dia fixo. O limite apenas mantem o icone dentro do controle.
  const arco = Math.max(0, Math.min(1, sun.altitude / 75));

  return (
    <section
      className="v-solar pointer-events-auto absolute bottom-5 left-1/2 z-20 w-[640px] max-w-[calc(100vw-2rem)] -translate-x-1/2"
      style={{
        "--solar-x": `${3 + progresso * 94}%`,
        "--solar-y": `${2 + arco * 25}px`,
      } as CSSProperties}
      aria-label="Controle de iluminação solar"
    >
      <div className="v-solar-head">
        <div>
          <span className="v-eyebrow">Luz natural</span>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="v-solar-time v-num">{fmt(timeMinutes)}</strong>
            <span className="v-meta">
              {sun.isDay ? `${sun.altitude.toFixed(0)}° de altura · ${sun.compass}` : "abaixo do horizonte"}
            </span>
          </div>
        </div>
        <div className="v-solar-seasons" aria-label="Estação do ano">
          {SEASONS.map((s) => (
            <button key={s.id} onClick={() => onSeasonChange(s.id)} data-on={season === s.id ? "1" : undefined}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="v-solar-orbit" aria-hidden="true">
        <Sunrise className="v-solar-edge left-0" />
        <span className="v-solar-arc" />
        <span className="v-solar-sun" data-day={sun.isDay ? "1" : undefined}>
          <Sun />
        </span>
        <Sunset className="v-solar-edge right-0" />
      </div>

      <input
        type="range"
        min={MIN}
        max={MAX}
        step={5}
        value={timeMinutes}
        onChange={(e) => onTimeChange(Number(e.target.value))}
        className="v-solar-range"
        aria-label="Hora do dia"
      />
      <div className="v-solar-hours">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:59</span>
      </div>
    </section>
  );
}
