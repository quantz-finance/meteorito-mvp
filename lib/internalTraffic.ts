// Tráfico interno y de CI fuera de PostHog (sin datos nuevos de personas: solo un booleano por evento).
//  - Automatizado (Playwright/CI/headless: navigator.webdriver, UA headless, o build con EXPO_PUBLIC_ANALYTICS_INTERNAL=ci):
//    NO se envía nada. posthog-js ya descarta navegadores automatizados en web; esto cubre también el envío directo
//    del nativo y cualquier navegador de prueba que no se delate.
//  - Interno (equipo/QA): se envía igual, pero cada evento lleva `is_internal: true` para filtrarlo en PostHog
//    (filtro: is_internal != true). Se marca con:
//      * `?internal=1` en cualquier URL de la app (queda guardado en este navegador; `?internal=0` lo borra),
//      * builds con EXPO_PUBLIC_ANALYTICS_INTERNAL=1,
//      * localhost y previews de Vercel (*.vercel.app, salvo los alias de producción meteorito-mvp*.vercel.app).
//  El resto de eventos lleva `is_internal: false`. Nada de emails, ids ni listas de cuentas.
export const INTERNAL_KEY = 'meteorito:internal';
const AUTOMATION_UA = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Electron.*Headless/i;
const INTERNAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.vercel\.app)$/i;
// Alias de PRODUCCIÓN en vercel.app (mismo deploy que pago.meteorito.app): usuarios reales, no internos.
const PROD_HOST = /^meteorito-mvp(-quantz4|-git-main-quantz4)?\.vercel\.app$/i;

export type Traffic = { automated: boolean; internal: boolean };
export function detectTraffic(o: {
  href?: string | null; ua?: string | null; webdriver?: boolean | null; store?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null; buildFlag?: string | null;
}): Traffic {
  const flag = String(o.buildFlag ?? '').trim().toLowerCase();
  const automated = o.webdriver === true || AUTOMATION_UA.test(o.ua ?? '') || flag === 'ci';
  let url: URL | null = null; try { url = o.href ? new URL(o.href) : null; } catch { url = null; }
  const q = url?.searchParams.get('internal');
  try {
    if (q === '1') o.store?.setItem(INTERNAL_KEY, '1');
    else if (q === '0') o.store?.removeItem(INTERNAL_KEY);
  } catch { /* storage bloqueado: vale solo para esta carga */ }
  let stored = false; try { stored = o.store?.getItem(INTERNAL_KEY) === '1'; } catch { stored = false; }
  const internal = automated || q === '1' || (q !== '0' && stored) || flag === '1' || (INTERNAL_HOST.test(url?.hostname ?? '') && !PROD_HOST.test(url?.hostname ?? ''));
  return { automated, internal };
}
