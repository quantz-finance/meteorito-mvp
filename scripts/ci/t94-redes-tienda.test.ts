// (94) Redes del vendedor en su tienda (031): usuario o link -> link canónico https de cada red; otro esquema, otro
//      dominio o muy largo se rechaza (el API valida igual que la app).
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { cleanSocials, normalizeSocial, normalizeSocials } from '../../api/_lib/socials';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import store from '../../api/store/index';
import dispute from '../../api/escrow/dispute';

const call = async (h: any, tok: string | null, body: any) => { const r = res(); await h(req(tok, body), r); return r; };
const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

export async function run(t: T) {
  t.check('usuario -> link canónico', normalizeSocial('instagram', '@mi.tienda') === 'https://www.instagram.com/mi.tienda'
    && normalizeSocial('tiktok', 'mitienda') === 'https://www.tiktok.com/@mitienda' && normalizeSocial('x', '@mitienda') === 'https://x.com/mitienda'
    && normalizeSocial('youtube', '@mitienda') === 'https://www.youtube.com/@mitienda' && normalizeSocial('facebook', 'mitienda.cr') === 'https://www.facebook.com/mitienda.cr');
  t.check('link -> link canónico (sin query ni rastreo)', normalizeSocial('instagram', 'https://instagram.com/mitienda/?igsh=abc') === 'https://www.instagram.com/mitienda'
    && normalizeSocial('x', 'twitter.com/mitienda') === 'https://x.com/mitienda' && normalizeSocial('website', 'mitienda.com') === 'https://mitienda.com/');
  t.check('rechaza javascript:, data:, http: y otros esquemas', ['javascript:alert(1)', 'data:text/html,hi', 'http://instagram.com/x', 'mailto:a@b.com', 'JavaScript://instagram.com/%0aalert(1)']
    .every((v) => normalizeSocial('instagram', v) === 'invalid' && normalizeSocial('website', v) === 'invalid'));
  t.check('rechaza otro dominio y dominios parecidos', normalizeSocial('instagram', 'https://evil.com/mitienda') === 'invalid'
    && normalizeSocial('facebook', 'https://facebook.com.evil.com/x') === 'invalid' && normalizeSocial('x', 'https://user:pw@x.com/a') === 'invalid');
  t.check('largo máximo', normalizeSocial('website', 'https://a.com/' + 'a'.repeat(200)) === 'invalid' && normalizeSocial('x', 'a'.repeat(16)) === 'invalid');
  const n = normalizeSocials({ instagram: 'mitienda', website: '', youtube: null });
  t.check('objeto: solo las redes con valor; clave desconocida o red inválida -> error', 'socials' in n && JSON.stringify(n.socials) === '{"instagram":"https://www.instagram.com/mitienda"}'
    && 'bad' in normalizeSocials({ whatsapp: '8888' }) && (normalizeSocials({ tiktok: 'javascript:x' }) as any).bad === 'tiktok');
  t.check('lo guardado se vuelve a limpiar al leer', JSON.stringify(cleanSocials({ x: 'javascript:alert(1)', website: 'https://ok.cr/' })) === '{"website":"https://ok.cr/"}');

  // Avisos y copy
  t.check('hint y aviso de cuentas no verificadas (texto exacto)', src('components/SocialLinks.tsx').includes('Se muestran en tu tienda, a la vista de cualquiera que la visite. Puedes quitarlas cuando quieras.')
    && src('components/SocialLinks.tsx').includes('Meteorito no verifica estas cuentas. Para que tu compra quede en custodia, paga dentro de Meteorito.'));

  // API: quitar una red la borra de verdad; todas vacías -> columna null; nunca se loguea el link
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = ''; delete process.env.ADMIN_EMAILS;
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [{ sub: 'seller94', store_slug: 'redes94', display_name: 'Redes', created_at: '2026-09-01T00:00:00Z' }];
  const sp = () => db.tables.seller_profiles[0];
  const tok = await token({ sub: 'seller94' });
  const logs: string[] = []; const orig = { log: console.log, info: console.info, warn: console.warn };
  for (const k of ['log', 'info', 'warn'] as const) (console as any)[k] = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
  let r: any = await call(store, tok, { action: 'update', socials: { instagram: '@redes94', x: 'redes94' } });
  const saved = JSON.stringify(sp().socials);
  r = await call(store, tok, { action: 'update', socials: { instagram: '@redes94', x: '' } });
  t.check('quitar una red: la clave sale del jsonb', r.code === 200 && saved.includes('x.com') && JSON.stringify(sp().socials) === '{"instagram":"https://www.instagram.com/redes94"}');
  r = await call(store, tok, { action: 'update', socials: { instagram: '' } });
  t.check('todas vacías: columna en null', r.code === 200 && sp().socials === null);
  r = await call(store, tok, { action: 'update', socials: { website: 'javascript:alert(1)' } });
  t.check('API rechaza un esquema malo (400 bad_social) y no guarda', r.code === 400 && r.body?.code === 'bad_social' && sp().socials === null);

  // Admin: borra las redes reportadas; no admin -> 404; auditoría sin los links
  await call(store, tok, { action: 'update', socials: { tiktok: 'redes94', youtube: '@redes94' } });
  const userTok = await token({ sub: 'otro' });
  r = await call(dispute, userTok, { action: 'admin_socials_clear', store_slug: 'redes94' });
  t.check('no admin -> 404 y no borra', r.code === 404 && !!sp().socials?.tiktok, `${r.code}`);
  const adminTok = await token({ sub: 'admin-sub', email: 'bobbyaliensshop@gmail.com' });
  r = await call(dispute, adminTok, { action: 'admin_socials_clear', store_slug: 'redes94' });
  const audit = db.tables.admin_audit ?? [];
  t.check('admin borra las redes + auditoría (qué redes, sin links)', r.code === 200 && r.body?.cleared === 2 && sp().socials === null
    && audit.length === 1 && audit[0].kind === 'store_socials_cleared' && audit[0].target === 'redes94' && !JSON.stringify(audit).includes('http') && JSON.stringify(audit[0].detail) === '{"networks":["tiktok","youtube"]}');
  Object.assign(console, orig);
  t.check('ningún log ni evento con los links', !logs.some((l) => /instagram\.com|tiktok\.com|x\.com\/|youtube\.com/.test(l)) && !(db.tables.order_events ?? []).some((e: any) => JSON.stringify(e).includes('redes94')));

  // Cuenta eliminada: las redes viven SOLO en seller_profiles.socials (no hay copias en otras tablas ni historial),
  // así que borrar la fila del vendedor las borra. No existe flujo de "eliminar cuenta" que solo anonimice.
  const api = ['api/store/index.ts', 'api/_lib/feed.ts', 'api/_lib/socialsAdmin.ts'].map(src).join('\n');
  const writes = [...api.matchAll(/from\('([a-z_]+)'\)\.(?:update|insert|upsert)\(\{ ?socials/g)].map((m) => m[1]);
  t.check('redes solo en seller_profiles (borrar la fila las borra)', writes.length >= 1 && writes.every((x) => x === 'seller_profiles')
    && !/socials/.test(src('api/_lib/analytics.ts')) && !/anonymi[sz]e|delete_account|account_delete/i.test(api));
  db.tables.seller_profiles = db.tables.seller_profiles.filter((x: any) => x.sub !== 'seller94');
  t.check('sin la fila del vendedor no queda ninguna red', !JSON.stringify(db.tables).includes('redes94.') && (await call(store, null, {})).code !== 500);
}
