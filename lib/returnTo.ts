// Volver a la misma pantalla después de "Entrar de nuevo". La PWA de iPhone se reabre en "/" (start_url) y, si la sesión
// de Cavos venció, muestra el login: al entrar, la persona vuelve a la pantalla donde estaba (p. ej. Vender con su
// borrador) en vez de quedar en Inicio. Solo rutas internas recientes (24 h) y solo si el re-login vino de una sesión que
// se perdió (no en el primer login). Puro salvo storage; nunca lanza.
const ROUTE_KEY = 'meteorito:return-to:v1';
const PENDING_KEY = 'meteorito:relogin-pending:v1';
export const RETURN_TTL_MS = 24 * 3600_000;
/** Donde abre la app (start_url del manifest = /vender, o la raíz). */
const START = ['/', '/vender'];
/** Rutas que no tiene sentido restaurar (inicio, login, callbacks). */
const SKIP = /^\/(?:$|\?|legal\/|p\/|i\/|t\/)/;
const safePath = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && p.length <= 300 && !/cavos_auth_code|auth_data/.test(p);

function store(kind: 'local' | 'session'): Storage | null { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; } }

/** Guarda la ruta actual (con su query) mientras hay sesión. */
export function rememberRoute(path: string, now = Date.now()) {
  if (!safePath(path) || SKIP.test(path)) return;
  try { store('local')?.setItem(ROUTE_KEY, JSON.stringify({ path, at: now })); } catch { /* */ }
}
/** Se perdió la sesión (pantalla "Entrar de nuevo"): al volver a entrar, restaurar la ruta guardada. Sobrevive al login con Google/Apple (redirección en la misma pestaña). */
export function markReloginPending() { try { store('session')?.setItem(PENDING_KEY, '1'); store('local')?.setItem(PENDING_KEY, String(Date.now())); } catch { /* */ } }
export function reloginPending(now = Date.now()): boolean {
  try {
    if (store('session')?.getItem(PENDING_KEY)) return true;
    const at = Number(store('local')?.getItem(PENDING_KEY) ?? 0);
    return !!at && now - at < RETURN_TTL_MS;
  } catch { return false; }
}
/** Ruta a la que volver tras el re-login, o null. Solo si la app quedó en su inicio ("/" o /vender, al reabrir la PWA) y la ruta es reciente. Consume la marca. */
export function takeReturnRoute(current: string, now = Date.now()): string | null {
  if (!reloginPending(now)) return null;
  try { store('session')?.removeItem(PENDING_KEY); store('local')?.removeItem(PENDING_KEY); } catch { /* */ }
  if (!START.includes(current)) return null; // ya está en una pantalla concreta (p. ej. volvió del login a la misma URL)
  try {
    const raw = store('local')?.getItem(ROUTE_KEY); if (!raw) return null;
    const { path, at } = JSON.parse(raw);
    if (!safePath(path) || SKIP.test(path) || !(now - Number(at) < RETURN_TTL_MS)) return null;
    return path;
  } catch { return null; }
}
export const __resetReturnForTests = () => { try { store('local')?.removeItem(ROUTE_KEY); store('local')?.removeItem(PENDING_KEY); store('session')?.removeItem(PENDING_KEY); } catch { /* */ } };
