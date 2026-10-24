// (62) Reseñas: solo el comprador de una compra LIBERADA, 1-5 estrellas + comentario opcional (máx. 280, sin links) +
//      nombre corto opcional, una por pedido; anti-fraude entre las mismas cuentas (30 días, máx. 3, sin auto-reseña); el perfil público las muestra sin datos del comprador. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { cleanReviewComment, REVIEW_PAIR_MAX, REVIEW_PAIR_WINDOW_DAYS, shortBuyerName } from '../../api/_lib/store';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64), KEY_C = 'c'.repeat(64), KEY_D = 'd'.repeat(64);
const call = async (o: { method?: string; body?: any; query?: any; guest?: string; tok?: string }) => {
  const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  t.check('nombre corto: "María José Rodríguez" -> "María R."; uno solo -> tal cual; vacío -> null', shortBuyerName('  maría josé RODRÍGUEZ ') === 'María R.' && shortBuyerName('Diego') === 'Diego' && shortBuyerName('  ') === null && !/[<>]/.test(shortBuyerName('<b>x</b>') ?? ''), `${shortBuyerName('  maría josé RODRÍGUEZ ')} ${shortBuyerName('<b>x</b>')}`);
  t.check('comentario: recorta espacios, vacío -> null, >280 -> error, links -> error', cleanReviewComment('  Todo   bien \n ') === 'Todo bien' && cleanReviewComment('') === null
    && cleanReviewComment('x'.repeat(281)) === 'too_long' && cleanReviewComment('mira www.spam.com') === 'link' && cleanReviewComment('https://x.co') === 'link');

  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  const buyerA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  const buyerOf = (k: string) => guestSubFromReq({ headers: { 'x-guest-key': k } })!;
  const W_A = 'G'.padEnd(56, 'B'), W_B = 'G'.padEnd(56, 'C'), W_C = 'G'.padEnd(56, 'D'), W_SELLER = 'G'.padEnd(56, 'A');
  const order = (slug: string, status: string, buyer = buyerA, wallet = W_A) => ({ id: `id-${slug}`, slug, status, seller_user_id: 'seller1', buyer_user_id: buyer, buyer_address: wallet, seller_address: W_SELLER });
  db.tables.orders.push(order('rev001', 'liberado'), order('rev002', 'entregado'), order('rev003', 'liberado', buyerOf(KEY_B), W_B), order('rev004', 'liberado', buyerOf(KEY_C), W_C),
    order('rev005', 'liberado'), order('rev006', 'liberado', buyerOf(KEY_D), W_A), order('rev007', 'liberado', buyerOf(KEY_D), W_SELLER), order('rev008', 'liberado'), order('rev009', 'liberado'));
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria', created_at: '2026-09-01T00:00:00Z' }];
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0 }]; db.tables.public_store_items = [];

  let r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev002', stars: 5 } });
  t.check('pedido Entregado (aún sin liberar) -> 409 not_ratable', r.code === 409 && r.body?.code === 'not_ratable', `${r.code}`);
  r = await call({ guest: KEY_B, body: { action: 'rate', slug: 'rev001', stars: 5, comment: 'Hola' } });
  t.check('otro comprador -> 403', r.code === 403, `${r.code}`);
  r = await call({ tok: await token({ sub: 'seller1' }), body: { action: 'rate', slug: 'rev001', stars: 5 } });
  t.check('el vendedor no puede reseñarse -> 403', r.code === 403, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev001', stars: 5, comment: 'Compra en www.otro.com' } });
  t.check('comentario con link -> 400 y no se guarda nada', r.code === 400 && r.body?.code === 'bad_comment' && !(db.tables.seller_ratings ?? []).length, `${r.code} ${r.body?.code}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev001', stars: 5, comment: 'x'.repeat(300) } });
  t.check('comentario de más de 280 -> 400', r.code === 400 && r.body?.code === 'bad_comment', `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev001', stars: 5, comment: '  Todo perfecto,  igual a las fotos. ', buyer_name: 'maría rodríguez' } });
  const row = db.tables.seller_ratings?.[0];
  t.check('comprador de una compra liberada: 5 estrellas + comentario + nombre corto -> 200', r.code === 200 && row?.stars === 5 && row?.comment === 'Todo perfecto, igual a las fotos.' && row?.buyer_name === 'María R.' && r.body?.store_slug === 'valeria', `${r.code} ${JSON.stringify(row)} ${JSON.stringify(r.body)}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev001', stars: 1, comment: 'cambio' } });
  t.check('una por pedido: la segunda -> 409 already_rated', r.code === 409 && r.body?.code === 'already_rated' && db.tables.seller_ratings.length === 1, `${r.code}`);
  r = await call({ guest: KEY_B, body: { action: 'rate', slug: 'rev003', stars: 3 } });
  t.check('solo estrellas (comentario y nombre opcionales) -> 200 con null', r.code === 200 && db.tables.seller_ratings[1].comment === null && db.tables.seller_ratings[1].buyer_name === null, JSON.stringify(db.tables.seller_ratings[1]));

  // Sin la migración 018: las estrellas se guardan igual (sin comentario), nunca 500.
  const orig = db.from; const colErr = { code: 'PGRST204', message: "Could not find the 'comment' column of 'seller_ratings' in the schema cache" };
  (db as any).from = (tb: string) => { const q = orig(tb); const ins = q.insert; q.insert = (p: any) => (tb === 'seller_ratings' && p && 'comment' in p ? Object.assign(q, { then: (ok: any) => Promise.resolve({ data: null, error: colErr }).then(ok) }) : ins(p)); return q; };
  r = await call({ guest: KEY_C, body: { action: 'rate', slug: 'rev004', stars: 4, comment: 'bien' } });
  t.check('sin migración 018: guarda las estrellas (200) sin romper', r.code === 200 && db.tables.seller_ratings.length === 3 && db.tables.seller_ratings[2].stars === 4, `${r.code} ${JSON.stringify(r.body)}`);
  (db as any).from = orig;

  // Anti-fraude: ventas repetidas entre las mismas cuentas no suman reseñas.
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev005', stars: 5 } });
  t.check('mismo comprador, otra compra liberada al mismo vendedor en < 30 días -> 429 review_limit', r.code === 429 && r.body?.code === 'review_limit' && db.tables.seller_ratings.length === 3, `${r.code} ${r.body?.code}`);
  r = await call({ guest: KEY_D, body: { action: 'rate', slug: 'rev006', stars: 5 } });
  t.check('otra llave de invitado pero la misma dirección Stellar -> 429 review_limit', r.code === 429 && r.body?.code === 'review_limit', `${r.code} ${r.body?.code}`);
  r = await call({ guest: KEY_D, body: { action: 'rate', slug: 'rev007', stars: 5 } });
  t.check('comprador con la misma dirección Stellar que el vendedor -> 403 self_review', r.code === 403 && r.body?.code === 'self_review', `${r.code} ${r.body?.code}`);
  db.tables.seller_ratings[0].created_at = new Date(Date.now() - 40 * 86400e3).toISOString();
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev005', stars: 4 } });
  t.check('pasados 30 días el mismo comprador puede volver a reseñar -> 200', r.code === 200, `${r.code} ${r.body?.code}`);
  db.tables.seller_ratings.forEach((x: any) => { x.created_at = new Date(Date.now() - 400 * 86400e3).toISOString(); });
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev008', stars: 4 } });
  t.check('tercera reseña del mismo comprador (años después) -> 200', r.code === 200, `${r.code} ${r.body?.code}`);
  db.tables.seller_ratings.forEach((x: any) => { x.created_at = new Date(Date.now() - 800 * 86400e3).toISOString(); });
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'rev009', stars: 5 } });
  t.check(`máximo ${REVIEW_PAIR_MAX} reseñas en total entre el mismo comprador y vendedor -> 429`, r.code === 429 && r.body?.code === 'review_limit' && REVIEW_PAIR_MAX === 3 && REVIEW_PAIR_WINDOW_DAYS === 30, `${r.code}`);

  r = await call({ method: 'GET', query: { profile: 'valeria' } });
  const rv = r.body?.reviews ?? [];
  const txt = JSON.stringify(r.body);
  t.check('perfil público: comentario y nombre corto visibles', rv.some((x: any) => x.comment === 'Todo perfecto, igual a las fotos.' && x.buyer_name === 'María R.'), JSON.stringify(rv));
  t.check('perfil público: sin id del comprador ni pedido', !/guest:|rev00|buyer_user_id|order_/.test(txt), txt.slice(0, 200));

  const page = readFileSync(new URL('../../app/p/[slug].tsx', import.meta.url), 'utf8');
  t.check('pantalla del pedido: reseña solo con el pedido liberado, evento review_submitted sin el texto', /const RATABLE = \['liberado'\]/.test(page) && /track\('review_submitted', \{[^}]*stars/.test(page) && !/track\('review_submitted', \{[^}]*[\s{,](comment|buyer_name|name):/.test(page));
  t.check('campos de la reseña con letra >= 16 px', /reviewInput: \{[^}]*fontSize: (1[6-9]|2\d)/.test(page));
}
