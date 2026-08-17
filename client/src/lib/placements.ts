/**
 * Posicionamentos editáveis dos empreendimentos 3D, persistidos em JSON no
 * servidor (via /api/vision3d/placements). Sobrepõem os defaults de
 * vision3d-config.ts. O editor (/editor) grava aqui; a experiência normal só lê.
 */

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

export async function loadPlacements(): Promise<Placements> {
  try {
    const r = await fetch("/api/vision3d/placements");
    if (!r.ok) return {};
    return (await r.json()) as Placements;
  } catch {
    return {};
  }
}

export async function savePlacements(p: Placements): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/vision3d/placements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      return { ok: false, error: body.error || `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha de rede" };
  }
}
