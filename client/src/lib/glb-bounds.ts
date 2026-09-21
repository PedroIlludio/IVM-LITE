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
 * A silhueta real não faz parte do padrão glTF. Por isso o importador calcula a
 * projeção dos triângulos uma única vez, antes de compactar, e a grava em
 * `scene.extras.ivmFootprintV1`. Este leitor recupera a anotação junto do mesmo
 * cabeçalho. GLBs antigos continuam devolvendo a caixa para enquadramento,
 * mas ela não deve ser usada como recorte: isso abriria o quadrado que a
 * silhueta existe justamente para evitar.
 */

/** Caixa alinhada aos eixos, no referencial do modelo como o Cesium o usa. */
export interface CaixaGlb {
  min: [number, number, number];
  max: [number, number, number];
  /** Silhuetas horizontais reais, gravadas pelo importador em `scene.extras`. */
  contornos?: Array<Array<[number, number]>>;
  /**
   * O modelo traz a iluminação GRAVADA (materiais `KHR_materials_unlit`).
   *
   * Esse tipo de exportação já contém luz, sombra de contato e oclusão nas
   * cores dos vértices. Sobre ele, a sombra dinâmica do Cesium vira uma trama
   * riscada (a malha sombreando a si mesma) e o realce de cor lava a luz que
   * veio pronta — o prédio fica opaco e quadriculado.
   */
  luzGravada?: boolean;
}

const IVM_FOOTPRINT_KEY = "ivmFootprintV1";

const MAGIC_GLTF = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

interface NoGltf {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: Record<string, unknown>;
}

interface AccessorGltf {
  min?: number[];
  max?: number[];
  componentType?: number;
  normalized?: boolean;
}

