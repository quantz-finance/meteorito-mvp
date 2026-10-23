// (42) UTMs del landing: first-touch guardado una vez, super propiedades, $set_once initial_utm_* y app_opened. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { ATTR_KEY, captureFirstTouch, identifyWithAttribution, parseAttribution, personSetOnce, readFirstTouch, registerAttribution, superProps } from '../../lib/attribution';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const LANDING = 'https://pago.meteorito.app/?utm_source=landing&utm_medium=cta&utm_content=hero';

export async function run(t: T) {
  const a = parseAttribution(LANDING, 'https://meteorito.com/precios?x=1');
  t.check('lee utm_source/medium/content del landing', a?.utm_source === 'landing' && a?.utm_medium === 'cta' && a?.utm_content === 'hero', JSON.stringify(a));
  t.check('referrer: solo el dominio, sin ruta ni query', a?.referring_domain === 'meteorito.com');
  t.check('utm_campaign y utm_term también', parseAttribution('https://pago.meteorito.app/?utm_campaign=lanz&utm_term=escrow')?.utm_campaign === 'lanz');
  t.check('sin UTMs ni referrer externo -> null', parseAttribution('https://pago.meteorito.app/vender', 'https://pago.meteorito.app/') === null);
  t.check('referrer propio (*.meteorito.app) no cuenta', parseAttribution('https://pago.meteorito.app/', 'https://www.meteorito.app/')?.referring_domain === undefined);
  t.check('ignora otros parámetros (tokens, etc.)', !JSON.stringify(parseAttribution('https://pago.meteorito.app/?utm_source=x&token=SECRETO&code=abc')).includes('SECRETO'));
  t.check('ruta de entrada sin slug', parseAttribution('https://pago.meteorito.app/p/abc123?utm_source=wa')?.landing_path === '/p/:id');
  t.check('limpia y acorta valores', (parseAttribution(`https://pago.meteorito.app/?utm_source=${'a'.repeat(300)}<x>`)?.utm_source ?? '').length === 100);

  const s = mem();
  const r1 = captureFirstTouch(s, LANDING, null, new Date('2026-10-22T00:00:00Z'));
  t.check('primera visita: guarda y marca isNew', r1.isNew && JSON.parse(s.m.get(ATTR_KEY)!).utm_content === 'hero');
  const r2 = captureFirstTouch(s, 'https://pago.meteorito.app/?utm_source=landing&utm_medium=cta&utm_content=gracias');
  t.check('visita posterior con otras UTMs: NO sobrescribe (first-touch)', !r2.isNew && r2.attr?.utm_content === 'hero' && readFirstTouch(s)?.utm_content === 'hero');
  const s2 = mem();
  t.check('visita sin UTMs: no guarda nada', captureFirstTouch(s2, 'https://pago.meteorito.app/').attr === null && s2.m.size === 0);
  t.check('luego llega con UTMs: se guarda', captureFirstTouch(s2, LANDING).isNew);
  t.check('sin storage: funciona para esta carga', captureFirstTouch(null, LANDING).attr?.utm_source === 'landing');
  const bad = mem(); bad.setItem(ATTR_KEY, '{roto');
  t.check('storage corrupto: se reemplaza por la nueva', captureFirstTouch(bad, LANDING).isNew);

  const sp = superProps(r1.attr), once = personSetOnce(r1.attr);
  t.check('super propiedades utm_*', sp.utm_source === 'landing' && sp.utm_content === 'hero' && !('captured_at' in sp));
  t.check('$set_once initial_utm_*', once.initial_utm_source === 'landing' && once.initial_utm_medium === 'cta' && once.initial_utm_content === 'hero');
  const calls: any[] = []; const ph = { register: (p: any) => calls.push(['register', p]), identify: (...x: any[]) => calls.push(['identify', ...x]) };
  registerAttribution(ph, r1.attr); identifyWithAttribution(ph, 'u_1', r1.attr);
  t.check('posthog.register con las UTMs', calls[0][0] === 'register' && calls[0][1].utm_source === 'landing');
  t.check('posthog.identify(id, undefined, $set_once)', calls[1][1] === 'u_1' && calls[1][2] === undefined && calls[1][3].initial_utm_content === 'hero');
  calls.length = 0; registerAttribution(ph, null); identifyWithAttribution(ph, 'u_2', null);
  t.check('sin atribución: no registra nada e identify simple', calls.length === 1 && calls[0].length === 2);

  const src = readFileSync(new URL('../../lib/analytics.ts', import.meta.url), 'utf8');
  t.check('analytics: captura antes de cargar posthog y no con opt-out', /if \(!optedOut\) \{[\s\S]*captureFirstTouch/.test(src) && src.indexOf('captureFirstTouch(') < src.indexOf("import('posthog-js')"));
  t.check('analytics: demo sale antes de capturar', src.indexOf('if (DEMO_ENABLED) return;') < src.indexOf('captureFirstTouch('));
  t.check('analytics: app_opened con las UTMs', /track\('app_opened', \{ \.\.\.superProps\(attr\)/.test(src));
  t.check('analytics: reset vuelve a registrar las super propiedades', /ph\.reset\(\); registerAttribution\(ph, attr\)/.test(src));
  t.check('analytics: privacidad intacta (ip:false, sin grabación, $current_url sin query)', /ip: false/.test(src) && /disable_session_recording: true/.test(src) && /p\.\$current_url = scrub/.test(src));
}
