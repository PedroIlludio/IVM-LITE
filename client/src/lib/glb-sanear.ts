/**
 * Conserta, no envio, o defeito de exportação que faz o Cesium parar de
 * renderizar.
 *
 * O caso real: um GLB exportado da Unreal em que doze materiais declaram
 * `baseColorTexture.texCoord = 3` — o canal de UV número 3 — enquanto a malha
 * exporta um canal só, o `TEXCOORD_0`. O Cesium monta o shader pedindo a
 * varying `v_texCoord_3`, ela não existe, a compilação falha e o laço de render
 * PARA. A vitrine inteira morre por causa de um índice.
 *
 * É um erro do exportador, não do modelador: na Unreal o UV 3 costuma ser o
 * canal de lightmap, e o exportador renumera os canais sem reescrever as
 * referências dos materiais. Quem exportou não tem como ver isso em lugar
 * nenhum — o arquivo abre normalmente em quase todo visualizador, porque a
 * maioria ignora o índice em silêncio e usa o UV 0.
 *
 * Por que consertar aqui e não pedir a reexportação: "reexporte com os canais
 * de UV corrigidos" é uma instrução que exige entender glTF para executar, e
 * a informação necessária para o conserto já está toda no arquivo. Quando a
 * malha traz UM canal de UV, não há ambiguidade sobre qual as texturas deviam
 * usar.
 *
 * O que este módulo NÃO faz: inventar coordenadas. Se a malha não tiver
 * nenhum canal de UV, a textura é removida daquela primitiva — sem UV não há
 * como aplicá-la, e ficar sem textura é melhor que ficar sem cena.
 */

const MAGIC_GLTF = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

interface RefTextura {
  index?: number;
  texCoord?: number;
  extensions?: { KHR_texture_transform?: { texCoord?: number } };
}

/**
 * Material glTF.
 *
 * Deliberadamente frouxo: as referências de textura são procuradas por
 * VARREDURA, não por lista de campos — ver `slotsDeTextura`.
 */
interface MaterialGltf {
  name?: string;
  [chave: string]: unknown;
}

interface PrimitivaGltf {
  attributes?: Record<string, number>;
  material?: number;
}

interface DocGltf {
  meshes?: { primitives?: PrimitivaGltf[] }[];
  materials?: MaterialGltf[];
}

export interface ResultadoSaneamento {
  /** O arquivo a enviar: o corrigido, ou o próprio original se nada mudou. */
  arquivo: File;
  /** Uma linha por conserto, em português, para mostrar a quem enviou. */
  correcoes: string[];
}

/** Nome em português dos slots conhecidos; o resto usa a chave crua. */
const ROTULO_SLOT: Record<string, string> = {
  baseColorTexture: "cor base",
  metallicRoughnessTexture: "metalicidade/rugosidade",
  normalTexture: "normal",
  occlusionTexture: "oclusão",
  emissiveTexture: "emissivo",
  specularTexture: "especular",
  specularColorTexture: "cor especular",
  clearcoatTexture: "verniz",
  clearcoatRoughnessTexture: "rugosidade do verniz",
  clearcoatNormalTexture: "normal do verniz",
  sheenColorTexture: "brilho de tecido",
  sheenRoughnessTexture: "rugosidade do tecido",
  transmissionTexture: "transmissão",
  thicknessTexture: "espessura",
  iridescenceTexture: "iridescência",
  anisotropyTexture: "anisotropia",
};

/** Uma referência de textura encontrada, e onde ela mora (para poder sumir). */
interface SlotTextura {
  nome: string;
  ref: RefTextura;
  dono: Record<string, unknown>;
  chave: string;
}

