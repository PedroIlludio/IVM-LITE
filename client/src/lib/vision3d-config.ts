import type { Empreendimento } from "@shared/schema";
import type { CameraView } from "./placements";

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

export interface Building3D extends Building3DConfig {
  empreendimento: Empreendimento;
  lat: number;
  lng: number;
  /** Câmera inicial salva no editor (se houver). */
  camera?: CameraView;
}

