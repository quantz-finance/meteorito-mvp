// (86) Seguidores privados: quien entra a una tienda (/t/<usuario>) NUNCA ve quiénes la siguen (ni nombres, ni fotos, ni
//      identificadores, ni una lista). Solo el NÚMERO de seguidores, como texto que no se toca. Tampoco el dueño recibe la
//      lista. El feed sigue mostrando las ventas cerradas ("X le vendió a Y") como antes. Sin red.
import type { T } from './setup';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __resetFollowLimits } from '../../api/_lib/follows';
import { isSale, mixFeed, saleHeadline } from '../../lib/feedSales';
import { DEMO_SALES } from '../../api/_lib/demoSales';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const call = async (o: { method?: string; body?: any; query?: any; guest?: string; tok?: string }) => {
  const r: any = { code: 0, body: null, raw: '' }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.raw = b; try { r.body = JSON.parse(b); } catch { r.body = null; } return r; };
  r.end = (b?: string) => { r.raw = String(b ?? ''); return r; };
  await store({ method: o.method ?? 'GET', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  __resetFollowLimits();
  const db = fakeDb(); __setDbForTests(db as any);
  const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  // Quien sigue también es vendedor (tiene nombre y foto propios): ninguno de esos datos puede aparecer en la tienda que sigue.
  db.tables.seller_profiles = [
    { sub: 'sub-tienda', store_slug: 'valeria', display_name: 'Valeria', verified: true, created_at: at(900) },
    { sub: 'sub-seguidora-secreta', store_slug: 'fulanasecreta', display_name: 'Fulana Secreta', avatar_url: 'https://x/avatar-fulana.jpg', verified: false, created_at: at(900) },
  ];
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0 }];
  db.tables.public_store_items = [{ store_slug: 'valeria', slug: 'abc123', title: 'Bici', price_crc: 10000, photo: null, created_at: at(2) }];
  db.tables.orders = [{ id: 'o1', slug: 'abc123', kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null, seller_user_id: 'sub-tienda', brand: '', model: 'Bici de montaña',
    description: 'Descripción completa del producto en buen estado', price_crc: 10000, photos: ['https://x/1.jpg'], created_at: at(2) }];
  const KEY = '9'.repeat(64); const guestSub = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
  const tokFan = await token({ sub: 'sub-seguidora-secreta' });

  let r = await call({ method: 'POST', tok: tokFan, body: { action: 'follow', store_slug: 'valeria' } });
  t.check('seguir responde solo { following, followers:número }', r.code === 200 && JSON.stringify(Object.keys(r.body ?? {}).sort()) === '["followers","following"]' && r.body.followers === 1, JSON.stringify(r.body));
  r = await call({ method: 'POST', guest: KEY, body: { action: 'follow', store_slug: 'valeria' } });
  t.check('seguir sin cuenta: tampoco devuelve quién más sigue', r.code === 200 && r.body.followers === 2 && !r.raw.includes('sub-seguidora-secreta') && !r.raw.includes('Fulana'), r.raw);

  // Cualquier respuesta pública: ningún rastro de quién sigue.
  const SECRETS = ['sub-seguidora-secreta', 'Fulana Secreta', 'fulanasecreta', 'avatar-fulana', guestSub, KEY];
  const leaks = (raw: string) => SECRETS.filter((s) => raw.includes(s)).concat(/follower_id|"follows"|"followers_list"|"follower_ids"|"seguidores"/.test(raw) ? ['campo de seguidores'] : []);
  const pub: [string, any][] = [
    ['GET ?profile (perfil público /t/<usuario>)', { query: { profile: 'valeria' } }],
    ['GET ?store (tienda pública)', { query: { store: 'valeria' } }],
    ['GET ?og (vista previa al compartir)', { query: { og: 'valeria' } }],
    ['GET ?feed (Comprar)', { query: { feed: '1', order: 'rank', verified: 'all', limit: '20' } }],
    ['GET ?seller_of (ficha del producto)', { query: { seller_of: 'abc123' } }],
    ['POST feed (personalizado, de otra persona)', { method: 'POST', guest: '7'.repeat(64), body: { action: 'feed', verified: 'all', limit: '20' } }],
    ['POST following (de otra persona)', { method: 'POST', guest: '7'.repeat(64), body: { action: 'following' } }],
  ];
  for (const [name, o] of pub) {
    r = await call(o);
    const l = leaks(r.raw);
    t.check(`${name}: sin identidades de seguidores`, r.code === 200 && l.length === 0, `${r.code} ${l.join(', ')} ${r.raw.slice(0, 160)}`);
  }
  r = await call({ query: { profile: 'valeria' } });
  t.check('perfil: el número de seguidores se queda (entero), nada más sobre seguidores', r.body?.followers === 2 && Number.isInteger(r.body.followers)
    && Object.keys(r.body).filter((k) => /follow|seguid/i.test(k)).join() === 'followers', Object.keys(r.body ?? {}).join());

  // El dueño de la tienda tampoco recibe la lista de quién lo sigue.
  const tokOwner = await token({ sub: 'sub-tienda' });
  r = await call({ method: 'POST', tok: tokOwner, body: { action: 'me' } });
  t.check('dueño (POST me): sin lista de seguidores', r.code === 200 && leaks(r.raw).length === 0, `${r.code} ${leaks(r.raw).join(', ')}`);
  r = await call({ method: 'POST', tok: tokOwner, body: { action: 'following' } });
  t.check('dueño (POST following): solo a quién sigue ÉL, no quién lo sigue', r.code === 200 && JSON.stringify(r.body) === '{"store_slugs":[]}', r.raw);
  r = await call({ method: 'POST', tok: tokFan, body: { action: 'following' } });
  t.check('quien sigue sí ve a quién sigue (solo lo suyo)', r.code === 200 && JSON.stringify(r.body) === '{"store_slugs":["valeria"]}', r.raw);

  // Servidor: la única lectura de seguidores de un vendedor que sale de follows.ts es el conteo (head) y el aviso push (interno).
  const lib = readFileSync(new URL('../../api/_lib/follows.ts', import.meta.url), 'utf8');
  const bySeller = lib.match(/from\('seller_follows'\)\.select\([^)]*\)[^;]*eq\('seller_user_id'/g) ?? [];
  t.check('servidor: por vendedor solo se cuenta (head) o se avisa por push; nunca se devuelve la lista',
    bySeller.length === 2 && bySeller.some((x) => /select\('id', \{ count: 'exact', head: true \}\)/.test(x)) && bySeller.some((x) => /select\('follower_id'\)/.test(x))
    && /export async function notifyFollowers[\s\S]*Promise<number>/.test(lib), bySeller.join(' | '));

  // UI: el número es texto (no se toca, no abre nada) y no existe ninguna pantalla o componente con la lista.
  const prof = readFileSync(new URL('../../app/t/[store].tsx', import.meta.url), 'utf8');
  const line = prof.split('\n').find((l) => l.includes('testID="followers-count"')) ?? '';
  t.check('tienda: "N seguidores" es texto, no se puede tocar', /<Text style=\{T\.footnote\} testID="followers-count">/.test(line) && !/Pressable|onPress|href|Link|router|accessibilityRole="(button|link)"/.test(line), line.trim().slice(0, 200));
  const files: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p); } };
  for (const d of ['app', 'components', 'lib']) walk(new URL(`../../${d}`, import.meta.url).pathname);
  const offenders = files.filter((f) => /seguidores|followers/i.test(f.split('/').pop()!) || /followers_list|follower_ids|followerList|FollowersList|FollowerList/.test(readFileSync(f, 'utf8')));
  t.check('app: ninguna pantalla ni componente con la lista de seguidores', offenders.length === 0, offenders.join());

  // El feed sigue mostrando las ventas cerradas ("X le vendió a Y") como parte del feed.
  const mixed = mixFeed(Array.from({ length: 10 }, (_, i) => ({ slug: `p${i}` })), 'all', '', DEMO_SALES);
  t.check('feed: las ventas cerradas siguen mezcladas (1 de cada 6) con quién le compró a quién', mixed.filter(isSale).length === 2 && /le vendió a/.test(saleHeadline(DEMO_SALES[0])) && DEMO_SALES.every((s) => !!s.buyer_name));
  const feed = readFileSync(new URL('../../components/Feed.tsx', import.meta.url), 'utf8');
  t.check('feed: la tarjeta de venta cerrada se sigue pintando', /isSale\(item\) \? <SaleCard post=\{item\}/.test(feed) && /\{saleHeadline\(p\)\}/.test(feed));
}
