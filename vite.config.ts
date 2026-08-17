import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [
    react(),
    cesium(),
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
