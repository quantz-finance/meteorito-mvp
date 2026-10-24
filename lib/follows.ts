// Seguir vendedores (POST /api/store follow / unfollow / following; migración 022). Estado compartido en memoria: el
// botón del perfil y el de las tarjetas del feed muestran lo mismo. Privado: el servidor solo devuelve a quién sigo YO
// y el número de seguidores del vendedor. Sin cuenta se sigue con la llave de este dispositivo (X-Guest-Key).
// Demo: sin red, en localStorage.
import { useEffect, useSyncExternalStore } from 'react';
import { guestApi } from './api';
import { DEMO_ENABLED } from './demo';
import type { MeteoritoAuth } from './types';

type Auth = Pick<MeteoritoAuth, 'getAuthToken'>;
export const FOLLOW_ERROR = 'No pudimos actualizar a quién sigues. Intenta de nuevo.';
const DEMO_KEY = 'meteorito:demo:follows';

let slugs = new Set<string>();
let version = 0;
let loadedFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

function demoRead(): string[] { try { return JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? '[]'); } catch { return []; } }
function demoWrite(v: string[]) { try { window.localStorage.setItem(DEMO_KEY, JSON.stringify(v)); } catch { /* sin storage */ } }

/** Carga una vez (por identidad) a quién sigue esta persona. Nunca lanza: ante un error, nadie aparece como seguido. */
export function loadFollowing(auth: Auth): Promise<void> {
  const who = auth.getAuthToken() ? 'account' : 'device';
  if (loadedFor === who) return loading ?? Promise.resolve();
  loadedFor = who;
  loading = (async () => {
    try {
      const list = DEMO_ENABLED ? demoRead() : (await guestApi<{ store_slugs: string[] }>(auth, '/api/store', { action: 'following' })).store_slugs;
      slugs = new Set(Array.isArray(list) ? list : []);
    } catch { slugs = new Set(); }
    emit();
  })();
  return loading;
}

/** Seguir o dejar de seguir. Devuelve el número de seguidores del vendedor (null si el servidor no lo sabe). */
export async function setFollowing(auth: Auth, storeSlug: string, on: boolean): Promise<number | null> {
  const prev = slugs.has(storeSlug);
  if (on) slugs.add(storeSlug); else slugs.delete(storeSlug); // optimista
  emit();
  try {
    if (DEMO_ENABLED) { demoWrite([...slugs]); return null; }
    const r = await guestApi<{ following: boolean; followers: number | null }>(auth, '/api/store', { action: on ? 'follow' : 'unfollow', store_slug: storeSlug });
    return typeof r?.followers === 'number' ? r.followers : null;
  } catch (e: any) {
    if (prev) slugs.add(storeSlug); else slugs.delete(storeSlug);
    emit();
    throw Object.assign(new Error(e?.status === 429 || e?.status === 400 ? e.message : FOLLOW_ERROR), { code: e?.code });
  }
}

/** ¿Sigo a este vendedor? Se actualiza en todas las pantallas a la vez. */
export function useFollowing(auth: Auth, storeSlug: string): boolean {
  const token = auth.getAuthToken();
  useEffect(() => { loadFollowing(auth); }, [token]);
  useSyncExternalStore(subscribe, () => version, () => version);
  return slugs.has(storeSlug);
}
/** Solo tests. */
export const __resetFollows = () => { slugs = new Set(); loadedFor = null; loading = null; emit(); };
