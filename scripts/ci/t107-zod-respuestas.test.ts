// (107) Validación de entrada con zod en TODOS los endpoints (body + query) y respuestas mínimas.
//  - Cada función de api/ llama validate(req, S.<endpoint>) al empezar.
//  - Tipos cambiados, textos enormes, listas largas o acción/paso fuera de la lista -> 400 genérico 'Solicitud inválida.'
//    (sin decir qué campo), antes de tocar la base o la red. Lo válido pasa igual (los demás tests cubren el negocio).
//  - Errores no previstos (base, red, bug) -> 500 genérico sin mensaje, código ni stack internos.
//  - /api/health: sin versiones ni node al público (solo con CRON_SECRET).
import type { T } from './setup';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { res } from './jwt';
import { fail, INTERNAL_ERROR, PAYEE_NOT_READY } from '../../api/_lib/db';
import { HttpError } from '../../api/_lib/auth';
import { BAD_REQUEST, S, check } from '../../api/_lib/validate';
import store from '../../api/store/index';
import pay from '../../api/escrow/pay';
import create from '../../api/orders/create';
import invites from '../../api/invites/index';
import confirm from '../../api/escrow/confirm';
import cron from '../../api/escrow/cron';
import health from '../../api/health';

const root = new URL('../../api/', import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === '_lib' ? [] : walk(p)) : f.endsWith('.ts') ? [p] : []; });
const KEY = 'd'.repeat(64);
const call = async (h: any, o: { method?: string; body?: any; query?: any; headers?: any }) => {
  const r = res(); await h({ method: o.method ?? 'POST', headers: { 'x-guest-key': KEY, ...(o.headers ?? {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};
const generic = (r: any) => r.code === 400 && r.body?.error === BAD_REQUEST && r.body?.code === 'bad_request' && Object.keys(r.body).length === 2;

export async function run(t: T) {
  const files = walk(root).filter((f) => /export default (async )?function handler/.test(readFileSync(f, 'utf8')));
  const missing = files.filter((f) => !/validate\(req, S\.\w+\)/.test(readFileSync(f, 'utf8')));
  t.check(`las ${files.length} funciones de api/ validan con zod al empezar`, files.length >= 12 && missing.length === 0, missing.map((f) => f.slice(root.length)).join(', '));

  // Entradas malformadas -> 400 genérico (antes de auth/DB: sin fakeDb, si llegara a la base fallaría distinto).
  let r = await call(store, { body: { action: 123 } });
  t.check('store: action no string -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(store, { body: { action: 'chat_send', token: 'x', body: 'a'.repeat(6000) } });
  t.check('store: mensaje de 6000 caracteres -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(store, { method: 'GET', query: { feed: '1', q: 'x'.repeat(5000) } });
  t.check('store GET: búsqueda enorme -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(store, { method: 'GET', query: { store: ['a', 'b', 'c', 'd', 'e', 'f'] } });
  t.check('store GET: parámetro repetido 6 veces -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(pay, { body: { slug: 'abc123', step: 'drop_table' } });
  t.check('pay: step fuera de la lista -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(pay, { body: { slug: { $ne: null }, step: 'start' } });
  t.check('pay: slug objeto -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(create, { body: { title: 'x'.repeat(300), price_crc: 5000, photos: ['a'] } });
  t.check('crear link: título de 300 -> 400 genérico (antes de pedir sesión)', generic(r), JSON.stringify(r.body));
  r = await call(create, { body: { title: 'Bici', price_crc: 5000, photos: Array(30).fill('x') } });
  t.check('crear link: 30 fotos -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(invites, { method: 'GET', query: { code: 'x'.repeat(100) } });
  t.check('invitación GET: código enorme -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(confirm, { body: { slug: 'abc123', reason: 'pin', pin: { a: 1 } } });
  t.check('PIN objeto -> 400 genérico', generic(r), JSON.stringify(r.body));
  r = await call(cron, { method: 'GET', query: { slug: 'x'.repeat(200) } });
  t.check('cron: slug enorme -> 400 genérico', generic(r), JSON.stringify(r.body));
  t.check('lo válido pasa (check devuelve el mismo valor)', check(S.escrowPay.body, { slug: 'abc123', step: 'start', extra: 1 }).extra === 1);

  // 500 genérico
  const r1 = res(); fail(r1, Object.assign(new Error('relation "orders" does not exist at /var/task/api/_lib/db.js:12'), { code: '42P01', stack: 'Error: ...\n    at x (/var/task/a.js:1:1)' }));
  t.check('error de base -> 500 genérico sin mensaje, código ni stack', r1.code === 500 && r1.body?.error === INTERNAL_ERROR && r1.body?.code === 'internal' && !/orders|42P01|var\/task|at /.test(JSON.stringify(r1.body)), JSON.stringify(r1.body));
  const r2 = res(); fail(r2, new Error('TW /deployer/single-release 400: {"message":"trustline missing"}'));
  t.check('Trustless Work rechaza por trustline -> 502 con mensaje para la persona (sin el detalle)', r2.code === 502 && r2.body?.error === PAYEE_NOT_READY && !/TW|trustline|deployer/.test(JSON.stringify(r2.body)), JSON.stringify(r2.body));
  const r3 = res(); fail(r3, Object.assign(new HttpError(409, 'Ya calificaste este pedido.'), { code: 'already_rated' }));
  t.check('HttpError conserva su mensaje y código', r3.code === 409 && r3.body?.error === 'Ya calificaste este pedido.' && r3.body?.code === 'already_rated');

  // health mínimo
  process.env.CRON_SECRET ||= 'ci-cron';
  let h = await call(health, { method: 'GET' });
  t.check('/api/health público: sin versiones, node ni qué cargó', h.code === 200 && h.body?.ok === true && !('versions' in h.body) && !('node' in h.body) && !('loaded' in h.body) && typeof h.body?.config?.autoReleaseMinutes === 'number' && 'platformMatches' in (h.body?.config?.walletActivation ?? {}) && !('missing' in h.body.config.walletActivation), JSON.stringify(h.body));
  h = await call(health, { method: 'GET', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  t.check('/api/health con CRON_SECRET: diagnóstico completo', !!h.body?.versions?.['@stellar/stellar-sdk'] && typeof h.body?.node === 'string', JSON.stringify(h.body).slice(0, 200));
}
