import { type Document, Primitive, type TypedArray } from "@gltf-transform/core";

/** Chave gravada em `scene.extras` e lida pelo cliente sem decodificar o GLB. */
export const IVM_FOOTPRINT_KEY = "ivmFootprintV1";

export type PontoPegada = [number, number];
export type ContornoPegada = PontoPegada[];

interface PontoTela {
  x: number;
  y: number;
}

/** Aplica uma matriz glTF column-major e devolve os eixos horizontais do Cesium. */
function projetar(
  a: TypedArray,
  i: number,
  m: readonly number[],
): PontoTela {
  const x = Number(a[i * 3]);
  const y = Number(a[i * 3 + 1]);
  const z = Number(a[i * 3 + 2]);
  const mundoX = m[0] * x + m[4] * y + m[8] * z + m[12];
  const mundoZ = m[2] * x + m[6] * y + m[10] * z + m[14];
  // Mesma conversão de `glb-bounds.ts`: (x, y, z) -> (z, x, y).
  return { x: mundoZ, y: mundoX };
}

function dentroDoTriangulo(
  px: number,
  py: number,
  a: PontoTela,
  b: PontoTela,
  c: PontoTela,
): boolean {
  const ab = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const bc = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
  const ca = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
  return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
}

function dilatar(origem: Uint8Array, colunas: number, linhas: number): Uint8Array {
  const saida = origem.slice();
  for (let y = 0; y < linhas; y++) {
    for (let x = 0; x < colunas; x++) {
      if (!origem[y * colunas + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < colunas && ny >= 0 && ny < linhas) {
            saida[ny * colunas + nx] = 1;
          }
        }
      }
    }
  }
  return saida;
}

/** Preenche vazios internos; só o contorno externo interessa ao corte do terreno. */
function preencherBuracos(celulas: Uint8Array, colunas: number, linhas: number): void {
  const fora = new Uint8Array(celulas.length);
  const fila = new Int32Array(celulas.length);
  let inicio = 0;
  let fim = 0;
  const entrar = (x: number, y: number) => {
    if (x < 0 || x >= colunas || y < 0 || y >= linhas) return;
    const i = y * colunas + x;
    if (celulas[i] || fora[i]) return;
    fora[i] = 1;
    fila[fim++] = i;
  };
  for (let x = 0; x < colunas; x++) {
    entrar(x, 0);
    entrar(x, linhas - 1);
  }
  for (let y = 0; y < linhas; y++) {
    entrar(0, y);
    entrar(colunas - 1, y);
  }
  while (inicio < fim) {
    const i = fila[inicio++];
    const x = i % colunas;
    const y = Math.floor(i / colunas);
    entrar(x - 1, y);
    entrar(x + 1, y);
    entrar(x, y - 1);
    entrar(x, y + 1);
  }
  for (let i = 0; i < celulas.length; i++) {
    if (!celulas[i] && !fora[i]) celulas[i] = 1;
  }
}

function chave(x: number, y: number): string {
  return `${x},${y}`;
}

/** Extrai os anéis externos da união das células ocupadas. */
function contornosDaGrade(celulas: Uint8Array, colunas: number, linhas: number): PontoTela[][] {
  const proximos = new Map<string, PontoTela[]>();
  const adicionar = (ax: number, ay: number, bx: number, by: number) => {
    const k = chave(ax, ay);
    const lista = proximos.get(k) ?? [];
    lista.push({ x: bx, y: by });
    proximos.set(k, lista);
  };
  const tem = (x: number, y: number) =>
    x >= 0 && x < colunas && y >= 0 && y < linhas && !!celulas[y * colunas + x];

  for (let y = 0; y < linhas; y++) {
    for (let x = 0; x < colunas; x++) {
      if (!tem(x, y)) continue;
      if (!tem(x, y - 1)) adicionar(x, y, x + 1, y);
      if (!tem(x + 1, y)) adicionar(x + 1, y, x + 1, y + 1);
      if (!tem(x, y + 1)) adicionar(x + 1, y + 1, x, y + 1);
      if (!tem(x - 1, y)) adicionar(x, y + 1, x, y);
    }
  }

  const aneis: PontoTela[][] = [];
  while (proximos.size) {
    const [primeiraChave, destinos] = proximos.entries().next().value as [string, PontoTela[]];
    const [sx, sy] = primeiraChave.split(",").map(Number);
    const inicio = { x: sx, y: sy };
    const anel: PontoTela[] = [inicio];
    let atual = inicio;
    let guarda = 0;
    do {
      const k = chave(atual.x, atual.y);
      const lista = proximos.get(k);
      if (!lista?.length) break;
      const proximo = lista.shift()!;
      if (!lista.length) proximos.delete(k);
      atual = proximo;
      if (atual.x !== inicio.x || atual.y !== inicio.y) anel.push(atual);
      guarda++;
    } while ((atual.x !== inicio.x || atual.y !== inicio.y) && guarda < celulas.length * 4);

    if (atual.x === inicio.x && atual.y === inicio.y && anel.length >= 4) {
      let area2 = 0;
      for (let i = 0; i < anel.length; i++) {
        const a = anel[i];
        const b = anel[(i + 1) % anel.length];
        area2 += a.x * b.y - b.x * a.y;
      }
      // As bordas externas, na orientação construída acima, têm área positiva.
      if (area2 > 0) aneis.push(anel);
    }
  }
  return aneis;
}

