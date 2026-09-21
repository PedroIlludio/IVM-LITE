import type { Express } from "express";
import { promises as fs } from "fs";
import path from "path";

// Arquivo de posicionamentos do editor 3D (versionado no projeto → vira a
// configuração oficial e vai pra produção ao commitar).
const FILE = path.resolve(process.cwd(), "data", "vision3d-placements.json");

export function registerVision3DRoutes(app: Express) {
  // Leitura: disponível em dev e produção (o app lê para posicionar os assets).
  app.get("/api/vision3d/placements", async (_req, res) => {
    try {
      const txt = await fs.readFile(FILE, "utf-8");
      res.json(JSON.parse(txt));
    } catch {
      res.json({}); // ainda não há arquivo
    }
  });

  // Escrita: só em desenvolvimento (o editor é uma ferramenta local).
  app.post("/api/vision3d/placements", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res
        .status(403)
        .json({ error: "O editor de posicionamento é desabilitado em produção." });
    }
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(req.body ?? {}, null, 2), "utf-8");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "erro ao salvar" });
    }
  });
}
