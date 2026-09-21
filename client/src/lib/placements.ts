/** Tipos de posicionamento/câmera 3D (os valores vivem na config do projeto). */

/** Câmera inicial ao selecionar um empreendimento. */
export interface CameraView {
  lng: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

/** Override por empreendimento (tudo opcional; só o que foi editado). */
export interface Placement {
  /** Posição base (se movido no editor). */
  lat?: number;
  lng?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  scale?: number;
  heightOffset?: number;
  offsetEast?: number;
  offsetNorth?: number;
  camera?: CameraView;
}

export type Placements = Record<string, Placement>;