/**
 * Toda referência de textura do material, INCLUSIVE dentro de `extensions`.
 *
 * A primeira versão listava os cinco slots do núcleo à mão, e foi por isso que
 * um arquivo continuou quebrando depois de saneado: `KHR_materials_specular`
 * traz a própria `specularTexture`, com o próprio `texCoord`, e ela ficou de
 * fora da lista. Uma referência esquecida basta — o shader não compila e a
 * cena inteira para.
 *
 * A regra da varredura vem da própria especificação: no glTF toda referência
 * de textura é um objeto `{ index, texCoord? }` guardado sob uma chave
 * terminada em "Texture". Vale para o núcleo e para toda extensão, inclusive
 * as que ainda não existem — que é o ponto de não ter uma lista.
 */
function slotsDeTextura(m: MaterialGltf): SlotTextura[] {
  const achados: SlotTextura[] = [];
  const visitar = (obj: Record<string, unknown>) => {
    for (const [chave, valor] of Object.entries(obj)) {
      if (!valor || typeof valor !== "object") continue;
      const filho = valor as Record<string, unknown>;
      if (/texture$/i.test(chave) && typeof filho.index === "number") {
        achados.push({
          nome: ROTULO_SLOT[chave] ?? chave,
          ref: filho as RefTextura,
          dono: obj,
          chave,
        });
        // Não desce: o que houver dentro (KHR_texture_transform) já é lido por
        // `canalPedido` e escrito por `definirCanal`.
        continue;
      }
      visitar(filho);
    }
  };
  visitar(m as Record<string, unknown>);
  return achados;
}