function distanciaSegmento(p: PontoTela, a: PontoTela, b: PontoTela): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdp(linha: PontoTela[], epsilon: number): PontoTela[] {
  if (linha.length <= 2) return linha;
  let maior = 0;
  let indice = 0;
  for (let i = 1; i < linha.length - 1; i++) {
    const d = distanciaSegmento(linha[i], linha[0], linha[linha.length - 1]);
    if (d > maior) {
      maior = d;
      indice = i;
    }
  }
  if (maior <= epsilon) return [linha[0], linha[linha.length - 1]];
  const a = rdp(linha.slice(0, indice + 1), epsilon);
  const b = rdp(linha.slice(indice), epsilon);
  return [...a.slice(0, -1), ...b];
}

function simplificarAnel(anel: PontoTela[], epsilon: number): PontoTela[] {
  if (anel.length < 5) return anel;
  let oposto = 1;
  let maior = 0;
  for (let i = 1; i < anel.length; i++) {
    const d = Math.hypot(anel[i].x - anel[0].x, anel[i].y - anel[0].y);
    if (d > maior) {
      maior = d;
      oposto = i;
    }
  }
  const metadeA = rdp(anel.slice(0, oposto + 1), epsilon);
  const metadeB = rdp([...anel.slice(oposto), anel[0]], epsilon);
  return [...metadeA.slice(0, -1), ...metadeB.slice(0, -1)];
}

/**
 * Calcula a silhueta horizontal da geometria real e devolve contornos em metros
 * no referencial usado pelo Cesium. O raster é proposital: une milhões de
 * triângulos num anel pequeno e aceita naturalmente plantas côncavas.
 */
export function calcularPegadaGlb(doc: Document): ContornoPegada[] {
  const cena = doc.getRoot().listScenes()[0];
  if (!cena) return [];

  const itens: Array<{ matriz: readonly number[]; primitivas: Primitive[] }> = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  cena.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matriz = node.getWorldMatrix();
    const primitivas = mesh.listPrimitives();
    itens.push({ matriz, primitivas });
    for (const prim of primitivas) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const lo = pos.getMin([]);
      const hi = pos.getMax([]);
      for (const x of [lo[0], hi[0]]) {
        for (const y of [lo[1], hi[1]]) {
          for (const z of [lo[2], hi[2]]) {
            const p = projetar(new Float64Array([x, y, z]), 0, matriz);
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
      }
    }
  });
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return [];

  const maiorLado = Math.max(maxX - minX, maxY - minY);
  const passo = Math.max(0.2, maiorLado / 512);
  const margem = passo * 3;
  minX -= margem;
  minY -= margem;
  maxX += margem;
  maxY += margem;
  const colunas = Math.ceil((maxX - minX) / passo);
  const linhas = Math.ceil((maxY - minY) / passo);
  const celulas = new Uint8Array(colunas * linhas);

  for (const { matriz, primitivas } of itens) {
    for (const prim of primitivas) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      const indices = prim.getIndices()?.getArray();
      const quantidade = indices?.length ?? pos.length / 3;
      for (let i = 0; i + 2 < quantidade; i += 3) {
        const ia = indices ? Number(indices[i]) : i;
        const ib = indices ? Number(indices[i + 1]) : i + 1;
        const ic = indices ? Number(indices[i + 2]) : i + 2;
        const a = projetar(pos, ia, matriz);
        const b = projetar(pos, ib, matriz);
        const c = projetar(pos, ic, matriz);
        const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
        // Fachadas verticais viram linhas na projeção e não são uma pegada.
        if (area2 < passo * passo * 0.02) continue;
        const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / passo));
        const x1 = Math.min(colunas - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / passo));
        const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - minY) / passo));
        const y1 = Math.min(linhas - 1, Math.floor((Math.max(a.y, b.y, c.y) - minY) / passo));
        for (let y = y0; y <= y1; y++) {
          const py = minY + (y + 0.5) * passo;
          for (let x = x0; x <= x1; x++) {
            const px = minX + (x + 0.5) * passo;
            if (dentroDoTriangulo(px, py, a, b, c)) celulas[y * colunas + x] = 1;
          }
        }
      }
    }
  }

  const unidas = dilatar(celulas, colunas, linhas);
  preencherBuracos(unidas, colunas, linhas);
  const aneis = contornosDaGrade(unidas, colunas, linhas);
  const areaMinima = 4; // descarta só fragmentos menores que quatro células
  return aneis
    .filter((anel) => {
      let area2 = 0;
      for (let i = 0; i < anel.length; i++) {
        const a = anel[i];
        const b = anel[(i + 1) % anel.length];
        area2 += a.x * b.y - b.x * a.y;
      }
      return area2 / 2 >= areaMinima;
    })
    .map((anel) => simplificarAnel(anel, 1.25).map((p) => [
      Number((minX + p.x * passo).toFixed(3)),
      Number((minY + p.y * passo).toFixed(3)),
    ] as PontoPegada))
    .filter((anel) => anel.length >= 3);
}

/** Calcula e grava a pegada na cena principal do GLB. */
export function anotarPegadaGlb(doc: Document): ContornoPegada[] {
  const cena = doc.getRoot().listScenes()[0];
  if (!cena) return [];
  const contornos = calcularPegadaGlb(doc);
  if (contornos.length) {
    cena.setExtras({ ...cena.getExtras(), [IVM_FOOTPRINT_KEY]: contornos });
  }
  return contornos;
}
