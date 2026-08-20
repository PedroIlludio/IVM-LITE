import type { Empreendimento } from "@shared/schema";
import type { CameraView, Placement } from "./placements";

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

/**
 * Mini mapa: o GLB de terreno/entorno que compõe a cena SEM fotogrametria.
 *
 * Desligar a cidade 3D deixa o prédio flutuando sobre um cinza chapado. Isso é
 * leitura de maquete e serve ao aparelho fraco, mas custa toda a informação de
 * implantação: para onde a fachada olha, o que faz esquina, como o terreno cai.
 * O mini mapa devolve isso por um caminho barato — uma quadra modelada à mão
 * pesa uma fração do que o streaming do Google consome, e não depende de rede
 * nem de chave de API.
 *
 * Por que transformação própria e não a do prédio: são dois GLBs de origens
 * diferentes, quase nunca exportados no mesmo referencial. Amarrar os dois na
 * mesma matriz obrigaria a reexportar um deles para encaixar no outro.
 *
 * Sem `pitch`/`roll`: uma base de implantação se assenta no plano do terreno.
 * Se ela precisa ser inclinada, o que está errado é o eixo da exportação — e
 * corrigir isso com sliders esconde o problema em vez de resolvê-lo.
 */
export interface MapaBase {
  url: string;
  /** Rotação em torno do eixo vertical, em graus (0 = norte). */
  heading: number;
  scale: number;
  /** Altura da base em metros, relativa ao solo medido sob o empreendimento. */
  heightOffset: number;
  offsetEast: number;
  offsetNorth: number;
  /** Âncora geográfica — a mesma do empreendimento. */
  lat: number;
  lng: number;
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
