import type { VercelRequest, VercelResponse } from "@vercel/node";
import unidades from "../data/unidades.json";

/**
 * Espelho de vendas mock do piloto. Na plataforma as unidades vivem no projeto
 * (Supabase); este endpoint só alimenta o "Repor o piloto" e o /explorar local.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json(unidades);
}