interface DocGltf {
  scene?: number;
  scenes?: { nodes?: number[]; extras?: Record<string, unknown> }[];
  nodes?: NoGltf[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  accessors?: AccessorGltf[];
  extensionsUsed?: string[];
}

// --- Georreferência do mapa 3D ----------------------------------------------

/**
 * Onde o mapa 3D diz que ele fica.
 *
 * Exportador de mapa (maps3d.io e similares) entrega a geometria em metros
 * centrada na própria origem e grava ao lado O ENDEREÇO dessa origem. Vem tudo
 * dentro do GLB, em `extras` — não depende do `georeference.json` que
 * acompanha o download, que o operador não tem como enviar pelo campo de
 * arquivo e que se perde no primeiro repasse por e-mail.
 */
export interface GeoMapaGlb {
  /** Longitude e latitude da origem do modelo, em graus. */
  lng: number;
  lat: number;
  /**
   * Cota, em metros, que corresponde a `Y = 0` na geometria.
   *
   * Sem isto o mapa assenta na altura errada: o exportador põe o zero do
   * modelo na cota MÍNIMA do recorte, que raramente é a cota do terreno do
   * empreendimento.
   */
  cotaDoZero: number;
}

/** Número finito vindo de `extras`, que é JSON de terceiro e aceita qualquer coisa. */
function numero(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Par `[lng, lat]` plausível como coordenada geográfica. */
function lngLat(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const lng = numero(v[0]);
  const lat = numero(v[1]);
  if (lng === null || lat === null) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

/**
 * Lê a georreferência do documento já decodificado.
 *
 * Duas fontes, porque os exportadores não concordam em uma só: o nó raiz
 * (`extras.originLngLat`, junto do CRS e da rotação da grade) e a cena
 * (`extras.sceneOriginGeo`). Quando as duas existem valem o mesmo ponto; a do
 * nó vem primeiro por ser a que carrega o resto do georreferenciamento.
 */
function lerGeoDoDoc(doc: DocGltf): GeoMapaGlb | null {
  let ponto: [number, number] | null = null;
  for (const no of doc.nodes ?? []) {
    ponto = lngLat((no.extras as Record<string, unknown> | undefined)?.originLngLat);
    if (ponto) break;
  }
  const cena = doc.scenes?.[doc.scene ?? 0]?.extras;
  if (!ponto) ponto = lngLat(cena?.sceneOriginGeo);
  if (!ponto) return null;

  /**
   * `altitudeBoundsinMeters.min` é a cota do ponto mais baixo do recorte, e o
   * exportador anota que é ELA que cai em `Y = 0` (`modelYZero`). Ausente, zero
   * é o palpite certo: sem outra informação, o mapa se assenta no nível do mar
   * e a diferença sobra para o controle de altura.
   */
  const cotas = cena?.altitudeBoundsinMeters as Record<string, unknown> | undefined;
  return { lng: ponto[0], lat: ponto[1], cotaDoZero: numero(cotas?.min) ?? 0 };
}

/**
 * Georreferência de um `.glb` de mapa, ou `null` se ele não trouxer nenhuma.
 *
 * Lê o mesmo cabeçalho que `medirGlb` — alguns KB de um arquivo de dezenas de
 * MB, e normalmente já em cache.
 */
export async function lerGeorreferenciaGlb(url: string): Promise<GeoMapaGlb | null> {
  const buffer = await baixarCabecalho(url);
  if (!buffer) return null;
  try {
    const doc = lerJson(buffer);
    return doc ? lerGeoDoDoc(doc) : null;
  } catch {
    return null;
  }
}

/** Aceita apenas contornos finitos e com tamanho seguro vindos do arquivo. */
function lerContornos(doc: DocGltf): Array<Array<[number, number]>> | undefined {
  const cru = doc.scenes?.[doc.scene ?? 0]?.extras?.[IVM_FOOTPRINT_KEY];
  if (!Array.isArray(cru) || cru.length > 64) return undefined;
  const contornos: Array<Array<[number, number]>> = [];
  for (const anel of cru) {
    if (!Array.isArray(anel) || anel.length < 3 || anel.length > 4096) continue;
    const pontos: Array<[number, number]> = [];
    for (const ponto of anel) {
      if (!Array.isArray(ponto) || ponto.length < 2) {
        pontos.length = 0;
        break;
      }
      const x = Number(ponto[0]);
      const y = Number(ponto[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pontos.length = 0;
        break;
      }
      pontos.push([x, y]);
    }
    if (pontos.length >= 3) contornos.push(pontos);
  }
  return contornos.length ? contornos : undefined;
}

/**
 * Converte extremos de accessors inteiros normalizados para o valor que o
 * shader realmente recebe.
 *
 * `KHR_mesh_quantization` costuma guardar POSITION como `i16_norm`. Nesse
 * caso `accessor.min/max` continuam sendo os inteiros do buffer (por exemplo
 * -32767..32767), enquanto a matriz do no foi calculada para -1..1. Aplicar a
 * matriz diretamente aos inteiros infla a caixa dezenas de milhares de vezes.
 */
function valorDoAccessor(valor: number, accessor: AccessorGltf): number {
  if (!accessor.normalized) return valor;
  switch (accessor.componentType) {
    case 5120: return Math.max(valor / 127, -1); // BYTE
    case 5121: return valor / 255; // UNSIGNED_BYTE
    case 5122: return Math.max(valor / 32767, -1); // SHORT
    case 5123: return valor / 65535; // UNSIGNED_SHORT
    case 5125: return valor / 4294967295; // UNSIGNED_INT
    default: return valor;
  }
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
    // O arquivo pode ter sido reprocessado mantendo o mesmo URL. `no-store` é
    // essencial nesse caso: reutilizar o JSON anterior faz a cena acreditar
    // que o GLB ainda não possui `ivmFootprintV1` e voltar ao recorte quadrado.
    const opcoes = { cache: "no-store" as const };
    const r1 = await fetch(url, {
      ...opcoes,
      headers: { Range: "bytes=0-19" },
    });
    if (r1.status === 206) {
      const cab = await r1.arrayBuffer();
      if (cab.byteLength >= 20) {
        const tamJson = new DataView(cab).getUint32(12, true);
        const r2 = await fetch(url, {
          ...opcoes,
          // O intervalo HTTP é inclusivo: bytes 0..19 são o cabeçalho e o
          // JSON ocupa exatamente os `tamJson` bytes seguintes.
          headers: { Range: `bytes=0-${19 + tamJson}` },
        });
        if (r2.ok) return await r2.arrayBuffer();
      }
    }
    const inteiro = await fetch(url, opcoes);
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
        const [x0, y0, z0] = acc.min.map((v) => valorDoAccessor(v, acc));
        const [x1, y1, z1] = acc.max.map((v) => valorDoAccessor(v, acc));
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

  return achou
    ? {
        min, max, contornos: lerContornos(doc),
        luzGravada: doc.extensionsUsed?.includes("KHR_materials_unlit") ?? false,
      }
    : null;
}
