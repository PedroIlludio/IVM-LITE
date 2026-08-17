import { empreendimentos } from "./empreendimentos";
import type { Empreendimento } from "@shared/schema";
import type { CameraView, Placement, Placements } from "./placements";

/**
 * Configuração de posicionamento 3D de cada empreendimento sobre os
 * Google Photorealistic 3D Tiles (a fotogrametria estilo Google Earth).
 *
 * O modelo .glb da torre NÃO é versionado neste repositório (é pesado e fica
 * no Git LFS / object storage). Coloque o arquivo em `client/public/models/`
 * e referencie aqui em `modelUrl`. Enquanto o arquivo não existir, o
 * visualizador desenha um volume placeholder no lugar (mesma pegada/altura),
 * para a simulação solar funcionar mesmo sem o GLB final.
 */
export interface Building3DConfig {
  /** id que casa com Empreendimento.id */
  id: string;
  /** URL do GLB (ex: "/models/ikon.glb"). Ausente => usa placeholder. */
  modelUrl?: string;
  /** Rotação em torno do eixo vertical, em graus (0 = norte). */
  heading: number;
  /** Inclinação frente/trás em graus (para "deitar" o modelo se veio Z-up). */
  pitch: number;
  /** Rolagem lateral em graus. */
  roll: number;
  /** Escala aplicada ao GLB (fator; use < 1 se o modelo veio em mm/cm). */
  scale: number;
  /**
   * Altura da base em metros RELATIVA à superfície da fotogrametria
   * (0 = origem do modelo no chão). Use para afundar/levantar o modelo.
   */
  heightOffset: number;
  /** Deslocamento horizontal em metros a partir do ponto do empreendimento. */
  offsetEast: number;
  offsetNorth: number;
  /** Pegada do placeholder em metros (largura, profundidade) e altura. */
  placeholder?: { width: number; depth: number; height: number };
}

const DEFAULTS: Omit<Building3DConfig, "id"> = {
  heading: 0,
  pitch: 0,
  roll: 0,
  scale: 1,
  heightOffset: 0,
  offsetEast: 0,
  offsetNorth: 0,
  placeholder: { width: 28, depth: 28, height: 90 },
};

/**
 * Overrides por empreendimento. Comece pelo da torre (ikon) e ajuste
 * heading/escala/altura no painel — os valores que funcionarem podem ser
 * colados aqui para virarem o padrão.
 */
const OVERRIDES: Partial<Record<string, Partial<Building3DConfig>>> = {
  "quinta-das-mangueiras": {
    // Modelo otimizado (405 MB -> 23 MB, Draco + WebP) a partir de "HSM_FACHADA 2.glb".
    // bbox local ~315x37x30 (largura x profundidade x altura); a base do modelo
    // fica ~3m abaixo da origem, então heightOffset ~3 assenta a base no terreno.
    // Ajuste heading/posição no /editor (gizmos) e cole os valores finais aqui.
    modelUrl: "/models/hsm-fachada.glb",
    heading: 0,
    pitch: 0,
    roll: 0,
    scale: 1,
    heightOffset: 3,
    offsetEast: 0,
    offsetNorth: 0,
    placeholder: { width: 30, depth: 30, height: 96 },
  },
};

export interface Building3D extends Building3DConfig {
  empreendimento: Empreendimento;
  lat: number;
  lng: number;
  /** Câmera inicial salva no editor (se houver). */
  camera?: CameraView;
}

/** Só as chaves numéricas de transform que o placement pode sobrepor. */
const TRANSFORM_KEYS = [
  "heading",
  "pitch",
  "roll",
  "scale",
  "heightOffset",
  "offsetEast",
  "offsetNorth",
] as const;

/**
 * Resolve a config final de um empreendimento: DEFAULTS < OVERRIDES (código) <
 * placement (JSON salvo no editor). `placements` é opcional (experiência lê do
 * servidor; se ausente, usa só o código).
 */
export function getBuilding3D(id: string, placements?: Placements): Building3D | null {
  const emp = empreendimentos.find((e) => e.id === id);
  if (!emp) return null;
  const override = OVERRIDES[id] ?? {};
  const p: Placement = placements?.[id] ?? {};
  const merged: Building3D = {
    id,
    ...DEFAULTS,
    ...override,
    empreendimento: emp,
    lat: p.lat ?? emp.lat,
    lng: p.lng ?? emp.lng,
    camera: p.camera,
  };
  for (const k of TRANSFORM_KEYS) {
    if (typeof p[k] === "number") (merged[k] as number) = p[k] as number;
  }
  return merged;
}

/** Todos os empreendimentos resolvidos (com placements aplicados). */
export function getAllBuildings3D(placements?: Placements): Building3D[] {
  return empreendimentos
    .map((e) => getBuilding3D(e.id, placements))
    .filter((b): b is Building3D => b !== null);
}

/** Lista de empreendimentos disponíveis para o seletor do visualizador 3D. */
export function listBuildings3D(): { id: string; name: string }[] {
  return empreendimentos.map((e) => ({ id: e.id, name: e.name }));
}

/** Empreendimento inicial do visualizador. */
export const DEFAULT_BUILDING_ID =
  empreendimentos.find((e) => e.id === "quinta-das-mangueiras")?.id ??
  empreendimentos[0]?.id ??
  "";

/** Fuso de Maragogi/AL: UTC-3 (sem horário de verão). */
export const MARAGOGI_TZ_OFFSET = -3;
