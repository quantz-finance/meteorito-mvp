// (108) Límite de peticiones persistente (migración 037, api/_lib/rateLimit.ts).
//  - Contador en Postgres por (HMAC de ruta+IP, ventana fija): vale entre instancias de Vercel. Nunca guarda la IP.
//  - Rutas sensibles: crear link, pagar, PIN, enviar tx, activar, subir fotos, invitaciones, importar por link, accesos.
//  - Pasado el límite: 429 + Retry-After. Base caída, con error o lenta: deja pasar (fail-open) y lo registra.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { __setDbForTests, fail } from '../../api/_lib/db';
import { HttpError } from '../../api/_lib/auth';
import { LIMITS, RATE_LIMITED, rateKey, rateLimit } from '../../api/_lib/rateLimit';
import pay from '../../api/escrow/pay';
import store from '../../api/store/index';

const rd = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const KEY = 'e'.repeat(64);
function res() {
  const r: any = { code: 0, body: null as any, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; return r; };
  r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  return r;
}
/** Imita public.rate_limit_hit de 037 en memoria. */
function counterDb() {
  const hits = new Map<string, number>(); const calls: any[] = [];
  return { calls, hits, rpc: async (fn: string, a: any) => {
    calls.push({ fn, ...a });
    if (fn !== 'rate_limit_hit') return { data: null, error: { code: '42883' } };
    const n = (hits.get(a.p_key) ?? 0) + 1; hits.set(a.p_key, n);
    return { data: [{ allowed: n <= a.p_max, hit_count: n, retry_after_s: 42 }], error: null };
  }, from: () => { throw new HttpError(404, 'sin tablas en este test'); } };
}
const req = (ip: string, body: any) => ({ method: 'POST', headers: { 'x-forwarded-for': ip, 'x-guest-key': KEY }, body, query: {} });