/** Índices de canal de UV presentes numa primitiva, em ordem. */
function canaisDaPrimitiva(pr: PrimitivaGltf): number[] {
  return Object.keys(pr.attributes ?? {})
    .map((k) => /^TEXCOORD_(\d+)$/.exec(k)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/** O `texCoord` efetivo de uma referência (o do transform tem prioridade). */
function canalPedido(t: RefTextura): number {
  return t.extensions?.KHR_texture_transform?.texCoord ?? t.texCoord ?? 0;
}

function definirCanal(t: RefTextura, canal: number) {
  t.texCoord = canal;
  const tr = t.extensions?.KHR_texture_transform;
  if (tr && tr.texCoord !== undefined) tr.texCoord = canal;
}

/**
 * Corrige o documento glTF no lugar. Devolve as correções feitas.
 *
 * O material é CLONADO antes de ser corrigido sempre que outra primitiva o
 * usa. Materiais são compartilhados: remapear um material em benefício da
 * primitiva sem o canal 3 estragaria a que tem o canal 3 e o usa corretamente.
 */
function corrigirDoc(doc: DocGltf): string[] {
  const materiais = doc.materials;
  if (!materiais?.length || !doc.meshes?.length) return [];

  // Quantas primitivas usam cada material — decide entre corrigir no lugar e
  // clonar.
  const usos = new Map<number, number>();
  for (const mesh of doc.meshes) {
    for (const pr of mesh.primitives ?? []) {
      if (pr.material !== undefined) usos.set(pr.material, (usos.get(pr.material) ?? 0) + 1);
    }
  }

  const correcoes = new Map<string, number>();
  const anotar = (texto: string) => correcoes.set(texto, (correcoes.get(texto) ?? 0) + 1);

  for (const mesh of doc.meshes) {
    for (const pr of mesh.primitives ?? []) {
      if (pr.material === undefined) continue;
      const original = materiais[pr.material];
      if (!original) continue;

      const canais = canaisDaPrimitiva(pr);
      const faltando = slotsDeTextura(original).some(
        (slot) => !canais.includes(canalPedido(slot.ref)),
      );
      if (!faltando) continue;

      // Clona só quando o material é compartilhado; caso contrário mexe nele
      // mesmo, sem inchar o arquivo com cópias desnecessárias.
      let alvo = original;
      if ((usos.get(pr.material) ?? 0) > 1) {
        alvo = JSON.parse(JSON.stringify(original)) as MaterialGltf;
        alvo.name = `${original.name ?? "material"}__uv-corrigido`;
        materiais.push(alvo);
        pr.material = materiais.length - 1;
      }

      for (const slot of slotsDeTextura(alvo)) {
        const pedido = canalPedido(slot.ref);
        if (canais.includes(pedido)) continue;
        if (canais.length) {
          // Um canal existe: é o que as texturas deviam usar. Com vários, o
          // mais baixo é o de material (os altos são lightmap/detalhe).
          definirCanal(slot.ref, canais[0]);
          anotar(`textura de ${slot.nome}: canal de UV ${pedido} → ${canais[0]}`);
        } else {
          delete slot.dono[slot.chave];
          anotar(`textura de ${slot.nome} removida (a malha não tem canal de UV)`);
        }
      }
    }
  }

  return Array.from(correcoes, ([texto, n]) => (n > 1 ? `${texto} (${n}×)` : texto));
}

/** Alinha um comprimento de chunk ao múltiplo de 4 que o GLB exige. */
const alinhar4 = (n: number) => (n + 3) & ~3;

/**
 * Lê o GLB, corrige o que puder e devolve um arquivo pronto para enviar.
 *
 * Só o chunk JSON é reescrito — o binário (vértices, texturas) é copiado byte
 * a byte. Num arquivo de 40 MB isso é a diferença entre reescrever alguns
 * quilobytes de texto e reprocessar a malha inteira, e garante que a correção
 * não pode degradar geometria nem imagem.
 *
 * Qualquer imprevisto devolve o arquivo ORIGINAL: um saneador que falha não
 * pode impedir o envio de um arquivo que talvez estivesse bom.
 */
export async function sanearGlb(file: File): Promise<ResultadoSaneamento> {
  const semMudanca: ResultadoSaneamento = { arquivo: file, correcoes: [] };
  try {
    const buf = await file.arrayBuffer();
    const dv = new DataView(buf);
    if (buf.byteLength < 12 || dv.getUint32(0, true) !== MAGIC_GLTF) return semMudanca;

    let json: { texto: string; inicio: number; tam: number } | null = null;
    let bin: { inicio: number; tam: number } | null = null;
    let off = 12;
    while (off + 8 <= buf.byteLength) {
      const tam = dv.getUint32(off, true);
      const tipo = dv.getUint32(off + 4, true);
      const inicio = off + 8;
      if (tipo === CHUNK_JSON) {
        json = { texto: new TextDecoder().decode(new Uint8Array(buf, inicio, tam)), inicio, tam };
      } else if (tipo === CHUNK_BIN) {
        bin = { inicio, tam };
      }
      off = inicio + alinhar4(tam);
    }
    if (!json) return semMudanca;

    const doc = JSON.parse(json.texto) as DocGltf;
    const correcoes = corrigirDoc(doc);
    if (!correcoes.length) return semMudanca;

    // Preenchimento com ESPAÇO, não com zero: o chunk JSON é texto, e o zero
    // faria o parser do outro lado ler um caractere nulo depois do `}`.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
    const jsonTam = alinhar4(jsonBytes.length);
    const binTam = bin ? alinhar4(bin.tam) : 0;
    const total = 12 + 8 + jsonTam + (bin ? 8 + binTam : 0);

    const saida = new Uint8Array(total);
    const saidaDv = new DataView(saida.buffer);
    saidaDv.setUint32(0, MAGIC_GLTF, true);
    saidaDv.setUint32(4, 2, true);
    saidaDv.setUint32(8, total, true);
    saidaDv.setUint32(12, jsonTam, true);
    saidaDv.setUint32(16, CHUNK_JSON, true);
    saida.fill(0x20, 20 + jsonBytes.length, 20 + jsonTam);
    saida.set(jsonBytes, 20);
    if (bin) {
      const p = 20 + jsonTam;
      saidaDv.setUint32(p, binTam, true);
      saidaDv.setUint32(p + 4, CHUNK_BIN, true);
      saida.set(new Uint8Array(buf, bin.inicio, bin.tam), p + 8);
    }

    return {
      arquivo: new File([saida], file.name, { type: "model/gltf-binary" }),
      correcoes,
    };
  } catch {
    return semMudanca;
  }
}
