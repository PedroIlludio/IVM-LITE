/**
 * Bússola: fita de pontos cardeais no topo da tela, que gira com a câmera.
 *
 * Mostra a faixa visível ao redor do heading atual em vez de um disco giratório —
 * é mais legível numa tela larga e ocupa menos espaço vertical. Clicar reorienta
 * a câmera para o norte.
 */

const PONTOS = [
  { deg: 0, label: "N" },
  { deg: 45, label: "NE" },
  { deg: 90, label: "E" },
  { deg: 135, label: "SE" },
  { deg: 180, label: "S" },
  { deg: 225, label: "SO" },
  { deg: 270, label: "O" },
  { deg: 315, label: "NO" },
];

/** Metade da abertura visível, em graus. */
const CAMPO = 60;

interface BussolaProps {
  /** Heading da câmera em graus (0 = norte). */
  heading: number;
  /** Clique na bússola — normalmente reorienta para o norte. */
  onClick?: () => void;
}

export default function Bussola({ heading, onClick }: BussolaProps) {
  const h = ((heading % 360) + 360) % 360;

  return (
    <button
      onClick={onClick}
      title="Orientação — clique para apontar ao norte"
      className="pointer-events-auto absolute left-1/2 top-4 z-30 h-8 w-[min(28rem,60vw)] -translate-x-1/2 overflow-hidden"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)",
      }}
    >
      {/* Marcador do centro (para onde a câmera olha) */}
      <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[8px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">▼</span>

      {PONTOS.map((p) => {
        // Distância angular com sinal, normalizada para -180..180.
        let d = p.deg - h;
        d = ((((d + 180) % 360) + 360) % 360) - 180;
        if (Math.abs(d) > CAMPO) return null;
        const x = 50 + (d / CAMPO) * 50; // % da largura
        const cardeal = p.label.length === 1;
        return (
          <span
            key={p.deg}
            className={`absolute top-2.5 -translate-x-1/2 tracking-[0.2em] ${
              cardeal
                ? "text-[11px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.55)]"
                : "text-[9px] text-white/70 drop-shadow-[0_1px_3px_rgba(0,0,0,.5)]"
            }`}
            style={{ left: `${x}%`, opacity: 1 - Math.abs(d) / (CAMPO * 1.4) }}
          >
            {p.label}
          </span>
        );
      })}
    </button>
  );
}
