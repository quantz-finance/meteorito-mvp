// (91) El texto del buscador de Comprar nunca sale a analítica, logs ni URLs: la gente escribe nombres o teléfonos.
//      feed_search manda solo el número de resultados y el largo; la búsqueda viaja por POST (body), nunca en el query
//      de /api/store (quedaría en los logs de Vercel y de la CDN); el servidor no registra el texto; PostHog sin autocapture.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const read = (f: string) => readFileSync(f, 'utf8');
const SECRET = 'Ana Mora 8888-1234';

export async function run(t: T) {
  // Cliente: ningún track/console/captureException lleva el texto.
  const files = ['components/Feed.tsx', 'components/SearchSheet.tsx', 'components/ComprarNav.tsx', 'lib/feedSearch.ts', 'lib/store.ts'];
  const leaks = files.flatMap((f) => [...read(f).matchAll(/(track|console\.\w+|captureException|captureMessage|posthog\.\w+)\(([^;]*)/g)]
    .filter((m) => /\b(q|text|query|search\.text)\b(?!_len)(?!\.length)/.test(m[2].replace(/'[^']*'/g, '')) && !/q_len: q\.length/.test(m[2]) ? true : /\btext\b/.test(m[2].replace(/'[^']*'/g, '')))
    .map((m) => `${f}: ${m[0].slice(0, 80)}`));
  t.check('sin el texto de búsqueda en track/console/Sentry/PostHog (solo largo y resultados)', leaks.length === 0, leaks.join(' | '));
  t.check('feed_search: results + q_len, sin q', /track\('feed_search', \{ results: [^}]*q_len: q\.length \}\)/.test(read('components/Feed.tsx')));
  const st = read('lib/store.ts');
  t.check('getFeed: el texto va en el body de un POST, nunca en el query de la URL', !/qs\.set\('q'/.test(st) && /method: 'POST'[^\n]*body: JSON\.stringify\(\{ action: 'feed'[^\n]*q: o\.q\.trim\(\)/.test(st));
  const an = read('lib/analytics.ts');
  t.check('PostHog: sin autocapture ni grabación, textos enmascarados, URL sin query', /autocapture: false/.test(an) && /disable_session_recording: true/.test(an) && /mask_all_text: true/.test(an) && /\$current_url = scrub/.test(an));

  // Servidor: búsqueda por POST sin cuenta ni llave -> 200, y el texto no aparece en ningún log.
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = []; db.tables.public_stores = [];
  const logs: string[] = []; const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) (console as any)[k] = (...a: any[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  try { await store({ method: 'POST', headers: {}, body: { action: 'feed', verified: 'all', q: SECRET }, query: {} }, r); }
  finally { Object.assign(console, orig); }
  t.check('POST feed con q sin llave ni sesión -> 200 privado (no se cachea)', r.code === 200 && Array.isArray(r.body?.items), `${r.code} ${JSON.stringify(r.body)}`);
  t.check('el servidor no registra el texto buscado', !logs.some((l) => l.includes('Ana Mora') || l.includes('8888')), logs.join(' | '));
  const rf: any = { code: 0, body: null }; rf.status = (c: number) => { rf.code = c; return rf; }; rf.setHeader = () => rf; rf.send = (b: string) => { rf.body = JSON.parse(b); return rf; };
  await store({ method: 'POST', headers: {}, body: { action: 'feed', view: 'following', verified: 'all' }, query: {} }, rf);
  t.check('Siguiendo sigue pidiendo identidad (401 sin llave)', rf.code === 401, `${rf.code}`);
}
