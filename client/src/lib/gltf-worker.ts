/// <reference lib="webworker" />
/**
 * Converte uma PASTA glTF em um `.glb` único — DENTRO DO NAVEGADOR.
 *
 * Antes isto rodava no `server/`, e por isso não existia no site publicado: o
 * deploy é serverless, e uma função serverless não recebe 417 MB de upload nem
 * fica minutos ocupando 1,6 GB de RAM. O produto é web; a conversão passou a
 * ser web também.
 *
 * Roda em WORKER, não na aba principal, por dois motivos concretos:
 *
 * - a conversão leva dezenas de segundos de CPU contínua, e no thread da
 *   interface isso congela a tela inteira, inclusive a cena 3D;
 * - o pico de memória medido é de ~1,6 GB (pasta de 417 MB). Isolado num
 *   worker, o que for liberado no fim volta ao sistema sem levar junto o estado
 *   do editor.
 *
 * Os arquivos chegam como `File`, que é só uma referência ao disco: passá-los
 * ao worker não copia nada. Quem lê os bytes é este código, um de cada vez.
 */
import { Document, WebIO, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, draco, listTextureSlots, prune, weld } from "@gltf-transform/functions";
import draco3dgltf from "draco3dgltf";
import wasmDoDraco from "draco3dgltf/draco_encoder.wasm?url";
import { anotarPegadaGlb } from "@shared/glb-footprint";
import { sanearGlb } from "./glb-sanear";

/** Um arquivo da pasta, com o caminho RELATIVO ao `.gltf`. */
export interface ArquivoPasta {
  rel: string;
  file: File;
}

export interface PedidoConversao {
  arquivos: ArquivoPasta[];
  nomeGltf: string;
  maxTextura: number;
  maxTexturaDados: number;
  qualidadeCor: number;
  /** Passo de quantização dos mapas de dado — ver `comprimirTexturas`. */
  passoDados: number;
}

export type RespostaConversao =
  | { tipo: "passo"; texto: string }
  | { tipo: "erro"; texto: string }
  | {
      tipo: "fim";
      bytes: Uint8Array;
      resumo: string;
      faltando: string[];
      correcoes: string[];
      contornos: number;
    };

const escopo = self as unknown as DedicatedWorkerGlobalScope;

function passo(texto: string): void {
  escopo.postMessage({ tipo: "passo", texto } satisfies RespostaConversao);
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Monta o mapa `uri → bytes` que o leitor usa no lugar do disco.
 *
 * A chave é a URI EXATA escrita no `.gltf`, com `#` e espaços e tudo — é assim
 * que o leitor vai procurar. Do lado do arquivo real a busca é tolerante
 * (minúsculas, com e sem percent-encoding), porque o 3ds Max escreve
 * `Grass001_2K-JPG_Color.jpg` e o arquivo no disco pode estar em outra caixa.
 *
 * Repare que aqui não há renomeação nenhuma, ao contrário da versão de
 * servidor: lá os arquivos precisavam existir em disco com nomes que o leitor
 * conseguisse resolver. Em memória, o mapa é a resolução.
 */
async function montarRecursos(
  json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] },
  arquivos: ArquivoPasta[],
): Promise<{ recursos: Record<string, Uint8Array>; faltando: string[] }> {
  const porNome = new Map<string, File>();
  for (const a of arquivos) porNome.set(a.rel.toLowerCase(), a.file);

  const recursos: Record<string, Uint8Array> = {};
  const faltando: string[] = [];
  const itens = [...(json.buffers ?? []), ...(json.images ?? [])];

  let lidos = 0;
  for (const item of itens) {
    const uri = item.uri;
    // `data:` já está embutido no próprio JSON; o leitor resolve sozinho.
    if (!uri || /^data:/i.test(uri)) continue;
    if (recursos[uri]) continue;

    const cru = uri.replace(/\\/g, "/");
    let decodificada = cru;
    try {
      decodificada = decodeURIComponent(cru);
    } catch {
      /* percent-encoding inválido: vale só o texto cru */
    }
    const file = porNome.get(cru.toLowerCase()) ?? porNome.get(decodificada.toLowerCase());
    if (!file) {
      faltando.push(uri);
      continue;
    }
    passo(`Lendo ${file.name} (${mb(file.size)})...`);
    recursos[uri] = new Uint8Array(await file.arrayBuffer());
    lidos++;
  }
  passo(`${lidos} arquivo(s) carregado(s).`);
  return { recursos, faltando };
}

