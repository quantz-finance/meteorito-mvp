// (63) WhatsApp en el perfil público: opt-in del vendedor (whatsapp_public, migración 019). Por defecto NO se muestra;
//      solo el dueño lo activa, solo con número guardado; sin la migración: leer -> false, guardar -> 503 amable. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const call = async (o: { body?: any; tok?: string; method?: string; query?: any }) => {
  const r = res();
  await store({ method: o.method ?? 'POST', headers: o.tok ? { authorization: `Bearer ${o.tok}` } : {}, body: o.body ?? {}, query: o.query ?? {} }, r);
  return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria', created_at: '2026-09-01T00:00:00Z' }];
  const tok = await token({ sub: 'seller1' });
  const sp = () => db.tables.seller_profiles[0];
  const profile = async () => (await call({ method: 'GET', query: { profile: 'valeria' } })).body;

  let r = await call({ tok, body: { action: 'update', whatsapp_public: true } });
  t.check('activar sin número guardado -> 400 no_phone', r.code === 400 && r.body?.code === 'no_phone' && sp().whatsapp_public === undefined, `${r.code} ${r.body?.code}`);
  r = await call({ tok, body: { action: 'update', contact_phone: '8888 1234' } });
  t.check('guardar el número no lo publica (por defecto privado)', r.code === 200 && r.body?.whatsapp_public === false && (await profile())?.whatsapp === null, JSON.stringify(r.body));
  r = await call({ body: { action: 'update', whatsapp_public: true } });
  t.check('sin sesión -> 401', r.code === 401 && sp().whatsapp_public === undefined, `${r.code}`);
  r = await call({ tok, body: { action: 'update', whatsapp_public: 'si' } });
  t.check('valor no booleano -> 400', r.code === 400 && sp().whatsapp_public === undefined, `${r.code}`);
  r = await call({ tok, body: { action: 'update', whatsapp_public: true } });
  t.check('el dueño lo activa -> el perfil público muestra wa.me', r.code === 200 && r.body?.whatsapp_public === true && sp().whatsapp_public === true
    && (await profile())?.whatsapp === 'https://wa.me/50688881234', JSON.stringify(r.body));
  r = await call({ tok, body: { action: 'me' } });
  t.check('Mi tienda trae whatsapp_public', r.code === 200 && r.body?.whatsapp_public === true, JSON.stringify(r.body));
  r = await call({ tok, body: { action: 'update', whatsapp_public: false } });
  t.check('lo desactiva -> el perfil ya no lo muestra', r.code === 200 && sp().whatsapp_public === false && (await profile())?.whatsapp === null);
  await call({ tok, body: { action: 'update', whatsapp_public: true } });
  r = await call({ tok, body: { action: 'update', contact_phone: null } });
  t.check('quitar el número también lo saca del perfil', r.code === 200 && sp().whatsapp_public === false && (await profile())?.whatsapp === null, JSON.stringify(sp()));
  t.check('el perfil público nunca trae el teléfono crudo', !JSON.stringify(await profile()).includes('+506'));

  // Sin la migración 019: la columna no existe.
  const orig = db.from.bind(db);
  (db as any).from = (table: string) => {
    const q: any = orig(table);
    if (table !== 'seller_profiles') return q;
    const upd = q.update.bind(q);
    q.update = (patch: any) => {
      if (patch && 'whatsapp_public' in patch) { const fail: any = { eq: () => fail, then: (f: any) => Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'whatsapp_public' column of 'seller_profiles' in the schema cache" } }).then(f) }; return fail; }
      return upd(patch);
    };
    return q;
  };
  delete sp().whatsapp_public;
  await call({ tok, body: { action: 'update', contact_phone: '8888 1234' } });
  r = await call({ tok, body: { action: 'update', whatsapp_public: true } });
  t.check('sin migración 019: activar -> 503 amable, nada se publica', r.code === 503 && r.body?.code === 'whatsapp_public_unavailable' && (await profile())?.whatsapp === null, `${r.code} ${JSON.stringify(r.body)}`);
  (db as any).from = orig;

  const ui = readFileSync('components/Payout.tsx', 'utf8');
  t.check('Mi tienda: interruptor "Mostrar en mi perfil público" y textos honestos', /Mostrar en mi perfil público/.test(ui) && /whatsapp_public/.test(ui) && !/nunca lo muestra/.test(ui));
  const mig = readFileSync('supabase/migrations/019_seller_profile_flags.sql', 'utf8');
  t.check('migración 019: whatsapp_public default false, listed_in_feed default true, pg_trgm', /whatsapp_public boolean not null default false/.test(mig) && /listed_in_feed boolean not null default true/.test(mig) && /pg_trgm/.test(mig));
}
