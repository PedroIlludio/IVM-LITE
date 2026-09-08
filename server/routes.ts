import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerVision3DRoutes } from "./vision3dRoutes";
import { registerUnidadesRoutes } from "./unidadesRoutes";
import { registerProjectsRoutes } from "./projectsRoutes";
import { registerGltfImportRoutes } from "./gltfImport";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  if (process.env.NODE_ENV === "production") {
    app.use((_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "frame-ancestors *");
      res.setHeader("Referrer-Policy", "no-referrer");
      next();
    });

    app.get(/\.map$/, (_req, res) => {
      res.status(404).end();
    });
  }

  /**
   * Avisa UMA vez, no arranque, se a configuracao do Supabase faltar.
   *
   * O erro do cliente ("Config do Supabase ausente") aparece na tela, mas quem
   * sobe o servidor costuma estar olhando o terminal. Dizer aqui encurta o
   * diagnostico de minutos para segundos.
   */
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error(
      "[config] SUPABASE_URL/SUPABASE_ANON_KEY ausentes — o app nao vai "
      + "conseguir ler o banco. Defina-as no .env (dev) ou no ambiente do deploy.",
    );
  }

  app.get("/api/config", (_req, res) => {
    res.json({
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
      googleMapId: process.env.GOOGLE_MAP_ID || "DEMO_MAP_ID",
      // Chaves públicas do Supabase (seguras de expor no cliente).
      // Sem default: ver a nota em `api/config.ts`. Um fallback apontando para
      // outro projeto fazia a aplicacao ler o banco errado em silencio.
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    });
  });

  /**
   * Rota viaria real entre o empreendimento e um ponto de interesse.
   *
   * GEMEA de `api/route.ts`. Esta versao serve o desenvolvimento (Express);
   * a de `api/` serve a producao, porque o `.vercelignore` exclui `server/` e
   * nada daqui existe no deploy. Mexeu numa, mexa na outra — foi justamente
   * por so existir esta que o tracado de rota funcionava na maquina de quem
   * edita e falhava calado no site publicado.
   */
  app.get("/api/route", async (req, res) => {
    const fromLng = Number(req.query.fromLng);
    const fromLat = Number(req.query.fromLat);
    const toLng = Number(req.query.toLng);
    const toLat = Number(req.query.toLat);
    const valid =
      [fromLng, fromLat, toLng, toLat].every(Number.isFinite) &&
      Math.abs(fromLng) <= 180 && Math.abs(toLng) <= 180 &&
      Math.abs(fromLat) <= 90 && Math.abs(toLat) <= 90;
    if (!valid) {
      return res.status(400).json({ message: "Coordenadas inválidas para calcular a rota." });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${fromLng},${fromLat};${toLng},${toLat}` +
        `?overview=full&geometries=geojson`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "IVM-Lite/1.0" },
      });
      if (!response.ok) throw new Error(`OSRM respondeu ${response.status}`);
      const payload = await response.json() as {
        code?: string;
        routes?: Array<{
          distance?: number;
          duration?: number;
          geometry?: { coordinates?: [number, number][] };
        }>;
      };
      const route = payload.routes?.[0];
      const coordinates = route?.geometry?.coordinates;
      if (payload.code !== "Ok" || !coordinates || coordinates.length < 2) {
        return res.status(404).json({ message: "Nenhum caminho viário encontrado." });
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.json({
        coordinates,
        distance: route.distance ?? null,
        duration: route.duration ?? null,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "O cálculo da rota excedeu o tempo limite."
        : "Não foi possível calcular a rota agora.";
      return res.status(502).json({ message });
    } finally {
      clearTimeout(timeout);
    }
  });

  registerVision3DRoutes(app);
  registerUnidadesRoutes(app);
  registerProjectsRoutes(app);
  registerGltfImportRoutes(app);

  return httpServer;
}
