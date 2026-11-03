// Cloudflare Turnstile en la web (solo cuando el servidor lo pide: respuesta 403 code 'turnstile_required').
// - El servidor decide: sin TURNSTILE_SECRET_KEY no pide nada (producción sin llaves = apagado).
// - Carga el script de Cloudflare solo la primera vez que hace falta y resuelve con un token de un uso.
// - Nativo (iOS) o sin DOM: devuelve null (el servidor no pide Turnstile a la app nativa: ver api/_lib/turnstile.ts).
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 30_000;
const ENV_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '';

const isWeb = () => typeof window !== 'undefined' && typeof document !== 'undefined';
let loading: Promise<any> | null = null;

function loadScript(): Promise<any> {
  const w = window as any;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return (loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = () => (w.turnstile ? res(w.turnstile) : rej(new Error('turnstile no cargó')));
    s.onerror = () => { loading = null; rej(new Error('turnstile no cargó')); };
    document.head.appendChild(s);
  }));
}

/** Token de Turnstile para `action` (o null si no se pudo: nativo, sin red, cancelado). */
export async function turnstileToken(siteKey: string | null | undefined, action = 'guest'): Promise<string | null> {
  const key = siteKey || ENV_SITE_KEY;
  if (!isWeb() || !key) return null;
  let ts: any;
  try { ts = await loadScript(); } catch { return null; }
  return new Promise((resolve) => {
    // Contenedor flotante: Turnstile casi siempre resuelve solo; si pide un clic, se ve abajo al centro.
    const box = document.createElement('div');
    box.setAttribute('data-testid', 'turnstile');
    Object.assign(box.style, { position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)', zIndex: '2147483647' });
    document.body.appendChild(box);
    let id: any = null; let done = false;
    const finish = (t: string | null) => {
      if (done) return; done = true; clearTimeout(timer);
      try { if (id != null) ts.remove(id); } catch { /* */ }
      box.remove(); resolve(t);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    try {
      id = ts.render(box, {
        sitekey: key, action, appearance: 'interaction-only', language: 'es',
        callback: (t: string) => finish(t), 'error-callback': () => finish(null), 'expired-callback': () => finish(null),
      });
    } catch { finish(null); }
  });
}