/**
 * Textura de DADO carrega medida nos canais; textura de COR carrega cor.
 *
 * Slot desconhecido (textura vinda de extensão, como `specularTexture`) conta
 * como COR: são quase sempre cores chapadas, e tratá-las como dado só as faria
 * ocupar o dobro sem ganho visível.
 */
function ehDado(texture: Texture): boolean {
  return listTextureSlots(texture).some((s) =>
    /normalTexture|metallicRoughnessTexture|occlusionTexture/.test(s));
}

/**
 * Recomprime as texturas para WebP, tratando COR e DADO de formas diferentes.
 *
 * O WebP com perdas converte RGB para YUV e SUBAMOSTRA O CROMA: R e B ficam com
 * metade da resolução de G. Para cor isso é imperceptível. Num normal map,
 * porém, R/G/B são X/Y/Z da direção da superfície — subamostrar dois deles
 * inclina a normal pixel a pixel e a malha ganha um granulado que não existe no
 * modelo. Medido neste projeto, no `granite_base_specks_norm` a 1024:
 *
 *   canvas lossy 0.85    erro máx. por canal 17.52     528 KB
 *   canvas lossless      erro máx. por canal  0.00    1400 KB
 *   quantizado + lossless erro máx. por canal 2.00     903 KB
 *
 * Subir a qualidade não resolve (a subamostragem é estrutural), então os mapas
 * de dado vão pelo caminho SEM PERDAS. Para não dobrar o arquivo, eles são
 * quantizados antes: arredondar cada canal a um passo pequeno reduz muito a
 * entropia e limita o erro por igual nos três canais — que é justamente o que o
 * `near-lossless` do libwebp faz, e o canvas não expõe.
 */
async function comprimirTexturas(
  doc: Document,
  op: PedidoConversao,
): Promise<void> {
  const texturas = doc.getRoot().listTextures();
  if (!texturas.length) return;
  // Sem declarar a extensão, o escritor não emite `EXT_texture_webp` e o glTF
  // sai apontando para bytes WebP com mimeType que o visualizador não espera.
  doc.createExtension(EXTTextureWebP).setRequired(false);

  let n = 0;
  for (const texture of texturas) {
    n++;
    const imagem = texture.getImage();
    if (!imagem) continue;
    const dado = ehDado(texture);
    const lado = dado ? op.maxTexturaDados : op.maxTextura;
    passo(`Textura ${n}/${texturas.length} (${dado ? "dado" : "cor"})...`);

    try {
      // `premultiplyAlpha: none` preserva o canal alfa como está: o canvas
      // premultiplica por padrão, e isso destrói cor em pixels quase
      // transparentes. `colorSpaceConversion: none` evita o navegador
      // reinterpretar o perfil de cor e deslocar os valores.
      const bmp = await createImageBitmap(
        new Blob([imagem as BlobPart], { type: texture.getMimeType() }),
        { premultiplyAlpha: "none", colorSpaceConversion: "none" },
      );
      const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * escala));
      const h = Math.max(1, Math.round(bmp.height * escala));

      const cv = new OffscreenCanvas(w, h);
      const ctx = cv.getContext("2d", { willReadFrequently: dado });
      if (!ctx) throw new Error("sem contexto 2D");
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();

      let blob: Blob;
      if (dado) {
        if (op.passoDados > 1) {
          const px = ctx.getImageData(0, 0, w, h);
          const passoQ = op.passoDados;
          for (let i = 0; i < px.data.length; i++) {
            // O alfa fica intacto: em mapas de dado ele costuma carregar uma
            // medida própria (rugosidade, oclusão) e não tolera arredondar.
            if (i % 4 === 3) continue;
            px.data[i] = Math.min(255, Math.round(px.data[i] / passoQ) * passoQ);
          }
          ctx.putImageData(px, 0, 0);
        }
        blob = await cv.convertToBlob({ type: "image/webp", quality: 1 });
      } else {
        blob = await cv.convertToBlob({ type: "image/webp", quality: op.qualidadeCor });
      }

      // Só troca se realmente encolheu: uma textura pequena já otimizada pode
      // sair MAIOR do recodificador, e aí o original é a melhor versão.
      const novo = new Uint8Array(await blob.arrayBuffer());
      if (novo.byteLength < imagem.byteLength || escala < 1) {
        texture.setImage(novo).setMimeType("image/webp");
      }
    } catch (e) {
      // Uma textura ilegível não pode derrubar a importação inteira: ela segue
      // como estava, e o modelo entra com ela no formato original.
      passo(`Textura ${n} não pôde ser recomprimida; segue no formato original.`);
      console.warn("[gltf-worker] textura ignorada:", e);
    }
  }
}

