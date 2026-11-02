// (103) Tráfico interno y de CI fuera de PostHog (lib/internalTraffic.ts + lib/analytics.ts). Sin red.
//  - Automatizado (webdriver, UA headless, build EXPO_PUBLIC_ANALYTICS_INTERNAL=ci): no se envía nada.
//  - Interno (?internal=1 guardado, ?internal=0 lo borra, build =1, localhost, *.vercel.app): is_internal=true.
//  - Sin datos nuevos de personas: solo el booleano is_internal (nada de email/ids/listas de cuentas).
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { detectTraffic, INTERNAL_KEY } from '../../lib/internalTraffic';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PROD = 'https://pago.meteorito.app/p/abc';

export async function run(t: T) {
  const s0 = mem();
  t.check('usuario normal en prod -> se envía, is_internal=false', JSON.stringify(detectTraffic({ href: PROD, ua: UA, webdriver: false, store: s0 })) === '{"automated":false,"internal":false}');
  t.check('navigator.webdriver (Playwright/Selenium) -> automatizado, no se envía', detectTraffic({ href: PROD, ua: UA, webdriver: true, store: mem() }).automated);
  t.check('UA HeadlessChrome / Playwright -> automatizado', detectTraffic({ href: PROD, ua: 'Mozilla/5.0 HeadlessChrome/140.0', store: mem() }).automated && detectTraffic({ href: PROD, ua: 'Playwright/1.64', store: mem() }).automated);
  t.check('build EXPO_PUBLIC_ANALYTICS_INTERNAL=ci -> automatizado; =1 -> interno sin cortar', detectTraffic({ href: PROD, ua: UA, store: mem(), buildFlag: 'ci' }).automated && JSON.stringify(detectTraffic({ href: PROD, ua: UA, store: mem(), buildFlag: '1' })) === '{"automated":false,"internal":true}');
  const s = mem();
  t.check('?internal=1 -> interno y queda guardado', detectTraffic({ href: PROD + '?internal=1', ua: UA, store: s }).internal && s.m.get(INTERNAL_KEY) === '1');
  t.check('carga siguiente sin query -> sigue interno', detectTraffic({ href: PROD, ua: UA, store: s }).internal);
  t.check('?internal=0 -> lo borra y deja de ser interno', !detectTraffic({ href: PROD + '?internal=0', ua: UA, store: s }).internal && !s.m.has(INTERNAL_KEY) && !detectTraffic({ href: PROD, ua: UA, store: s }).internal);
  t.check('localhost y previews *.vercel.app -> internos', detectTraffic({ href: 'http://localhost:8081/', ua: UA, store: mem() }).internal && detectTraffic({ href: 'https://meteorito-mvp-git-x-quantz4.vercel.app/', ua: UA, store: mem() }).internal);
  t.check('alias de producción meteorito-mvp.vercel.app -> NO interno', !detectTraffic({ href: 'https://meteorito-mvp.vercel.app/', ua: UA, store: mem() }).internal && !detectTraffic({ href: 'https://meteorito-mvp-git-main-quantz4.vercel.app/', ua: UA, store: mem() }).internal);
  const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } };
  t.check('storage bloqueado o URL rara -> sin excepción', detectTraffic({ href: PROD + '?internal=1', ua: UA, store: broken }).internal && !detectTraffic({ href: 'no es url', ua: null, store: broken }).internal);
  t.check('sin storage (nativo) -> usuario normal', !detectTraffic({ href: null, ua: null, webdriver: false, store: null }).internal);

  const src = readFileSync(new URL('../../lib/analytics.ts', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../../lib/internalTraffic.ts', import.meta.url), 'utf8');
  t.check('analytics: automatizado sale antes de cargar posthog y track() no envía', src.indexOf('if (traffic.automated) return;') > 0 && src.indexOf('if (traffic.automated) return;') < src.indexOf("import('posthog-js')") && /!POSTHOG_KEY \|\| traffic\.automated\) return;/.test(src));
  t.check('analytics: is_internal en cada evento (base, register y tras reset)', /is_internal: traffic\.internal \}\);/.test(src) && /posthog\.register\(\{ is_internal: traffic\.internal \}\)/.test(src) && /ph\.reset\(\);[^\n]*ph\.register\(\{ is_internal/.test(src));
  t.check('sin datos nuevos de personas: ni email, ni ids, ni $set, ni identify en el filtro', !/email|\$set|identify|distinct|sub\b/i.test(lib.replace(/^\s*\/\/.*$/gm, '')));
}
