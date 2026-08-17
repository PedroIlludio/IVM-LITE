/**
 * Saneamento de GLB no upload.
 *
 * Existe por causa de um bug do Cesium 1.140 que derruba a cena INTEIRA, e não
 * só o modelo problemático. No `MaterialStageFS`:
 *
 *   #if defined(HAS_NORMAL_TEXTURE) || defined(HAS_CLEARCOAT_NORMAL_TEXTURE)
 *   vec3 computeTangent(in vec3 position, in vec2 normalTexCoords) { ... }
 *   #endif
 *
 *   // dentro de getNormalInfo, que só existe sob #ifdef USE_ANISOTROPY
 *   #ifdef HAS_NORMAL_TEXTURE
 *       vec2 normalTexCoords = getNormalTexCoords();
 *   #endif
 *   #ifdef HAS_BITANGENTS
 *       ...
 *   #else // Assume HAS_NORMAL_TEXTURE   <- a suposição errada
 *       vec3 tangent = computeTangent(attributes.positionEC, normalTexCoords);
 *
 * Um material com anisotropia, SEM normal map e SEM tangentes cai no `#else` e
 * o shader referencia duas coisas nunca declaradas. Falha na COMPILAÇÃO do
 * shader, em tempo de desenho — depois do carregamento. Nenhum `try/catch` em
 * volta do load pega isso, e a cena para de renderizar.
 *
 * Por que no servidor, e por que no upload:
 *
 * - No cliente exigiria baixar, corrigir e reentregar o GLB ao Cesium como
 *   blob, dobrando memória e latência a cada abertura da vitrine.
 * - Corrigir arquivo a arquivo à mão não escala: qualquer exportação nova do
 *   3ds Max/Corona traz a combinação de volta.
 *
 * Por que mexer no JSON cru em vez de usar `gltf-transform`:
 *
 * O caminho normal seria ler o documento, remover a extensão e regravar. Só que
 * isso decodifica a geometria inteira para a memória — num GLB de 543 MB (que é
 * o tamanho real do caso que originou isto) o documento em memória passa de um
 * gigabyte, e o servidor de desenvolvimento cai.
 *
 * O GLB é `header (12 bytes) + chunk JSON + chunk BIN`, e tudo o que precisa
 * mudar está no JSON. O chunk BIN é copiado byte a byte, sem ser interpretado.
 */

/** Só o que foi tocado, para o log dizer o que aconteceu. */
export interface RelatorioSaneamento {
  saneado: boolean;
  anisotropiaRemovida: number;
  escalasCorrigidas: number;
  motivo?: string;
}

/**
 * Menor escala aceita num eixo, em unidades do modelo.
 *
 * Escala ZERO num eixo — `[1, 0, 1]`, típico de spline ou plano achatado
 * exportado do 3ds Max — torna a matriz do nó singular. O Cesium inverte a
 * modelView a cada quadro (`cleanInverseModelView`), e `Matrix4.inverse` LANÇA
 * em determinante zero. O render inteiro para, com o erro "matrix is not
 * invertible".
 *
 * 1e-4 é indistinguível de zero na tela (décimo de milímetro na escala de
 * metros) e mantém o determinante longe do limiar de precisão. Trocar por zero
 * não perde nada: o objeto já era degenerado e não desenhava nada de qualquer
 * forma.
 */
const ESCALA_MINIMA = 1e-4;

const MAGIC_GLB = 0x46546c67; // "glTF"
const TIPO_JSON = 0x4e4f534a; // "JSON"

interface MaterialGltf {
  normalTexture?: unknown;
  extensions?: Record<string, unknown>;
}

interface NoGltf {
  name?: string;
  scale?: number[];
  matrix?: number[];
}

