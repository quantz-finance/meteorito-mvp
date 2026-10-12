import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const supabaseConfigured = !!url && !!key;

// Se crea al primer uso (no durante el render estático en Node).
// No usamos Supabase Auth: la identidad viene de Cavos.
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Falta configurar Supabase (.env)');
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
