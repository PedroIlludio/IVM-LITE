import SunCalc from "suncalc";

export interface SunReadout {
  /** Azimute em graus no padrão bússola (0 = Norte, 90 = Leste). */
  azimuth: number;
  /** Altitude/elevação do sol em graus (negativo = abaixo do horizonte). */
  altitude: number;
  /** Rótulo de ponto cardeal aproximado (N, NE, L...). */
  compass: string;
  /** true se o sol está acima do horizonte. */
  isDay: boolean;
}

const COMPASS = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];

function compassLabel(azimuthDeg: number): string {
  const idx = Math.round(azimuthDeg / 45) % 8;
  return COMPASS[idx];
}

/**
 * Calcula posição do sol para data/local. `date` é um Date em horário ABSOLUTO
 * (UTC interno do JS) — o chamador já deve ter convertido o horário local do
 * empreendimento para o instante UTC correspondente.
 */
export function getSunReadout(date: Date, lat: number, lng: number): SunReadout {
  const pos = SunCalc.getPosition(date, lat, lng);
  // SunCalc: azimuth medido a partir do Sul, sentido horário (oeste positivo).
  // Convertendo para bússola (a partir do Norte, sentido horário).
  let azimuth = (pos.azimuth * 180) / Math.PI + 180;
  azimuth = ((azimuth % 360) + 360) % 360;
  const altitude = (pos.altitude * 180) / Math.PI;
  return {
    azimuth,
    altitude,
    compass: compassLabel(azimuth),
    isDay: altitude > 0,
  };
}

/**
 * Converte data + hora LOCAL (no fuso do empreendimento) para o instante UTC.
 * tzOffset em horas (ex: Campo Grande = -4).
 */
export function localToUtc(
  year: number,
  month0: number,
  day: number,
  hours: number,
  minutes: number,
  tzOffset: number,
): Date {
  // Instante UTC = horário local - offset. Ex: 12h local UTC-4 => 16h UTC.
  return new Date(Date.UTC(year, month0, day, hours - tzOffset, minutes));
}

/**
 * Estações do ano no hemisfério sul (Campo Grande), com uma data representativa
 * para ver a diferença da posição solar. Solstícios dão o sol mais alto/baixo.
 */
export type Season = "verao" | "outono" | "inverno" | "primavera";

export const SEASONS: { id: Season; label: string; month0: number; day: number }[] = [
  { id: "verao", label: "Verão", month0: 11, day: 21 }, // solstício de verão (~21/dez)
  { id: "outono", label: "Outono", month0: 2, day: 20 }, // equinócio (~20/mar)
  { id: "inverno", label: "Inverno", month0: 5, day: 21 }, // solstício de inverno (~21/jun)
  { id: "primavera", label: "Primavera", month0: 8, day: 22 }, // equinócio (~22/set)
];

/** Retorna [ano, mês0, dia] da data representativa de uma estação. */
export function seasonDate(season: Season, year: number): [number, number, number] {
  const s = SEASONS.find((x) => x.id === season) ?? SEASONS[0];
  return [year, s.month0, s.day];
}

/** Horário do nascer/pôr do sol (em minutos locais) para a data/local. */
export function getSunTimesLocal(
  date: Date,
  lat: number,
  lng: number,
  tzOffset: number,
): { sunriseMin: number; sunsetMin: number } {
  const times = SunCalc.getTimes(date, lat, lng);
  const toLocalMin = (d: Date) => {
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    return (((utcMin + tzOffset * 60) % 1440) + 1440) % 1440;
  };
  return {
    sunriseMin: toLocalMin(times.sunrise),
    sunsetMin: toLocalMin(times.sunset),
  };
}
