import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Configuracao publica lida pelo cliente: chave do Google Maps + chaves
 * publicas do Supabase (a anon key e publica por definicao — ela e servida ao
 * navegador em toda visita).
 *
 * NAO PONHA DEFAULT NO SUPABASE.
 *
 * Havia aqui a URL e a anon key de OUTRO projeto como fallback. Faltando a
 * variavel de ambiente, a aplicacao nao falhava: ela conectava, autenticava e
 * lia dados do banco errado — sem nenhum sinal na tela. Um default errado e
 * pior do que erro nenhum, porque some com a evidencia.
 *
 * Vazio, `getSupabase()` no cliente lanca "Config do Supabase ausente no
 * servidor" e o problema aparece na primeira tela. E o comportamento que se
 * quer: falhar alto, perto da causa.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
    googleMapId: process.env.GOOGLE_MAP_ID || "DEMO_MAP_ID",
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
}
