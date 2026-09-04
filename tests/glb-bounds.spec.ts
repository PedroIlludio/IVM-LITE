import { expect, test } from "@playwright/test";
import { medirGlb } from "../client/src/lib/glb-bounds";

/** GLB minimo: para esta leitura basta o chunk JSON com os metadados. */
function glbDataUrl(json: object): string {
  const texto = Buffer.from(JSON.stringify(json), "utf8");
  const tamanhoJson = Math.ceil(texto.length / 4) * 4;
  const glb = Buffer.alloc(20 + tamanhoJson, 0x20);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(tamanhoJson, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  texto.copy(glb, 20);
  return `data:application/octet-stream;base64,${glb.toString("base64")}`;
}

test("mede POSITION inteiro normalizado na escala renderizada", async () => {
  const url = glbDataUrl({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [10, 20, 30], scale: [2, 3, 4] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{
      componentType: 5122,
      normalized: true,
      type: "VEC3",
      min: [-32767, 0, -16384],
      max: [32767, 16384, 0],
    }],
  });

  const caixa = await medirGlb(url);
  expect(caixa).not.toBeNull();
  // glTF (x,y,z) -> Cesium (z,x,y), depois de normalizar e aplicar T * S.
  expect(caixa!.min[0]).toBeCloseTo(30 - (16384 / 32767) * 4, 5);
  expect(caixa!.max[0]).toBeCloseTo(30, 5);
  expect(caixa!.min[1]).toBeCloseTo(8, 5);
  expect(caixa!.max[1]).toBeCloseTo(12, 5);
  expect(caixa!.min[2]).toBeCloseTo(20, 5);
  expect(caixa!.max[2]).toBeCloseTo(20 + (16384 / 32767) * 3, 5);
});
