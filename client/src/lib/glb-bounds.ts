import { Matrix4, Cartesian3, Quaternion, Matrix3 } from "cesium";

/**
 * Caixa envolvente real de um `.glb`, lida sem baixar a malha.
 *
 * O Cesium só expõe `Model.boundingSphere`, e uma esfera é grosseira demais
 * para recortar o terreno: o raio embute a ALTURA do prédio, então um edifício
 * de 30 m viraria um círculo de 30 m de raio no chão.
 *
 * O glTF EXIGE que todo accessor de `POSITION` declare `min` e `max`, e isso
 * vive no chunk JSON — a caixa de cada malha está descrita ali, em texto, antes
 * de qualquer vértice. Vale inclusive para malha comprimida com Draco: a
 * compressão troca o `bufferView`, o accessor continua declarando os extremos.
 *
 * LIMITE CONHECIDO: isto dá uma CAIXA, não a silhueta. A forma real do prédio
 * não está nos metadados — num GLB agrupado por material (o caso comum de
 * exportação), cada malha atravessa o empreendimento inteiro e a união das
 * caixas devolve o mesmo retângulo. A silhueta só existe nos vértices
 * comprimidos, e decodificá-los no navegador custaria segundos e centenas de MB.
 */

/** Caixa alinhada aos eixos, no referencial do modelo como o Cesium o usa. */
export interface CaixaGlb {
  min: [number, number, number];
  max: [number, number, number];
}

const MAGIC_GLTF = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

interface NoGltf {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface DocGltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: NoGltf[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
}

/** Matriz local do nó: `matrix` explícita ou a composição T·R·S. */
function matrizDoNo(n: NoGltf): Matrix4 {
  if (n.matrix?.length === 16) {
    return Matrix4.fromColumnMajorArray(n.matrix, new Matrix4());
  }
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const rot = Matrix3.fromQuaternion(new Quaternion(r[0], r[1], r[2], r[3]), new Matrix3());
  const m = Matrix4.fromRotationTranslation(rot, new Cartesian3(t[0], t[1], t[2]), new Matrix4());
  return Matrix4.multiplyByScale(m, new Cartesian3(s[0], s[1], s[2]), m);
}

/**
 * glTF → eixos do modelo no Cesium.
 *
 * São DUAS conversões, não uma: `Y_UP_TO_Z_UP` (glTF é Y-para-cima, o Cesium é
 * Z-para-cima) e, em seguida, `Z_FORWARD_TO_X_FORWARD`. Compostas, dão
 * `(x, y, z) → (z, x, y)`.
 *
 * Fazendo só a primeira, a altura sai certa e X e Y trocados — a pegada vira a
 * silhueta pelo lado errado. Conferido contra a calibração do piloto: com esta
 * conversão os volumes das torres (x −24..−11, y 186..231) caem dentro da caixa
 * medida, e a base em Z dá −3,1, exatamente o `MODEL_BASE_Z` que a calibração
 * de pavimentos documenta.
 */
function paraEixosDoCesium(x: number, y: number, z: number): [number, number, number] {
  return [z, x, y];
}

/** Lê o chunk JSON de um GLB já em memória. */
function lerJson(buffer: ArrayBuffer): DocGltf | null {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 20 || dv.getUint32(0, true) !== MAGIC_GLTF) return null;
  let off = 12;
  while (off + 8 <= buffer.byteLength) {
    const tam = dv.getUint32(off, true);
    const tipo = dv.getUint32(off + 4, true);
    const inicio = off + 8;
    if (tipo === CHUNK_JSON) {
      if (inicio + tam > buffer.byteLength) return null;
      return JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, inicio, tam)),
      ) as DocGltf;
    }
    off = inicio + tam;
  }
  return null;
}

/**
 * Baixa só o necessário: 20 bytes dizem o tamanho do JSON e uma segunda
 * requisição traz exatamente ele. No modelo do piloto são 58 KB de 22,6 MB —
 * 0,25% do arquivo. Servidor que ignora `Range` responde com o arquivo inteiro,
 * que já está no cache do navegador porque a cena acabou de carregá-lo.
 */
async function baixarCabecalho(url: string): Promise<ArrayBuffer | null> {
  try {
    const r1 = await fetch(url, { headers: { Range: "bytes=0-19" } });
    if (r1.status === 206) {
      const cab = await r1.arrayBuffer();
      if (cab.byteLength >= 20) {
        const tamJson = new DataView(cab).getUint32(12, true);
        const r2 = await fetch(url, { headers: { Range: `bytes=0-${20 + tamJson}` } });
        if (r2.ok) return await r2.arrayBuffer();
      }
    }
    const inteiro = await fetch(url);
    return inteiro.ok ? await inteiro.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * Caixa envolvente do GLB, nos eixos do modelo. `null` quando o arquivo não é
 * legível ou nenhum accessor declara extremos — casos em que quem chama deve
 * simplesmente não recortar, em vez de inventar uma pegada.
 */
export async function medirGlb(url: string): Promise<CaixaGlb | null> {
  const buffer = await baixarCabecalho(url);
  if (!buffer) return null;
  let doc: DocGltf | null = null;
  try {
    doc = lerJson(buffer);
  } catch {
    return null; // JSON truncado por um `Range` que o servidor honrou pela metade
  }
  if (!doc?.nodes?.length) return null;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let achou = false;

  const visitar = (indice: number, pai: Matrix4, profundidade: number) => {
    // Cena com ciclo ou hierarquia absurda não pode travar a aba.
    if (profundidade > 64) return;
    const no = doc.nodes?.[indice];
    if (!no) return;
    const m = Matrix4.multiply(pai, matrizDoNo(no), new Matrix4());

    if (no.mesh != null) {
      for (const prim of doc.meshes?.[no.mesh]?.primitives ?? []) {
        const acc = doc.accessors?.[prim.attributes?.POSITION ?? -1];
        if (!acc?.min || !acc?.max) continue;
        const [x0, y0, z0] = acc.min;
        const [x1, y1, z1] = acc.max;
        // Os oito cantos, porque o nó pode girar: transformar só min e max
        // daria caixa errada em qualquer modelo com rotação na hierarquia.
        for (const cx of [x0, x1]) {
          for (const cy of [y0, y1]) {
            for (const cz of [z0, z1]) {
              const p = Matrix4.multiplyByPoint(m, new Cartesian3(cx, cy, cz), new Cartesian3());
              const e = paraEixosDoCesium(p.x, p.y, p.z);
              for (let k = 0; k < 3; k++) {
                if (e[k] < min[k]) min[k] = e[k];
                if (e[k] > max[k]) max[k] = e[k];
              }
              achou = true;
            }
          }
        }
      }
    }
    for (const filho of no.children ?? []) visitar(filho, m, profundidade + 1);
  };

  const raizes = doc.scenes?.[doc.scene ?? 0]?.nodes ?? doc.nodes.map((_, i) => i);
  for (const raiz of raizes) visitar(raiz, Matrix4.IDENTITY.clone(), 0);

  return achou ? { min, max } : null;
}
