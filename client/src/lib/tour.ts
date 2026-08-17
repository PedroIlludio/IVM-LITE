import type { NamedView } from "./ivm-store";

/**
 * Reprodução da sequência de vistas (a "cinemática" do IVM).
 *
 * A ordem do tour é a ordem do array `sectionCameras` — sem campo de índice,
 * porque um número guardado ao lado da posição do array vira estado divergente
 * na primeira reordenação.
 *
 * O movimento em si é o `camera.flyTo` do Cesium, que já interpola posição e
 * orientação suavemente entre dois pontos. Uma sequência com duração e espera
 * controladas entrega a leitura de cinemática; trajetória livre por spline
 * (com pontos de controle, tipo Sequencer) seria outro projeto.
 */

export const DURACAO_PADRAO = 3;
export const ESPERA_PADRAO = 2;

/** O que o tour precisa da cena — mantém a lib desacoplada do Scene3D. */
export interface AlvoDoTour {
  flyToCamera: (cam: NamedView, duration?: number) => void;
  cutAtFloor: (modelZ: number | null) => void;
}

export interface TourHandle {
  parar: () => void;
}

export interface TourOpts {
  /** Chamado ao iniciar o voo para cada vista (para destacar na lista). */
  aoEntrar?: (vista: NamedView, indice: number) => void;
  /** Chamado ao terminar a última vista (não dispara quando `repetir`). */
  aoTerminar?: () => void;
  /** Recomeça do início ao chegar no fim. */
  repetir?: boolean;
}

/** Segundos totais de uma vista: voo + parada. */
export function duracaoDaVista(v: NamedView): number {
  return (v.duracao ?? DURACAO_PADRAO) + (v.espera ?? ESPERA_PADRAO);
}

/** Duração total do tour, em segundos. */
export function duracaoTotal(vistas: NamedView[]): number {
  return vistas.reduce((soma, v) => soma + duracaoDaVista(v), 0);
}

/** Formata segundos como "1m 12s" / "45s". */
export function formatDuracao(segundos: number): string {
  const s = Math.round(segundos);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Toca a sequência. Devolve um handle para interromper — sempre chame `parar()`
 * ao desmontar o componente, senão o timer continua mexendo na câmera depois
 * que a tela já mudou.
 */
export function tocarTour(
  cena: AlvoDoTour,
  vistas: NamedView[],
  opts: TourOpts = {},
): TourHandle {
  let cancelado = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let i = 0;

  const passo = () => {
    if (cancelado) return;
    if (i >= vistas.length) {
      if (opts.repetir && vistas.length) {
        i = 0;
      } else {
        opts.aoTerminar?.();
        return;
      }
    }
    const v = vistas[i];
    opts.aoEntrar?.(v, i);
    // O corte acompanha a vista: uma vista de pavimento corta o modelo ao chegar.
    cena.cutAtFloor(v.cutFloorZ ?? null);
    const duracao = v.duracao ?? DURACAO_PADRAO;
    cena.flyToCamera(v, duracao);
    timer = setTimeout(() => {
      i += 1;
      passo();
    }, duracaoDaVista(v) * 1000);
  };

  if (vistas.length) passo();
  else opts.aoTerminar?.();

  return {
    parar: () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** A vista de abertura: a marcada como principal ou, na falta, a primeira. */
export function vistaPrincipal(vistas: NamedView[]): NamedView | null {
  return vistas.find((v) => v.isMain) ?? vistas[0] ?? null;
}
