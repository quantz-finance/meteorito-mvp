// (46) Foto de la tienda (solo el dueño, solo una imagen subida a SU carpeta del bucket) + navegación de 3 pestañas
//      (Vender, Comprar, Pedidos; sin Inicio; "/" -> Vender). Sin red.
import type { T } from './setup';
import { existsSync, readFileSync } from 'node:fs';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { avatarUrlOf } from '../../api/_lib/store';
import { publicPrefix } from '../../api/_lib/photos';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const call = async (o: { method?: string; body?: any; query?: any; tok?: string }) => {
  const r = res(); await store({ method: o.method ?? 'POST', headers: o.tok ? { authorization: `Bearer ${o.tok}` } : {}, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  process.env.SUPABASE_URL ??= 'https://ejvsvvqqcetgwxrenmdy.supabase.co';
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria' }, { sub: 'seller2', store_slug: 'otro', display_name: 'Otro' }];
  const mine = `${publicPrefix('seller1')}0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/0.jpg`;
  const theirs = `${publicPrefix('seller2')}0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/0.jpg`;
  const tok1 = await token({ sub: 'seller1' });

  let r = await call({ body: { action: 'update', avatar_url: mine } });
  t.check('sin sesión -> 401', r.code === 401, `${r.code}`);
  r = await call({ tok: tok1, body: { action: 'update', avatar_url: theirs } });
  t.check('foto en la carpeta de OTRO vendedor -> 400, no se guarda', r.code === 400 && !db.tables.seller_profiles[0].avatar_url, `${r.code}`);
  for (const [why, url] of [['dominio externo', 'https://evil.example/x.jpg'], ['no es imagen (.svg)', mine.replace('0.jpg', '0.svg')], ['ruta con ..', mine.replace('0b1c2d3e', '../seller2/0b1c2d3e')], ['data URL', 'data:image/png;base64,AAAA'], ['no string', 42]] as const) {
    r = await call({ tok: tok1, body: { action: 'update', avatar_url: url } });
    t.check(`foto inválida (${why}) -> 400`, r.code === 400 && r.body?.code === 'bad_avatar', `${r.code} ${r.body?.code}`);
  }
  r = await call({ tok: tok1, body: { action: 'update', avatar_url: mine } });
  t.check('dueño guarda su foto -> 200 y queda en su perfil', r.code === 200 && db.tables.seller_profiles[0].avatar_url === mine && db.tables.seller_profiles[1].avatar_url == null, `${r.code} ${JSON.stringify(r.body)}`);
  t.check('respuesta trae avatar_url', r.body?.avatar_url === mine, JSON.stringify(r.body));
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0, avatar_url: mine }];
  db.tables.public_store_items = [];
  r = await call({ method: 'GET', query: { store: 'valeria' } });
  t.check('tienda pública /t/<usuario> muestra la foto', r.code === 200 && r.body?.avatar_url === mine, JSON.stringify(r.body));
  r = await call({ tok: tok1, body: { action: 'update', avatar_url: null } });
  t.check('quitar la foto (null) -> placeholder', r.code === 200 && db.tables.seller_profiles[0].avatar_url === null, `${r.code}`);
  t.check('avatarUrlOf: solo su carpeta, uuid/0.(jpg|png|webp)', avatarUrlOf(mine, 'seller1') === mine && avatarUrlOf(mine.replace('.jpg', '.webp'), 'seller1') !== null && avatarUrlOf(theirs, 'seller1') === null && avatarUrlOf(mine + '?x=1', 'seller1') === null);

  // Migración 014 sin aplicar: update -> 503 amable; GET sigue funcionando sin la columna.
  const orig = db.from;
  (db as any).from = (tb: string) => {
    const q = orig(tb); const upd = q.update; const sel = q.select;
    q.update = (p: any) => (p && 'avatar_url' in p ? Object.assign(Promise.resolve({ data: null, error: { code: '42703', message: 'column "avatar_url" does not exist' } }), { eq: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column "avatar_url" does not exist' } }) }) : upd(p));
    q.select = (c?: string) => (tb === 'public_stores' && String(c ?? '').includes('avatar_url') ? Object.assign(q, { maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column public_stores.avatar_url does not exist' } }) }) : sel(c));
    return q;
  };
  r = await call({ tok: tok1, body: { action: 'update', avatar_url: mine } });
  t.check('sin migración 014: guardar foto -> 503 avatar_unavailable', r.code === 503 && r.body?.code === 'avatar_unavailable', `${r.code} ${r.body?.code}`);
  db.tables.public_stores.forEach((x: any) => delete x.avatar_url); // vista vieja: sin la columna
  r = await call({ method: 'GET', query: { store: 'valeria' } });
  t.check('sin migración 014: la tienda pública sigue (sin foto)', r.code === 200 && r.body?.avatar_url == null, `${r.code} ${JSON.stringify(r.body)}`);
  (db as any).from = orig;

  const mig = 'supabase/migrations/014_store_avatar.sql';
  const sql = existsSync(mig) ? readFileSync(mig, 'utf8') : '';
  t.check('migración 014 aditiva (add column if not exists + vista con avatar_url al final)', /add column if not exists avatar_url/i.test(sql) && /public_stores/.test(sql) && !/drop |delete |truncate /i.test(sql));

  // Navegación: exactamente Vender, Comprar, Pedidos; "/" -> Vender; PWA abre en Vender.
  const tabs = readFileSync('app/(tabs)/_layout.tsx', 'utf8');
  const names = [...tabs.matchAll(/Tabs\.Screen name="([^"]+)"/g)].map((m) => m[1]);
  t.check('pestañas: vender, comprar, pedidos (en ese orden)', JSON.stringify(names) === '["vender","comprar","pedidos"]', names.join(','));
  t.check('sin pantalla Inicio en las pestañas', !existsSync('app/(tabs)/index.tsx'));
  t.check('"/" redirige a /vender', existsSync('app/index.tsx') && /Redirect[^]*href="\/vender"/.test(readFileSync('app/index.tsx', 'utf8')));
  t.check('PWA: start_url /vender', JSON.parse(readFileSync('public/manifest.json', 'utf8')).start_url === '/vender');
}
