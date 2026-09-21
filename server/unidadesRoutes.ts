import type { Express } from "express";
import { promises as fs } from "fs";
import path from "path";

// Espelho de vendas (mock editável). Gerado por script/gen-unidades.ts e
// versionado; troque pelos dados reais mantendo o mesmo formato.
const FILE = path.resolve(process.cwd(), "data", "unidades.json");

export function registerUnidadesRoutes(app: Express) {
  app.get("/api/unidades", async (_req, res) => {
    try {
      const txt = await fs.readFile(FILE, "utf-8");
      res.type("application/json").send(txt);
    } catch {
      res.json({ total: 0, unidades: [] });
    }
  });
}
