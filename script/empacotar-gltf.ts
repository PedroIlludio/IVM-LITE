/**
 * Empacota uma PASTA glTF (`.gltf` + `.bin` + texturas soltas) num único GLB.
 *
 * Por que existe: o editor só aceitava um `.glb` pronto. A exportação do
 * 3ds Max/Babylon sai como pasta — o `.gltf` referencia o `.bin` e dezenas de
 * `.jpg`/`.png` por caminho relativo. Subir só o `.gltf` daria um modelo sem
 * geometria e sem textura; subir a pasta crua e servi-la assim seria pior:
 *
 * - os nomes vindos do 3ds Max têm ESPAÇO e `#` (`Map #2138626954 CL155.jpg`).
 *   Num navegador o `#` abre o fragmento da URL, então a textura nunca chega —
 *   falha silenciosa, material cinza;
 * - seriam ~70 requisições a cada abertura da vitrine;
 * - a pasta de origem pesa centenas de MB. A referência que roda bem é ~23 MB
 *   (ver `conferirPesoGlb`, no editor).
 *
 * Então a pasta entra e sai UM arquivo: texturas embutidas, imagens em WebP,
 * geometria em Draco. O destino é o mesmo do fluxo antigo (um GLB em
 * `client/public/uploads`), só que produzido aqui em vez de exigido pronto.
 *
 * RODA EM PROCESSO SEPARADO, chamado por `server/gltfImport.ts`. Ler um `.bin`
 * de 306 MB decodifica a geometria inteira para a memória; feito dentro do
 * servidor de desenvolvimento, ele cai — é o mesmo motivo já documentado em
 * `server/sanearGlb.ts` para não usar gltf-transform no saneamento.
 *
 * O progresso sai no stdout, uma linha JSON por passo, para o servidor
 * repassar ao editor.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, prune, textureCompress, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import { sanearGlb } from "../server/sanearGlb";
import { anotarPegadaGlb } from "./glb-footprint";

interface Opcoes {
  dir: string;
  gltf: string;
  saida: string;
  draco: boolean;
  webp: boolean;
  /** Lado maximo das texturas de COR (baseColor, emissive). */
  maxTextura: number;
  /** Lado maximo das texturas de DADO (normal, roughness, occlusion). */
  maxTexturaDados: number;
  /** Qualidade WebP das texturas de cor (1-100). */
  qualidadeCor: number;
  /** Forca do pre-processamento nearLossless das texturas de dado (1-100). */
  qualidadeDados: number;
}