interface JsonGltf {
  materials?: MaterialGltf[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  nodes?: NoGltf[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

/** Determinante do bloco linear de uma matriz glTF (column-major, 16 floats). */
function det3(m: number[]): number {
  const [a, b, c] = [m[0], m[1], m[2]];
  const [d, e, f] = [m[4], m[5], m[6]];
  const [g, h, i] = [m[8], m[9], m[10]];
  return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
}

/**
 * Tira do zero as transformações que não podem ser invertidas.
 *
 * Devolve quantos nós foram tocados.
 */
function corrigirEscalas(nos: NoGltf[]): number {
  let tocados = 0;
  for (const no of nos) {
    if (no.scale && no.scale.some((s) => Math.abs(s) < ESCALA_MINIMA)) {
      no.scale = no.scale.map((s) =>
        Math.abs(s) < ESCALA_MINIMA ? (s < 0 ? -ESCALA_MINIMA : ESCALA_MINIMA) : s,
      );
      tocados++;
      continue;
    }
    // Nó com matriz explícita: empurra a diagonal do bloco linear. É o mínimo
    // que devolve a invertibilidade sem reinterpretar a rotação embutida.
    if (no.matrix && no.matrix.length === 16 && Math.abs(det3(no.matrix)) < 1e-12) {
      for (const d of [0, 5, 10]) {
        if (Math.abs(no.matrix[d]) < ESCALA_MINIMA) no.matrix[d] = ESCALA_MINIMA;
      }
      tocados++;
    }
  }
  return tocados;
}

/**
 * Devolve o GLB corrigido, ou o próprio buffer quando não há o que fazer.
 *
 * Nunca lança: um arquivo que este código não entende passa intacto. Recusar um
 * upload por causa de uma verificação preventiva seria pior do que o problema
 * que ela evita.
 */
export function sanearGlb(buf: Buffer): { buffer: Buffer; relatorio: RelatorioSaneamento } {
  const intacto = (motivo: string) => ({
    buffer: buf,
    relatorio: { saneado: false, anisotropiaRemovida: 0, escalasCorrigidas: 0, motivo },
  });

  try {
    if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC_GLB) {
      return intacto("não é GLB binário");
    }
    const tamJson = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== TIPO_JSON || 20 + tamJson > buf.length) {
      return intacto("chunk JSON inesperado");
    }

    const json = JSON.parse(
      buf.subarray(20, 20 + tamJson).toString("utf8"),
    ) as JsonGltf;

    const escalasCorrigidas = corrigirEscalas(json.nodes ?? []);

    const materiais = json.materials ?? [];
    if (!materiais.length && !escalasCorrigidas) return intacto("nada a corrigir");

    /**
     * Tangente é por PRIMITIVA, não por material, e um material pode ser usado
     * por várias. Basta uma primitiva sem TANGENT para o shader ser gerado sem
     * `HAS_BITANGENTS` — então a checagem é global e conservadora: havendo
     * qualquer primitiva sem tangente, a anisotropia sem normal map é risco.
     */
    const algumaSemTangente = (json.meshes ?? []).some((m) =>
      (m.primitives ?? []).some((p) => p.attributes?.TANGENT === undefined),
    );

    let removidas = 0;
    for (const mat of materiais) {
      const ext = mat.extensions;
      if (!ext || !("KHR_materials_anisotropy" in ext)) continue;
      // Duas saídas seguras, e a anisotropia é preservada nas duas:
      // 1) com normal map, o shader declara `normalTexCoords` e define
      //    `computeTangent`;
      // 2) com tangentes em todas as primitivas, o ramo `HAS_BITANGENTS` nem
      //    chega a precisar dos dois.
      if (mat.normalTexture) continue;
      if (!algumaSemTangente) continue;
      delete ext.KHR_materials_anisotropy;
      if (!Object.keys(ext).length) delete mat.extensions;
      removidas++;
    }
    if (!removidas && !escalasCorrigidas) return intacto("nada a corrigir");

    // Só sai das listas se nenhum material ainda a referencia.
    const aindaUsada = materiais.some(
      (m) => m.extensions && "KHR_materials_anisotropy" in m.extensions,
    );
    if (!aindaUsada) {
      const tirar = (l?: string[]) =>
        l?.filter((n) => n !== "KHR_materials_anisotropy");
      if (json.extensionsUsed) json.extensionsUsed = tirar(json.extensionsUsed);
      if (json.extensionsRequired) json.extensionsRequired = tirar(json.extensionsRequired);
    }

    // Remonta: o chunk JSON tem de ser múltiplo de 4, preenchido com ESPAÇO
    // (0x20) — é o que a especificação manda, e um preenchimento com zero faz
    // parsers estritos recusarem o arquivo.
    const novoJson = Buffer.from(JSON.stringify(json), "utf8");
    const sobra = (4 - (novoJson.length % 4)) % 4;
    const jsonPad = Buffer.concat([novoJson, Buffer.alloc(sobra, 0x20)]);

    const resto = buf.subarray(20 + tamJson); // chunks seguintes, BIN inclusive
    const cabecalho = Buffer.alloc(20);
    cabecalho.writeUInt32LE(MAGIC_GLB, 0);
    cabecalho.writeUInt32LE(2, 4); // versão
    cabecalho.writeUInt32LE(20 + jsonPad.length + resto.length, 8);
    cabecalho.writeUInt32LE(jsonPad.length, 12);
    cabecalho.writeUInt32LE(TIPO_JSON, 16);

    return {
      buffer: Buffer.concat([cabecalho, jsonPad, resto]),
      relatorio: { saneado: true, anisotropiaRemovida: removidas, escalasCorrigidas },
    };
  } catch (e) {
    return intacto(e instanceof Error ? e.message : "falha ao inspecionar");
  }
}
