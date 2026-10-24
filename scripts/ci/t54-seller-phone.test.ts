// (54) WhatsApp/teléfono de contacto del vendedor: validación CR (+506 y 8 dígitos) y normalización; solo el comprador
//      del pedido (llave de invitado o sesión) lo recibe, y solo después de pagar; sin la migración 016 -> null. Sin red.
import type { T } from './setup';
import { existsSync, readFileSync } from 'node:fs';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { canShowContact, contactPhoneError, CONTACT_STATUSES, formatContactPhone, normalizeContactPhone, waLink } from '../../api/_lib/contact';
import { fakeDb } from './fakedb';
import { guestSubFromReq } from '../../api/_lib/guest';
import store from '../../api/store/index';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const call = async (o: { body: any; tok?: string; key?: string; method?: string; query?: any }) => {
  const r = res();
  await store({ method: o.method ?? 'POST', headers: { ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.key ? { 'x-guest-key': o.key } : {}) }, body: o.body, query: o.query ?? {} }, r);
  return r;
};

export async function run(t: T) {
  // Validación y normalización (pura, compartida por la app y la API).
  const ok = ['+506 8888 1234', '88881234', '8888-1234', '506 8888 1234', '(+506) 8888-1234', ' 8888 1234 '];
  t.check('acepta con o sin +506 y con espacios/guiones -> +50688881234', ok.every((v) => normalizeContactPhone(v) === '+50688881234'), ok.map((v) => normalizeContactPhone(v)).join());
  t.check('vacío -> null (es opcional)', normalizeContactPhone('') === null && normalizeContactPhone(null) === null && normalizeContactPhone('  ') === null);
  const bad = ['1234', '888812345', '+1 305 555 1234', '08881234', '9888 1234', 'abc', '+506 8888 123'];
  t.check('inválidos -> "invalid" con mensaje en tuteo', bad.every((v) => normalizeContactPhone(v) === 'invalid' && /Escribe|8 dígitos/.test(contactPhoneError(v) ?? '')), bad.filter((v) => normalizeContactPhone(v) !== 'invalid').join());
  t.check('formato y link de WhatsApp', formatContactPhone('+50688881234') === '+506 8888 1234' && waLink('+50688881234') === 'https://wa.me/50688881234');
  t.check('estados con contacto = fondeado..resuelto (nunca antes del pago)', CONTACT_STATUSES.join() === 'fondeado,enviado,entregado,liberado,en_disputa,resuelto'
    && !canShowContact('creado') && !canShowContact('escrow_creado') && !canShowContact('cancelado') && canShowContact('fondeado'));

  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria' }];
  const tok = await token({ sub: 'seller1' });

  // Vendedor guarda su teléfono por el endpoint de perfil (action:'update').
  let r = await call({ body: { action: 'update', contact_phone: '+506 8888 1234' } });
  t.check('guardar sin sesión -> 401', r.code === 401 && db.tables.seller_profiles[0].contact_phone === undefined, `${r.code}`);
  r = await call({ tok, body: { action: 'update', contact_phone: '1234' } });
  t.check('teléfono inválido -> 400 bad_phone, no se guarda', r.code === 400 && r.body?.code === 'bad_phone' && db.tables.seller_profiles[0].contact_phone === undefined, `${r.code} ${r.body?.code}`);
  r = await call({ tok, body: { action: 'update', contact_phone: '8888 1234' } });
  t.check('guarda normalizado (+50688881234) y lo devuelve al dueño', r.code === 200 && db.tables.seller_profiles[0].contact_phone === '+50688881234' && r.body?.contact_phone === '+50688881234', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ tok, body: { action: 'me' } });
  t.check('Mi tienda (dueño) trae su teléfono', r.code === 200 && r.body?.contact_phone === '+50688881234', JSON.stringify(r.body));

  // Comprador: solo quien demuestre ser el comprador, solo después de pagar.
  const buyer = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } });
  const order = { id: '54545454-5454-4545-8545-545454545454', slug: 'tel001', seller_user_id: 'seller1', buyer_user_id: buyer, status: 'fondeado' };
  db.tables.orders = [order];
  const ask = (o: { key?: string; tok?: string }) => call({ ...o, body: { action: 'seller_contact', slug: 'tel001' } });
  r = await ask({ key: KEY_A });
  t.check('comprador (su llave) con pedido pagado -> recibe el teléfono', r.code === 200 && r.body?.contact_phone === '+50688881234', `${r.code} ${JSON.stringify(r.body)}`);
  r = await ask({ key: KEY_B });
  t.check('otro invitado -> 403 y sin teléfono', r.code === 403 && !JSON.stringify(r.body).includes('8888'), `${r.code}`);
  r = await ask({});
  t.check('sin llave ni sesión -> 401 y sin teléfono', r.code === 401 && !JSON.stringify(r.body).includes('8888'), `${r.code}`);
  r = await ask({ tok });
  t.check('el propio vendedor por esta vía -> 403 (no es el comprador)', r.code === 403, `${r.code}`);
  const leaks: string[] = [];
  for (const st of ['creado', 'escrow_creado', 'cancelado']) { order.status = st; r = await ask({ key: KEY_A }); if (r.code === 200 || JSON.stringify(r.body).includes('8888')) leaks.push(st); }
  t.check('antes del pago (creado/escrow_creado) o cancelado -> sin teléfono', leaks.length === 0, leaks.join());
  const miss: string[] = [];
  for (const st of CONTACT_STATUSES) { order.status = st; r = await ask({ key: KEY_A }); if (r.body?.contact_phone !== '+50688881234') miss.push(st); }
  t.check('fondeado, enviado, entregado, liberado, en_disputa, resuelto -> teléfono', miss.length === 0, miss.join());
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0 }]; db.tables.public_store_items = [];
  r = await call({ method: 'GET', body: {}, query: { store: 'valeria' } });
  t.check('tienda pública: nunca el teléfono', r.code === 200 && !('contact_phone' in (r.body ?? {})) && !JSON.stringify(r.body).includes('8888'), JSON.stringify(r.body));

  // Sin la migración 016: leer -> null sin romper; guardar -> 503 amable.
  order.status = 'fondeado';
  const orig = db.from; const colErr = { code: '42703', message: 'column seller_profiles.contact_phone does not exist' };
  (db as any).from = (tb: string) => {
    const q = orig(tb); const sel = q.select; const upd = q.update;
    q.select = (c?: string) => (tb === 'seller_profiles' && String(c ?? '').includes('contact_phone') ? Object.assign(q, { maybeSingle: async () => ({ data: null, error: colErr }) }) : sel(c));
    q.update = (p: any) => (tb === 'seller_profiles' && p && 'contact_phone' in p ? { eq: async () => ({ data: null, error: colErr }) } : upd(p));
    return q;
  };
  r = await ask({ key: KEY_A });
  t.check('sin migración: comprador recibe contact_phone null (200)', r.code === 200 && r.body?.contact_phone === null, `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ tok, body: { action: 'me' } });
  t.check('sin migración: Mi tienda sigue (contact_phone null)', r.code === 200 && r.body?.contact_phone === null, `${r.code}`);
  r = await call({ tok, body: { action: 'update', contact_phone: '88881234' } });
  t.check('sin migración: guardar -> 503 phone_unavailable', r.code === 503 && r.body?.code === 'phone_unavailable', `${r.code} ${r.body?.code}`);
  (db as any).from = orig;

  const mig = 'supabase/migrations/016_seller_contact_phone.sql';
  const sql = existsSync(mig) ? readFileSync(mig, 'utf8') : '';
  t.check('migración 016: columna nullable con check +506 en seller_profiles, sin tocar vistas públicas',
    /alter table public\.seller_profiles add column if not exists contact_phone text/i.test(sql) && /\\\+506\[2-8\]\[0-9\]\{7\}/.test(sql) && !/public_stores|create or replace view|grant/i.test(sql.replace(/--.*$/gm, '')), mig);
  // La UI del comprador solo lo pide en su dispositivo y con el pedido pagado; nunca en la tienda pública.
  const page = readFileSync('app/p/[slug].tsx', 'utf8'); const shop = readFileSync('app/t/[store].tsx', 'utf8') + readFileSync('components/StoreView.tsx', 'utf8');
  t.check('/p/<slug>: SellerContact solo con canShowContact (pagado) + isBuyerDevice; la tienda no lo usa',
    /canShowContact\(order\.status\)\s*&&\s*isBuyerDevice\(order\.slug\)/.test(page) && /<SellerContact/.test(page) && !/SellerContact|contact_phone|wa\.me/.test(shop));
}
