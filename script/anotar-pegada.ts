/**
 * Grava a silhueta de implantação (`ivmFootprintV1`) num `.glb` JÁ PRONTO.
 *
 * O importador de pasta calcula a pegada durante a conversão, mas nem todo
 * modelo passa por ele: há GLB exportado por fora, GLB antigo já publicado, e
 * GLB que veio pronto do escritório de 3D. Sem a anotação o recorte da
 * fotogrametria não sai — e o editor não tem como consertar isso sozinho,
 * porque calcular a silhueta exige decodificar a malha inteira, coisa que o
 * navegador não deve fazer a cada visita (e nem consegue, em modelo grande).
 *
 * Este script é essa saída: entra um `.glb`, sai o mesmo `.glb` com a silhueta
 * gravada no cabeçalho. Nada de geometria muda; o que muda é `scene.extras`.
 *
 * Uso:
 *   npm run pegada -- caminho/modelo.glb                 (grava modelo.pegada.glb)
 *   npm run pegada -- caminho/modelo.glb --sobrescrever  (grava por cima, com backup)
 *
 * Depois é só reenviar o arquivo pelo botão de GLB do editor. Em modo Supabase
 * ele sobe para o storage e a vitrine publicada passa a recortar.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { promises as fs } from "fs";
import path from "path";
import { anotarPegadaGlb, IVM_FOOTPRINT_KEY } from "../shared/glb-footprint";
import { sanearGlb } from "../server/sanearGlb";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const entrada = args.find((a) => !a.startsWith("--"));
  const sobrescrever = args.includes("--sobrescrever");
  if (!entrada) {
    console.error("uso: npm run pegada -- caminho/modelo.glb [--sobrescrever]");
    process.exit(1);
  }
  if (!/\.glb$/i.test(entrada)) {
    console.error("este script trabalha com .glb (arquivo único). Para uma PASTA glTF,");
    console.error("use a importação de pasta do editor, que já calcula a pegada.");
    process.exit(1);
  }

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });

  const antes = (await fs.stat(entrada)).size;
  console.log(`lendo ${path.basename(entrada)} (${mb(antes)})...`);
  const doc = await io.read(entrada);

  const cena = doc.getRoot().listScenes()[0];
  const jaTinha = !!(cena?.getExtras() as Record<string, unknown> | undefined)?.[IVM_FOOTPRINT_KEY];
  if (jaTinha) console.log("aviso: este arquivo JÁ tinha uma silhueta; ela será recalculada.");

  console.log("medindo o contorno real da implantação (decodifica a malha, demora)...");
  const contornos = anotarPegadaGlb(doc);
  if (!contornos.length) {
    console.error(
      "não foi possível medir o contorno — o modelo não tem geometria projetável.\n"
      + "Nada foi gravado: um arquivo sem silhueta é melhor que um com silhueta errada.",
    );
    process.exit(1);
  }
  const pontos = contornos.reduce((s, c) => s + c.length, 0);
  console.log(`contorno pronto: ${contornos.length} área(s), ${pontos} ponto(s).`);

  // O mesmo saneamento do upload: reescrever o GLB é a hora de garantir que ele
  // não carrega as combinações que quebram o shader do Cesium.
  const { buffer, relatorio } = sanearGlb(Buffer.from(await io.writeBinary(doc)));
  if (relatorio.saneado) {
    console.log(
      `saneado de quebra — ${relatorio.anisotropiaRemovida} anisotropia(s), `
      + `${relatorio.escalasCorrigidas} escala(s) zero, `
      + `${relatorio.texturasSemUv} textura(s) sem UV.`,
    );
  }

  let saida = entrada;
  if (sobrescrever) {
    // Backup antes de sobrescrever: a reescrita passa pelo codificador Draco de
    // novo, e voltar atrás sem cópia significaria reimportar a pasta inteira.
    const backup = entrada.replace(/\.glb$/i, ".antes-da-pegada.glb");
    await fs.copyFile(entrada, backup);
    console.log(`backup: ${path.basename(backup)}`);
  } else {
    saida = entrada.replace(/\.glb$/i, ".pegada.glb");
  }
  await fs.writeFile(saida, buffer);
  console.log(`gravado: ${saida} (${mb(buffer.length)})`);
  console.log("\nReenvie este arquivo pelo botão de GLB do editor para a vitrine recortar.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