export async function run(t: T) {
  // Migración: tabla sin IP, función atómica security definer, solo service_role, TTL + limpieza.
  const sql = rd('supabase/migrations/037_rate_limits.sql');
  t.check('037: tabla rate_limits con key HMAC (64 hex), sin columna de IP', /create table if not exists public\.rate_limits/.test(sql) && /\^\[0-9a-f\]\{64\}\$/.test(sql) && !/\bip\b\s+(text|inet)/i.test(sql));
  t.check('037: insert ... on conflict do update (atómico) en una función security definer con search_path fijo',
    /on conflict \(key, window_start\) do update set hits = r\.hits \+ 1/.test(sql) && /security definer/.test(sql) && /set search_path = public/.test(sql));
  t.check('037: anon/authenticated sin acceso; service_role ejecuta', /revoke all on public\.rate_limits from public, anon, authenticated/.test(sql)
    && /revoke all on function public\.rate_limit_hit\(text, integer, integer\) from public, anon, authenticated/.test(sql) && /grant execute .* to service_role/.test(sql));
  t.check('037: TTL corto (2 ventanas) + limpieza (oportunista y pg_cron)', /p_window_seconds \* 2/.test(sql) && /delete from public\.rate_limits where expires_at < now\(\)/.test(sql) && /cron\.schedule\('meteorito-rate-limits-gc'/.test(sql));

  // Cada ruta sensible llama al límite.
  const wants: [string, string][] = [['api/orders/create.ts', 'orders.create'], ['api/escrow/pay.ts', 'escrow.pay'], ['api/escrow/confirm.ts', 'escrow.pin'],
    ['api/tx/submit.ts', 'tx.submit'], ['api/wallet/activate.ts', 'wallet.activate'], ['api/photos/upload-url.ts', 'photos.upload'],
    ['api/invites/index.ts', 'invites.create'], ['api/store/index.ts', 'store.import'], ['api/store/index.ts', 'store.access']];
  const miss = wants.filter(([f, r]) => !rd(f).includes(`rateLimit(req, '${r}')`));
  t.check('las 9 rutas sensibles usan el límite persistente', miss.length === 0, miss.map((m) => m.join(':')).join(', '));

  // Llave: HMAC hex, sin la IP, distinta por ruta y por IP.
  const k1 = rateKey('escrow.pay', '203.0.113.7'), k2 = rateKey('escrow.pay', '203.0.113.8'), k3 = rateKey('orders.create', '203.0.113.7');
  t.check('llave = HMAC hex de 64, sin la IP, distinta por IP y por ruta', /^[0-9a-f]{64}$/.test(k1) && !k1.includes('203') && k1 !== k2 && k1 !== k3 && k1 === rateKey('escrow.pay', '203.0.113.7'));

  // Comportamiento con la base falsa: el hit 31 de la misma IP en /api/escrow/pay -> 429 + Retry-After.
  const fake = counterDb(); __setDbForTests(fake);
  try {
    const max = LIMITS['escrow.pay'].max; let last: any = null; let any429 = false;
    for (let i = 0; i < max; i++) { last = res(); await pay(req('198.51.100.1', { slug: 'abc123', step: 'start' }), last); if (last.code === 429) any429 = true; }
    t.check(`los primeros ${max} pagos de una IP no chocan con el límite`, !any429, String(last?.code));
    const over = res(); await pay(req('198.51.100.1', { slug: 'abc123', step: 'start' }), over);
    t.check('el siguiente -> 429 rate_limited + Retry-After', over.code === 429 && over.body?.code === 'rate_limited' && over.body?.error === RATE_LIMITED && over.headers['retry-after'] === '42' && over.body?.retryAfter === 42, JSON.stringify({ c: over.code, b: over.body, h: over.headers }));
    const other = res(); await pay(req('198.51.100.2', { slug: 'abc123', step: 'start' }), other);
    t.check('otra IP no se ve afectada', other.code !== 429, String(other.code));
    t.check('a la base solo llega el HMAC (nunca la IP)', fake.calls.every((c) => /^[0-9a-f]{64}$/.test(c.p_key) && !JSON.stringify(c).includes('198.51.100')));

    // Importar por link (store) también cuenta.
    for (let i = 0; i < LIMITS['store.import'].max; i++) await store(req('198.51.100.3', { action: 'import_listing', url: 'https://example.com/x' }), res());
    const imp = res(); await store(req('198.51.100.3', { action: 'import_listing', url: 'https://example.com/x' }), imp);
    t.check('importar por link: pasado el límite -> 429', imp.code === 429 && imp.body?.code === 'rate_limited', String(imp.code));
    const feed = res(); await store({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.3', 'x-guest-key': KEY }, body: { action: 'feed' }, query: {} }, feed);
    t.check('acciones no sensibles (feed) no cuentan', feed.code !== 429, String(feed.code));

    // Fail-open: error de la base, excepción y base lenta.
    __setDbForTests({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'no existe' } }) });
    let ok = true; try { await rateLimit(req('198.51.100.9', {}), 'escrow.pay', { max: 1, windowSec: 60 }); } catch { ok = false; }
    t.check('fail-open: la base responde error -> deja pasar', ok);
    __setDbForTests({ rpc: () => { throw new Error('red caída'); } });
    ok = true; try { await rateLimit(req('198.51.100.9', {}), 'escrow.pay'); } catch { ok = false; }
    t.check('fail-open: excepción -> deja pasar', ok);
    __setDbForTests({ rpc: () => new Promise(() => { /* nunca responde */ }) });
    const t0 = Date.now(); ok = true; try { await rateLimit(req('198.51.100.9', {}), 'escrow.pay'); } catch { ok = false; }
    t.check('fail-open: base lenta -> deja pasar en <= 2 s', ok && Date.now() - t0 < 2500, `${Date.now() - t0} ms`);
  } finally { __setDbForTests(null); }

  // fail(): 429 con retryAfter -> encabezado Retry-After; otros 429 sin cambio.
  const r = res(); fail(r, Object.assign(new HttpError(429, RATE_LIMITED), { code: 'rate_limited', retryAfter: 7.2 }));
  t.check('fail(): Retry-After redondeado hacia arriba', r.code === 429 && r.headers['retry-after'] === '8' && r.body.retryAfter === 8);
}
