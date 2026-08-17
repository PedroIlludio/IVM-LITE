import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// URL + anon key são públicas (seguras no cliente) e vêm de /api/config.
let client: SupabaseClient | null = null;
let initPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (client) return Promise.resolve(client);
  if (initPromise) return initPromise;
  initPromise = fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        throw new Error("Config do Supabase ausente no servidor.");
      }
      client = createClient(cfg.supabaseUrl as string, cfg.supabaseAnonKey as string, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      return client;
    });
  return initPromise;
}
