import { defineConfig, type Plugin } from "vite";
import { readFile } from "fs/promises";
import { createRequire } from "module";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import cesium from "vite-plugin-cesium";


/**
 * Emite o worker do MapLibre junto do bundle.
 *
 * O MapLibre resolve o worker EM TEMPO DE EXECUÇÃO:
 *
 *   const url = new URL("./maplibre-gl-worker.mjs", import.meta.url).href
 *
 * Como a URL é montada em runtime, o Rollup não tem o que analisar e não emite
 * arquivo nenhum. Em produção, `import.meta.url` passa a ser o chunk
 * empacotado, a URL vira `/assets/maplibre-gl-worker.mjs` — e esse arquivo não
 * existe. O MapLibre cria então um Worker apontando para o nada: ele nunca
 * responde, o evento `load` nunca dispara e o mapa carrega para sempre SEM
 * ERRO NENHUM, porque do ponto de vista do navegador nada falhou.
 *
 * É o mesmo defeito que `optimizeDeps.exclude` resolve no dev-server — mas
 * `optimizeDeps` é pré-bundle de DESENVOLVIMENTO e não tem efeito no `vite
 * build`. O dev funcionava e a produção não, exatamente por isso.
 *
 * A correção é copiar os dois arquivos (o worker e o módulo compartilhado que
 * ele importa) para dentro de `assets/`, com o nome exato que a URL espera —
 * sem hash, porque o nome está escrito no código do MapLibre.
 */
function maplibreWorker(): Plugin {
  const arquivos = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
  return {
    name: "maplibre-worker-asset",
    apply: "build",
    async generateBundle() {
      const require = createRequire(import.meta.url);
      const base = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
      for (const nome of arquivos) {
        this.emitFile({
          type: "asset",
          fileName: `assets/${nome}`,
          source: await readFile(path.join(base, nome), "utf-8"),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    maplibreWorker(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      // Cesium 1.124 referencia um subpath antigo do @zip.js que o pacote atual
      // não expõe no exports map (quebra o dep-optimizer do Vite em dev). Não
      // usamos export de KML, então redirecionamos ao entry principal.
      "@zip.js/zip.js/lib/zip-no-worker.js": "@zip.js/zip.js",
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    // Relativo ao root (client) => resolve para <projeto>/dist/public, mesmo
    // destino de antes. Precisa ser relativo para o vite-plugin-cesium montar
    // corretamente o caminho de cópia dos assets do Cesium no Windows.
    outDir: "../dist/public",
    emptyOutDir: true,
  },
  optimizeDeps: {
    /**
     * O MapLibre carrega o motor de tiles num Web Worker, referenciado por
     * `new Worker(new URL("./maplibre-gl-worker.mjs", import.meta.url))`.
     *
     * O pré-bundle do Vite (esbuild) junta o pacote num arquivo só em
     * `.vite/deps/` e NÃO leva o worker junto — a URL passa a apontar para um
     * arquivo que não existe, e o dev-server, sendo SPA, responde com o
     * `index.html`. O MapLibre então cria um Worker cujo código-fonte é uma
     * página HTML: ele nunca responde, o evento `load` nunca dispara e o mapa
     * fica carregando para sempre — sem erro nenhum, porque, do ponto de vista
     * do navegador, nada falhou.
     *
     * Fora do pré-bundle o pacote é servido como ESM de verdade e o
     * `import.meta.url` resolve o worker no lugar certo.
     */
    exclude: ["maplibre-gl"],
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
