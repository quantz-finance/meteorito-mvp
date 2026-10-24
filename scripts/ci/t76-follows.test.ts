// (76) Seguir vendedores: seguir / dejar de seguir con cuenta o con la llave del dispositivo, un par único, anti-spam
//      (por minuto e IP, tope total), privado (solo el número de seguidores, nunca quién), sin la migración 022 no rompe,
//      y aviso push a los seguidores cuando el vendedor publica un producto permanente (con enfriamiento). Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __resetFollowLimits, FOLLOW_PER_MIN, followerMessages, followRateLimited, notifyFollowers } from '../../api/_lib/follows';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const call = async (o: { method?: string; body?: any; query?: any; guest?: string; tok?: string; ip?: string }) => {
  const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.ip ? { 'x-forwarded-for': o.ip } : {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  __resetFollowLimits();
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [
    { sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria', created_at: '2026-09-01T00:00:00Z' },
    { sub: 'seller2', store_slug: 'jose-games', display_name: 'José Games', created_at: '2026-09-01T00:00:00Z' },
  ];
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0 }]; db.tables.public_store_items = [];
  const guestA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;

  // Sin la migración 022: seguir -> 503 claro; perfil sin número (null); "a quién sigo" vacío.
  const realFrom = db.from;
  const missingQ: any = new Proxy({}, { get: (_o, k) => k === 'then' ? (res: any) => res({ data: null, error: { code: '42P01', message: 'relation "seller_follows" does not exist' } }) : () => missingQ });
  (db as any).from = (t2: string) => (t2 === 'seller_follows' ? missingQ : realFrom(t2));
  let r = await call({ guest: KEY_A, body: { action: 'follow', store_slug: 'valeria' } });
  t.check('sin 022: seguir -> 503 follows_unavailable', r.code === 503 && r.body?.code === 'follows_unavailable', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ method: 'GET', query: { profile: 'valeria' } });
  t.check('sin 022: el perfil carga y followers = null (la app no lo muestra)', r.code === 200 && r.body?.followers === null, `${r.code} ${r.body?.followers}`);
  r = await call({ guest: KEY_A, body: { action: 'following' } });
  t.check('sin 022: following -> []', r.code === 200 && Array.isArray(r.body?.store_slugs) && r.body.store_slugs.length === 0, JSON.stringify(r.body));
  (db as any).from = realFrom;

  // Con la tabla.
  r = await call({ body: { action: 'follow', store_slug: 'valeria' } });
  t.check('sin llave ni sesión -> 401', r.code === 401, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'follow', store_slug: 'no-existe' } });
  t.check('vendedor inexistente -> 404', r.code === 404, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'follow', store_slug: '../x' } });
  t.check('usuario inválido -> 400', r.code === 400, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'follow', store_slug: 'valeria' } });
  t.check('invitado sigue con la llave del dispositivo (hash, no la llave)', r.code === 200 && r.body?.following === true && r.body?.followers === 1
    && db.tables.seller_follows.length === 1 && db.tables.seller_follows[0].follower_id === guestA && !JSON.stringify(db.tables.seller_follows).includes(KEY_A), JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'follow', store_slug: 'valeria' } });
  t.check('seguir dos veces no duplica (índice único)', r.code === 200 && db.tables.seller_follows.length === 1 && r.body?.followers === 1, `${db.tables.seller_follows.length}`);
  const tokA = await token({ sub: 'buyer-cuenta' });
  r = await call({ tok: tokA, guest: KEY_B, body: { action: 'follow', store_slug: 'valeria' } });
  t.check('con cuenta se sigue con la cuenta (todos sus dispositivos)', r.code === 200 && db.tables.seller_follows.some((f: any) => f.follower_id === 'buyer-cuenta') && r.body?.followers === 2, JSON.stringify(db.tables.seller_follows));
  r = await call({ tok: await token({ sub: 'seller1' }), body: { action: 'follow', store_slug: 'valeria' } });
  t.check('no puedes seguir tu propia tienda -> 400', r.code === 400 && r.body?.code === 'self_follow', `${r.code}`);

  r = await call({ guest: KEY_A, body: { action: 'following' } });
  t.check('following: solo usuarios de tienda que sigo YO (nunca subs)', r.code === 200 && JSON.stringify(r.body) === '{"store_slugs":["valeria"]}', JSON.stringify(r.body));
  r = await call({ method: 'GET', query: { profile: 'valeria' } });
  const txt = JSON.stringify(r.body);
  t.check('perfil público: solo el número de seguidores, nunca quiénes', r.code === 200 && r.body?.followers === 2 && !txt.includes(guestA) && !txt.includes('buyer-cuenta') && !/follower_id|"follows"/.test(txt), txt.slice(0, 200));

  r = await call({ guest: KEY_A, body: { action: 'unfollow', store_slug: 'valeria' } });
  t.check('dejar de seguir', r.code === 200 && r.body?.following === false && r.body?.followers === 1, JSON.stringify(r.body));
  r = await call({ guest: KEY_B, body: { action: 'unfollow', store_slug: 'valeria' } });
  t.check('dejar de seguir solo borra lo mío (otra llave no toca la cuenta)', r.code === 200 && r.body?.followers === 1, JSON.stringify(r.body));

  // Anti-spam: por minuto por identidad y por IP sin cuenta; tope total en la base (trigger) -> 429 claro.
  __resetFollowLimits();
  const now = 1_000_000;
  let blocked = false; for (let i = 0; i < FOLLOW_PER_MIN; i++) blocked ||= followRateLimited('x', now);
  t.check(`límite por minuto: ${FOLLOW_PER_MIN} pasan, el siguiente no; al minuto se libera`, !blocked && followRateLimited('x', now) && !followRateLimited('x', now + 61_000));
  __resetFollowLimits();
  let last: any = null; for (let i = 0; i < FOLLOW_PER_MIN + 1; i++) last = await call({ guest: KEY_A, body: { action: i % 2 ? 'unfollow' : 'follow', store_slug: 'jose-games' } });
  t.check('API: ráfaga de seguir/dejar de seguir -> 429 follow_rate_limited', last.code === 429 && last.body?.code === 'follow_rate_limited', `${last.code}`);
  __resetFollowLimits();
  const ins = db.from; (db as any).from = (t2: string) => { const q = ins(t2); if (t2 === 'seller_follows') { const i0 = q.insert; q.insert = () => { i0({}); return { then: (res: any) => res({ data: null, error: { code: 'P0001', message: 'follow_limit' } }) }; }; } return q; };
  r = await call({ guest: KEY_B, body: { action: 'follow', store_slug: 'jose-games' } });
  t.check('tope total (trigger de 022) -> 429 follow_limit con mensaje claro', r.code === 429 && r.body?.code === 'follow_limit' && /500/.test(r.body?.error ?? ''), JSON.stringify(r.body));
  (db as any).from = ins;

  // Push a seguidores cuando el vendedor publica (solo productos permanentes, enfriamiento por vendedor).
  const msgs = followerMessages({ display_name: 'Valeria' }, { slug: 'abc123', title: 'Cámara Canon' }, ['f1', 'f1', 'seller1', 'f2'], 'seller1');
  t.check('aviso: uno por seguidor (sin duplicados ni al propio vendedor), tuteo, link al producto',
    msgs.length === 2 && msgs[0].title === 'Valeria publicó algo nuevo' && msgs[0].body === 'Cámara Canon. Ábrelo para verlo.' && msgs[0].url === '/p/abc123' && msgs.every((m) => m.tag === 'follow:seller1'), JSON.stringify(msgs[0]));
  db.tables.seller_follows = [{ id: 1, follower_id: 'f1', seller_user_id: 'seller1', created_at: '2026-10-20T00:00:00Z' }, { id: 2, follower_id: guestA, seller_user_id: 'seller1', created_at: '2026-10-21T00:00:00Z' }];
  db.tables.push_subscriptions = [];
  const sent: string[] = [];
  const deps = { enabled: () => true, load: async (ids: string[]) => ids.map((id) => ({ endpoint: `https://push/${id}`, user_id: id, p256dh: 'p', auth: 'a' })), send: async (s: any) => { sent.push(s.user_id); return 201; }, now: Date.parse('2026-10-22T12:00:00Z') };
  db.tables.orders = [{ slug: 'nuevo1', kind: 'listing', seller_user_id: 'seller1', created_at: '2026-10-22T12:00:00Z' }];
  let n = await notifyFollowers('seller1', { slug: 'nuevo1', title: 'Bici' }, deps);
  t.check('publicar un producto avisa a cada seguidor (cuenta o dispositivo)', n === 2 && sent.sort().join() === [guestA, 'f1'].sort().join(), `${n} ${sent}`);
  db.tables.orders.push({ slug: 'nuevo2', kind: 'listing', seller_user_id: 'seller1', created_at: '2026-10-22T13:00:00Z' });
  n = await notifyFollowers('seller1', { slug: 'nuevo2', title: 'Casco' }, { ...deps, now: Date.parse('2026-10-22T13:00:00Z') });
  t.check('anti-spam: otro producto a la hora -> sin aviso (enfriamiento 3 h)', n === 0, `${n}`);
  n = await notifyFollowers('seller1', { slug: 'nuevo2', title: 'Casco' }, { ...deps, enabled: () => false });
  t.check('sin push configurado (VAPID) -> no hace nada ni consulta', n === 0);
  const create = readFileSync(new URL('../../api/orders/create.ts', import.meta.url), 'utf8');
  t.check('create: avisa a seguidores solo con productos permanentes (kind listing)', /if \(kind === 'listing'\) await notifyFollowers\(/.test(create));

  // UI: botón en el perfil y en la tarjeta del feed; copy en tuteo, sin palabras prohibidas; el dueño no se ve el botón.
  const prof = readFileSync(new URL('../../app/t/[store].tsx', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../../components/Feed.tsx', import.meta.url), 'utf8');
  const btn = readFileSync(new URL('../../components/FollowButton.tsx', import.meta.url), 'utf8');
  t.check('perfil: botón Seguir (no para el dueño) + número de seguidores', /!owner \? <View[^>]*>\s*<FollowButton store=\{p\} source="profile"/.test(prof) && /testID="followers-count"/.test(prof));
  t.check('feed: botón Seguir compacto en la tarjeta', /<FollowButton store=\{it\.seller\} source="feed" size="sm"/.test(feed));
  t.check('botón: Seguir / Siguiendo desde lib/copy.ts, con ícono (sin emojis) y estado accesible', COPY.follow.follow === 'Seguir' && COPY.follow.following === 'Siguiendo'
    && /COPY\.follow\.following : COPY\.follow\.follow/.test(btn) && /<Icon name=\{on \? 'checkmark' : 'add'\}/.test(btn) && /accessibilityState=\{\{ selected: on/.test(btn) && !/\p{Extended_Pictographic}/u.test(btn));
  const flat = JSON.stringify(Object.values(COPY.follow).map((v: any) => typeof v === 'function' ? `${v(1)} ${v(2)} ${v('Ana')}` : v));
  t.check('copy de seguir sin palabras prohibidas', !BANNED_COPY.test(flat), flat);
  const mig = readFileSync(new URL('../../supabase/migrations/022_seller_follows.sql', import.meta.url), 'utf8');
  t.check('migración 022 idempotente, índice único, RLS sin grants públicos', /create table if not exists public\.seller_follows/.test(mig) && /create unique index if not exists/.test(mig)
    && /enable row level security/.test(mig) && /revoke all on public\.seller_follows from anon, authenticated/.test(mig) && /drop trigger if exists/.test(mig) && !/grant select on public\.seller_follows/.test(mig));
}
