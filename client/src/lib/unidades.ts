import type { Torre, Unidade, UnidadeStatus } from "@shared/schema";

export type { Torre, Unidade, UnidadeStatus };

export interface UnidadesData {
  total: number;
  observacao?: string;
  unidades: Unidade[];
}

/** Rótulos e cores da legenda de disponibilidade (calibradas para o 3D). */
export const STATUS_META: Record<UnidadeStatus, { label: string; cor: string; corSoft: string }> = {
  disponivel: { label: "Disponível", cor: "#22c55e", corSoft: "rgba(34,197,94,0.18)" },
  reservada: { label: "Reservada", cor: "#eab308", corSoft: "rgba(234,179,8,0.18)" },
  vendida: { label: "Vendida", cor: "#ef4444", corSoft: "rgba(239,68,68,0.16)" },
};

/**
 * As mesmas cores na paleta CLARA da vitrine.
 *
 * As de `STATUS_META` são feitas para as caixas do espelho 3D sobre a cena
 * escura — saturadas de propósito, para se lerem a cem metros de distância.
 * Sobre um painel branco elas ficam neon e estragam a sobriedade, então a
 * vitrine usa versões mais fechadas, com a cor no texto e no ponto em vez de
 * num bloco chapado.
 */
export const STATUS_CLARO: Record<UnidadeStatus, string> = {
  disponivel: "#15925f",
  reservada: "#b47d09",
  vendida: "#c0453b",
};
export const STATUS_CLARO_FUNDO: Record<UnidadeStatus, string> = {
  disponivel: "rgba(21,146,95,.10)",
  reservada: "rgba(180,125,9,.12)",
  vendida: "rgba(192,69,59,.10)",
};

/**
 * Volume da torre no espaço do modelo (metros), usado para desenhar o espelho
 * de vendas em 3D. O GLB é uma fachada sem geometria por unidade, então as
 * unidades de cada andar são fatiadas ao longo de `largura` dentro desta caixa.
 *
 * Atenção aos eixos: são os do modelo JÁ CONVERTIDO pelo Cesium (Z para cima),
 * não os do arquivo glTF. O Cesium aplica `Y_UP_TO_Z_UP × Z_UP_TO_X_UP`, ou
 * seja: X do modelo = Z do glTF, Y do modelo = X do glTF, Z do modelo = Y do
 * glTF. Como cada GLB tem a sua própria orientação, estes valores se calibram
 * no editor, olhando o preview — não há como acertá-los no chute.
 */
export interface TorreVolume {
  /** Centro da torre nos eixos X/Y do modelo. */
  x: number;
  y: number;
  /** Base do bloco (Z do modelo). Ausente = usa a base dos pavimentos. */
  z?: number;
  /** Comprimento: é ao longo dele que as unidades de cada andar se distribuem. */
  comprimento: number;
  /** Largura do bloco (a face perpendicular ao comprimento). */
  largura: number;
  /** Altura total do bloco. Ausente = nº de pavimentos × altura do nível. */
  altura?: number;
  /** Direção do comprimento, em graus a partir do eixo X do modelo. */
  rot?: number;
  /** Inclinação do bloco nos outros dois eixos (graus). Compostos Rz · Ry · Rx. */
  rotX?: number;
  rotY?: number;
}

/** Torre de um projeto (id livre + rótulo de exibição). */
export interface TorreDef {
  id: string;
  label: string;
  volume?: TorreVolume;
}

/** Rótulos das torres do piloto Quinta (fallback quando o projeto não define). */
export const TORRE_LABEL: Record<string, string> = {
  ocean: "Ocean",
  sea: "Sea",
  river: "River",
};

/** Rótulo de uma torre: usa as torres do projeto, senão o fallback, senão o id. */
export function torreLabel(id: Torre, torres?: TorreDef[]): string {
  return torres?.find((t) => t.id === id)?.label ?? TORRE_LABEL[id] ?? id;
}

/**
 * Torres a exibir: as declaradas no projeto ou, na falta, as deduzidas das
 * próprias unidades (preservando a ordem de aparição).
 */
export function torresDe(unidades: Unidade[], torres?: TorreDef[]): TorreDef[] {
  if (torres?.length) return torres;
  const out: TorreDef[] = [];
  for (const u of unidades) {
    if (!out.some((t) => t.id === u.torre)) out.push({ id: u.torre, label: torreLabel(u.torre) });
  }
  return out;
}

export async function loadUnidades(): Promise<Unidade[]> {
  try {
    const r = await fetch("/api/unidades");
    if (!r.ok) return [];
    const d = (await r.json()) as UnidadesData;
    return d.unidades ?? [];
  } catch {
    return [];
  }
}

/** Conta unidades por status (opcionalmente filtrando por torre). */
export function contarStatus(unidades: Unidade[], torre?: Torre): Record<UnidadeStatus, number> {
  const acc: Record<UnidadeStatus, number> = { disponivel: 0, reservada: 0, vendida: 0 };
  for (const u of unidades) {
    if (torre && u.torre !== torre) continue;
    acc[u.status]++;
  }
  return acc;
}

/** Pavimentos existentes (desc) e as unidades de cada, para uma torre. */
export function porPavimento(unidades: Unidade[], torre: Torre): { pavimento: number; unidades: Unidade[] }[] {
  const map = new Map<number, Unidade[]>();
  for (const u of unidades) {
    if (u.torre !== torre) continue;
    (map.get(u.pavimento) ?? map.set(u.pavimento, []).get(u.pavimento)!).push(u);
  }
  // Array.from em vez de espalhar o iterador: sem downlevelIteration no
  // tsconfig, o spread de MapIterator não compila.
  return Array.from(map.entries())
    .sort((a, b) => b[0] - a[0]) // rooftop em cima
    .map(([pavimento, us]) => ({
      pavimento,
      unidades: us.sort((x: Unidade, y: Unidade) => x.numero.localeCompare(y.numero)),
    }));
}
