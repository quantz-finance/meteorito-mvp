import 'react-native-url-polyfill/auto';
import { DEMO_ENABLED } from './demo';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const supabaseConfigured = DEMO_ENABLED || (!!url && !!key); // demo: sin base de datos

export const SUPABASE_URL = url;

/** Lecturas públicas por PostgREST con fetch (sin cargar supabase-js: ~400 KB que no hacen falta para ver un link de pago). */
export async function restSelect<T>(path: string): Promise<T> {
  if (DEMO_ENABLED) throw new Error('Modo demo: Supabase deshabilitado'); // nunca se lee la base real en demo
  if (!supabaseConfigured) throw new Error('Falta configurar Supabase (.env)');
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
  return r.json() as Promise<T>;
}
export async function restRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (DEMO_ENABLED) throw new Error('Modo demo: Supabase deshabilitado');
  if (!supabaseConfigured) throw new Error('Falta configurar Supabase (.env)');
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
  return r.json() as Promise<T>;
}

// supabase-js (Storage) se descarga solo al subir una foto. No usamos Supabase Auth: la identidad viene de Cavos.
let client: SupabaseClient | null = null;
export async function supabase(): Promise<SupabaseClient> {
  if (DEMO_ENABLED) throw new Error('Modo demo: Supabase deshabilitado'); // nunca se escribe/lee la base real en demo
  if (!supabaseConfigured) throw new Error('Falta configurar Supabase (.env)');
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  return client;
}