/** Uma linha JSON por passo — o servidor lê isto e mostra no editor. */
function passo(fase: string, texto: string): void {
  process.stdout.write(`${JSON.stringify({ tipo: "passo", fase, texto })}\n`);
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reescreve o `.gltf` com nomes de arquivo previsíveis antes de ler.
 *
 * As URIs saem do 3ds Max com espaço, `#`, acento e maiúsculas que nem sempre
 * batem com o nome real no disco. Tratar isso dentro do leitor seria caçar caso
 * a caso; renomear uma vez, aqui, mata a classe inteira do problema — e o que
 * se renomeia é a CÓPIA temporária do upload, nunca a pasta do usuário.
 *
 * Devolve o `.gltf` normalizado e o que não foi achado: arquivo faltando vira
 * aviso, não erro. Um modelo com uma textura ausente ainda é útil; recusar a
 * importação inteira por causa dela, não.
 */
async function normalizarUris(
  dir: string,
  arquivoGltf: string,
): Promise<{ caminho: string; faltando: string[] }> {
  const origem = path.join(dir, arquivoGltf);
  const json = JSON.parse(await fs.readFile(origem, "utf-8")) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };

  // Índice do que existe no disco, por nome minúsculo: o `.gltf` escreve
  // `Grass001_2K-JPG_Color.jpg` e o arquivo pode estar em outra caixa.
  const noDisco = new Map<string, string>();
  async function varrer(sub: string): Promise<void> {
    for (const e of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) await varrer(rel);
      else noDisco.set(rel.toLowerCase(), rel);
    }
  }
  await varrer("");

  const faltando: string[] = [];
  const renomeados = new Map<string, string>();
  let n = 0;

  /** Acha o arquivo real de uma URI e devolve o nome seguro já gravado. */
  async function resolver(uri: string): Promise<string | null> {
    // `data:` já vem embutido; nada a resolver.
    if (/^data:/i.test(uri)) return uri;
    const cru = uri.replace(/\\/g, "/");
    // A URI pode vir percent-encoded ou não — tentamos as duas leituras.
    let decodificada = cru;
    try {
      decodificada = decodeURIComponent(cru);
    } catch {
      /* percent-encoding inválido: fica só com o texto cru */
    }
    for (const tentativa of [cru, decodificada]) {
      const achado = noDisco.get(tentativa.toLowerCase());
      if (!achado) continue;
      const jaFeito = renomeados.get(achado);
      if (jaFeito) return jaFeito;
      const ext = path.extname(achado).toLowerCase() || ".bin";
      const seguro = `asset_${n++}${ext}`;
      await fs.rename(path.join(dir, achado), path.join(dir, seguro));
      noDisco.set(seguro.toLowerCase(), seguro);
      renomeados.set(achado, seguro);
      return seguro;
    }
    return null;
  }

  for (const lista of [json.buffers ?? [], json.images ?? []]) {
    for (const item of lista) {
      if (!item.uri) continue;
      const novo = await resolver(item.uri);
      if (novo) item.uri = novo;
      else faltando.push(item.uri);
    }
  }

  const caminho = path.join(dir, "__normalizado.gltf");
  await fs.writeFile(caminho, JSON.stringify(json), "utf-8");
  return { caminho, faltando };
}

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const i = a.indexOf("=");
    if (a.startsWith("--") && i > 0) args.set(a.slice(2, i), a.slice(i + 1));
  }
  const op: Opcoes = {
    dir: args.get("dir") ?? "",
    gltf: args.get("gltf") ?? "",
    saida: args.get("saida") ?? "",
    draco: args.get("draco") !== "0",
    webp: args.get("webp") !== "0",
    maxTextura: Number(args.get("maxTextura") ?? 2048),
    maxTexturaDados: Number(args.get("maxTexturaDados") ?? 1024),
    qualidadeCor: Number(args.get("qualidadeCor") ?? 85),
    qualidadeDados: Number(args.get("qualidadeDados") ?? 40),
  };
  if (!op.dir || !op.gltf || !op.saida) throw new Error("faltam --dir/--gltf/--saida");

  passo("normalizando", "Conferindo os arquivos da pasta...");
  const { caminho, faltando } = await normalizarUris(op.dir, op.gltf);
  if (faltando.length) {
    passo(
      "normalizando",
      `${faltando.length} arquivo(s) citado(s) pelo .gltf não vieram na pasta — o modelo entra sem eles.`,
    );
  }

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });

  passo("lendo", "Lendo a geometria e as texturas (demora, em modelos grandes)...");
  const doc = await io.read(caminho);

  const raiz = doc.getRoot();
  const antes = {
    malhas: raiz.listMeshes().length,
    materiais: raiz.listMaterials().length,
    texturas: raiz.listTextures().length,
  };

  /**
   * Limpeza conservadora, e SÓ ela.
   *
   * `dedup` e `prune` não mexem na hierarquia de nós — e a cena depende dessa
   * hierarquia continuar de pé, porque as caixas das unidades e o corte de
   * pavimento são posicionados no espaço do modelo. Por isso nada de `flatten`
   * nem `join`: renderiam mais alguns MB e trocariam a estrutura por baixo do
   * editor.
   */
  passo("limpando", "Removendo dados duplicados e não usados...");
  await doc.transform(dedup(), prune());

  /**
   * Guarda a silhueta horizontal REAL antes de comprimir a geometria.
   *
   * O cliente consegue ler `scene.extras` só pelo cabeçalho JSON do GLB. Assim
   * ele recorta a fotogrametria sob a planta côncava do modelo sem precisar
   * baixar e decodificar milhões de vértices novamente em cada visita.
   */
  passo("pegada", "Medindo o contorno real da implantação...");
  const pegada = anotarPegadaGlb(doc);
  passo(
    "pegada",
    pegada.length
      ? `Contorno da implantação pronto (${pegada.length} área(s)).`
      : "Não foi possível medir o contorno; será usada a caixa do modelo.",
  );

  if (op.webp) {
    /**
     * COR e DADO são comprimidos de formas diferentes, e isto não é capricho.
     *
     * WebP com perdas converte RGB para YUV e SUBAMOSTRA O CROMA (4:2:0): os
     * canais R e B ficam com metade da resolução do G. Para cor isso é
     * imperceptível — o olho enxerga muito menos detalhe de cor que de brilho.
     *
     * Só que num normal map R/G/B não são cor: são X/Y/Z da direção da
     * superfície. Subamostrar dois deles inclina a normal pixel a pixel, e a
     * malha ganha um granulado que não existe no modelo. O mesmo vale para
     * roughness e occlusion, que guardam medida nos canais.
     *
     * Medido no `granite_base_specks_norm` deste projeto (erro médio por canal,
     * contra o original na mesma resolução):
     *
     *   lossy q80    R 12.35  G 7.52  B 9.36    1567 KB
     *   lossy q100   R 11.31  G 6.37  B 8.15    3235 KB
     *   nearLossless R  0.50  G 0.50  B 0.50    3698 KB
     *
     * Repare que subir a qualidade quase não ajuda: a subamostragem é
     * estrutural no modo com perdas, não um efeito de quantização. O conserto
     * não é comprimir menos, é não usar o modo com perdas nesses mapas.
     */
    const cor = /baseColorTexture|emissiveTexture/;
    const dado = /normalTexture|metallicRoughnessTexture|occlusionTexture/;

    passo(
      "texturas",
      `Convertendo ${raiz.listTextures().length} textura(s) para WebP `
      + `(cor até ${op.maxTextura}px, dados até ${op.maxTexturaDados}px)...`,
    );
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        slots: cor,
        resize: [op.maxTextura, op.maxTextura],
        quality: op.qualidadeCor,
      }),
    );
    /**
     * Os mapas de dado pagam o preço em bytes, então compensam na resolução: a
     * 1024 e sem dano de croma eles ficam melhores do que a 2048 com ele — e
     * cabem. É o mesmo motivo de `maxTexturaDados` existir separado.
     */
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        slots: dado,
        resize: [op.maxTexturaDados, op.maxTexturaDados],
        /**
         * `nearLossless` usa o pipeline SEM PERDAS do WebP, so com um
         * pre-processamento que agrupa valores parecidos. Nao ha conversao para
         * YUV, entao nao ha subamostragem de croma — que e o ponto todo.
         *
         * A 40 o pre-processamento e forte e o arquivo fica em ~2/3 do que
         * ficaria a 90, com erro maximo por canal ainda em 2 de 255 (medido nos
         * normais deste projeto). Contra 16 do modo com perdas, e a diferenca
         * entre uma superficie lisa e uma granulada.
         */
        nearLossless: true,
        quality: op.qualidadeDados,
      }),
    );
    /**
     * Sobras: textura que nao caiu em nenhum dos dois grupos.
     *
     * `specularTexture` e afins vem de extensao de material e nao batem com os
     * padroes acima — sem esta passada elas ficavam como chegaram, e uma delas
     * saiu do 3ds Max com 3072px em JPEG: ocupando VRAM a toa num slot que quase
     * sempre e uma cor chapada. `formats` limita a quem ainda nao virou WebP,
     * entao nada e recomprimido duas vezes.
     */
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: "webp",
        formats: /jpeg|png/,
        resize: [op.maxTextura, op.maxTextura],
        quality: op.qualidadeCor,
      }),
    );
  }

  if (op.draco) {
    // `draco()` só comprime geometria indexada; `weld()` garante o índice.
    passo("geometria", "Compactando a geometria (Draco)...");
    await doc.transform(weld(), draco({ method: "edgebreaker" }));
  }

  passo("gravando", "Montando o arquivo .glb...");
  const glb = await io.writeBinary(doc);

  /**
   * O mesmo saneamento do upload de GLB, aplicado AQUI e não no servidor.
   *
   * Um material com anisotropia sem normal map, ou um nó com escala zero,
   * quebram o render do Cesium depois do carregamento — ver `sanearGlb`. Nada
   * garante que a pasta importada esteja livre disso; ela vem do mesmo 3ds Max
   * que originou o problema.
   *
   * Feito no processo filho porque o buffer do GLB já está na memória dele, que
   * é a memória dimensionada para isto. Passá-lo ao servidor de desenvolvimento
   * só para saneá-lo devolveria o pico de memória exatamente ao processo que se
   * quis proteger.
   */
  const { buffer, relatorio } = sanearGlb(Buffer.from(glb));
  if (relatorio.saneado) {
    passo(
      "saneando",
      `Corrigido para o Cesium: ${relatorio.anisotropiaRemovida} material(is) com `
      + `anisotropia sem normal map, ${relatorio.escalasCorrigidas} nó(s) com escala zero, `
      + `${relatorio.texturasSemUv} textura(s) pedida(s) por malha sem UV.`,
    );
  }
  await fs.writeFile(op.saida, buffer);

  const depois = {
    malhas: raiz.listMeshes().length,
    materiais: raiz.listMaterials().length,
    texturas: raiz.listTextures().length,
  };
  process.stdout.write(
    `${JSON.stringify({
      tipo: "fim",
      bytes: buffer.length,
      texto:
        `${depois.malhas} malha(s), ${depois.materiais} material(is), `
        + `${depois.texturas} textura(s) — ${mb(buffer.length)}`,
      antes,
      depois,
      faltando,
    })}\n`,
  );
}

main().catch((e) => {
  process.stdout.write(
    `${JSON.stringify({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) })}\n`,
  );
  process.exit(1);
});
