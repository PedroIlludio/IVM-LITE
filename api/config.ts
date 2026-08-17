import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Configuração pública lida pelo cliente (chave do Google Maps + chaves
 * públicas do Supabase). Os valores vêm de variáveis de ambiente da Vercel; os
 * defaults do Supabase são as chaves públicas do projeto (seguras no cliente).
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
    googleMapId: process.env.GOOGLE_MAP_ID || "DEMO_MAP_ID",
    supabaseUrl: process.env.SUPABASE_URL || "https://pdnybigohaayvykxwxzb.supabase.co",
    supabaseAnonKey:
      process.env.SUPABASE_ANON_KEY || "sb_publishable_xcztKWGU0gQ4gY7-baU2qA_LBqLmG0M",
  });
}