async function converter(op: PedidoConversao): Promise<void> {
  const gltf = op.arquivos.find((a) => a.rel === op.nomeGltf);
  if (!gltf) throw new Error(`${op.nomeGltf} não veio na seleção`);

  passo("Lendo o .gltf...");
  const json = JSON.parse(await gltf.file.text()) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };

  const { recursos, faltando } = await montarRecursos(json, op.arquivos);

  passo("Montando o modelo (pode demorar em arquivos grandes)...");
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "draco3d.encoder": await draco3dgltf.createEncoderModule({
      locateFile: () => wasmDoDraco,
    }),
  });
  const doc = await io.readJSON({ json, resources: recursos } as never);

  passo("Removendo dados duplicados e não usados...");
  await doc.transform(dedup(), prune());

  /**
   * A silhueta é medida ANTES de comprimir a geometria, com os triângulos ainda
   * legíveis. É ela que permite recortar a fotogrametria sob a planta real do
   * empreendimento em vez de sob um retângulo.
   */
  passo("Medindo o contorno real da implantação...");
  const contornos = anotarPegadaGlb(doc);

  await comprimirTexturas(doc, op);

  // `draco()` só comprime geometria indexada; `weld()` garante o índice.
  passo("Compactando a geometria (Draco)...");
  await doc.transform(weld(), draco({ method: "edgebreaker" }));

  passo("Montando o arquivo .glb...");
  const cru = await io.writeBinary(doc);

  /**
   * O mesmo saneamento do envio manual, aplicado aqui também: material com
   * anisotropia sem normal map, nó com escala zero e textura pedida por malha
   * sem UV quebram o shader do Cesium em tempo de desenho e derrubam a cena
   * inteira — não só o modelo.
   */
  passo("Conferindo o que o Cesium não perdoa...");
  const { arquivo, correcoes } = await sanearGlb(
    new File([cru as BlobPart], "modelo.glb", { type: "model/gltf-binary" }),
  );
  const bytes = new Uint8Array(await arquivo.arrayBuffer());

  const raiz = doc.getRoot();
  escopo.postMessage(
    {
      tipo: "fim",
      bytes,
      resumo:
        `${raiz.listMeshes().length} malha(s), ${raiz.listMaterials().length} material(is), `
        + `${raiz.listTextures().length} textura(s) — ${mb(bytes.byteLength)}`,
      faltando,
      correcoes,
      contornos: contornos.length,
    } satisfies RespostaConversao,
    // Transferido, não copiado: o `.glb` pode ter dezenas de MB.
    [bytes.buffer],
  );
}

escopo.onmessage = (ev: MessageEvent<PedidoConversao>) => {
  void converter(ev.data).catch((e) => {
    escopo.postMessage({
      tipo: "erro",
      texto: e instanceof Error ? e.message : String(e),
    } satisfies RespostaConversao);
  });
};
