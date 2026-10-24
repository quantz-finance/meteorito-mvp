// (70) Última conexión del vendedor (estilo P2P), SOLO con consentimiento (Ley 8968, art. 5).
//      - Apagada por defecto (también para quienes 021 dejó en true): sin registro de consentimiento no se guarda ni se
//        muestra nada, y nunca aparece como "inactivo".
//      - Cada cambio queda en last_seen_consents (usuario, valor, fecha, versión del texto). Apagarla borra la hora.
//      - Al público solo le llega un rango grueso por ?activity= (sin caché); el feed y el perfil (cacheados) no la traen.
//      - Escritura máx. 1 vez cada 5 min (cliente y servidor). Sin 023 (o sin 021): nadie consiente, sin errores. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import { activityOf, LAST_SEEN_TEXT_VERSION, SEEN_THROTTLE_MS } from '../../api/_lib/activity';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { activityLabel, shouldPing, SEEN_THROTTLE_MS as CLIENT_THROTTLE } from '../../lib/activity';

const call = async (o: { body?: any; tok?: string; method?: string; query?: any }) => {
  const r: any = { code: 0, body: null, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'POST', headers: o.tok ? { authorization: `Bearer ${o.tok}` } : {}, body: o.body ?? {}, query: o.query ?? {} }, r);
  return r;
};
const MIN = 60e3, H = 60 * MIN, D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Simula la base sin 023 (tabla last_seen_consents) y, opcionalmente, sin 021 (columnas), como responde PostgREST. */
function withoutMigration(db: any, o: { cols: boolean }) {
  const orig = db.from.bind(db);
  const fail = (err: any): any => new Proxy({}, { get: (_t, k) => (k === 'then' ? (f: any) => Promise.resolve({ data: null, error: err }).then(f) : k === 'maybeSingle' || k === 'single' ? async () => ({ data: null, error: err }) : () => fail(err)) });
  const colErr = { code: '42703', message: 'column seller_profiles.last_seen_at does not exist' };
  const tblErr = { code: 'PGRST205', message: "Could not find the table 'public.last_seen_consents' in the schema cache" };
  db.from = (table: string) => {
    if (table === 'last_seen_consents') return fail(tblErr);
    const q: any = orig(table);
    if (table !== 'seller_profiles' || !o.cols) return q;
    const sel = q.select.bind(q), upd = q.update.bind(q);
    q.select = (cols?: string) => (/last_seen_at|show_last_seen/.test(String(cols ?? '')) ? fail(colErr) : sel(cols));
    q.update = (p: any) => (p && ('last_seen_at' in p || 'show_last_seen' in p) ? fail(colErr) : upd(p));
    return q;
  };
  return () => { db.from = orig; };
}

export async function run(t: T) {
  // ---- rangos (puro) ----
  const now = Date.UTC(2026, 9, 24, 12, 0);
  const b = (ms: number | null, show = true) => activityOf(ms == null ? null : new Date(now - ms).toISOString(), show, now);
  t.check('menos de 5 min -> En línea', JSON.stringify(b(0)) === '{"k":"online"}' && JSON.stringify(b(4 * MIN + 59e3)) === '{"k":"online"}');
  t.check('5 a 59 min -> minutos redondeados a 5 (nunca exactos)', JSON.stringify(b(5 * MIN)) === '{"k":"min","n":5}' && JSON.stringify(b(17 * MIN)) === '{"k":"min","n":15}' && JSON.stringify(b(59 * MIN)) === '{"k":"min","n":55}', JSON.stringify(b(17 * MIN)));
  t.check('1 a 23 h -> horas', JSON.stringify(b(H)) === '{"k":"h","n":1}' && JSON.stringify(b(23 * H + 59 * MIN)) === '{"k":"h","n":23}');
  t.check('24 a 47 h -> ayer', JSON.stringify(b(D)) === '{"k":"yesterday"}' && JSON.stringify(b(47 * H)) === '{"k":"yesterday"}');
  t.check('2 a 7 días -> días', JSON.stringify(b(2 * D)) === '{"k":"days","n":2}' && JSON.stringify(b(7 * D + 23 * H)) === '{"k":"days","n":7}');
  t.check('más de 7 días, nunca, apagado o fecha rara -> nada', b(8 * D) === null && b(null) === null && b(0, false) === null && activityOf('basura', true, now) === null);
  t.check('reloj adelantado (fecha futura) -> En línea, no negativo', JSON.stringify(activityOf(new Date(now + 3 * MIN).toISOString(), true, now)) === '{"k":"online"}');

  // ---- textos ----
  const labels = [activityLabel({ k: 'online' }), activityLabel({ k: 'min', n: 15 }), activityLabel({ k: 'h', n: 3 }), activityLabel({ k: 'yesterday' }), activityLabel({ k: 'days', n: 4 })];
  t.check('textos: En línea / Activo hace 15 min / hace 3 h / ayer / hace 4 días', labels.join('|') === 'En línea|Activo hace 15 min|Activo hace 3 h|Activo ayer|Activo hace 4 días', labels.join('|'));
  t.check('sin rango -> sin texto', activityLabel(null) === null && activityLabel(undefined) === null);
  const copyText = [...labels, COPY.activity.toggle, COPY.activity.toggleOn, COPY.activity.toggleOff, COPY.activity.inviteTitle, COPY.activity.invite, COPY.activity.inviteDone].join(' | ');
  t.check('invitación: el texto exacto que pidió legal', COPY.activity.invite === 'Mostrar a quienes ven tu tienda en Meteorito cuándo estuviste activo por última vez (aproximado, sin hora exacta). Puedes apagarlo cuando quieras en Mi cuenta.');
  t.check('Mi cuenta encendido: mismo público que la invitación', COPY.activity.toggleOn === 'Quienes ven tu tienda en Meteorito ven cuándo estuviste activo por última vez (aproximado, sin hora exacta). Puedes apagarlo cuando quieras.');
  const legal = readFileSync('lib/legal.ts', 'utf8');
  t.check('política de privacidad: línea de última conexión aprobada', legal.includes('Última conexión (opcional): si la enciendes, quienes ven tu tienda en Meteorito ven cuándo estuviste activo por última vez, de forma aproximada y sin hora exacta (por ejemplo, «En línea» o «Activo hace 3 h»), para que sepan si sueles estar disponible. Está apagada por defecto, registramos cuándo la enciendes o la apagas, y puedes apagarla cuando quieras en Mi cuenta; al apagarla dejamos de mostrarla y borramos la hora guardada.') && legal.includes("LEGAL_UPDATED = '24 de octubre de 2026'"));
  t.check('sin presión: ni "venden más" ni urgencia en los textos', !/vend(en|es) más|más ventas|activos venden|no te pierdas|ahora mismo/i.test(copyText), copyText);
  t.check('textos sin palabras prohibidas ni voseo', !BANNED_COPY.test(copyText) && !/\b(tenés|podés|querés|mostrá|activá)\b/i.test(copyText), copyText);

  // ---- throttle del cliente ----
  t.check('cliente: primer uso -> avisa; antes de 5 min -> no; después -> sí', shouldPing(null, now) && !shouldPing(now - 4 * MIN, now) && shouldPing(now - SEEN_THROTTLE_MS, now) && SEEN_THROTTLE_MS === 5 * MIN && CLIENT_THROTTLE === SEEN_THROTTLE_MS);

  // ---- API ----
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  // Como quedó tras 021 en prod: show_last_seen = true por defecto, sin ningún consentimiento.
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria', created_at: '2026-09-01T00:00:00Z', show_last_seen: true, last_seen_at: null }];
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0 }];
  db.tables.public_store_items = [];
  db.tables.last_seen_consents = [];
  db.tables.orders = [{ id: 'o1', slug: 'aaaaa1', kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null, seller_user_id: 'seller1', brand: '', model: 'Silla', description: null, price_crc: 10000, photos: [], created_at: ago(H) }];
  const tok = await token({ sub: 'seller1' });
  const sp = () => db.tables.seller_profiles[0];
  const consents = () => db.tables.last_seen_consents as any[];
  const act = async (slugs = 'valeria') => call({ method: 'GET', query: { activity: slugs } });
  const profile = async () => (await call({ method: 'GET', query: { profile: 'valeria' } })).body;
  const feed = async () => (await call({ method: 'GET', query: { feed: '1', verified: 'all' } })).body;
  /** Ningún rastro público: ni rango, ni fecha, ni el interruptor, en el feed, el perfil ni la tienda. */
  const noTrace = async () => {
    const pages = [await profile(), await feed(), (await call({ method: 'GET', query: { store: 'valeria' } })).body];
    const txt = JSON.stringify(pages);
    return pages.every((x) => x && !('activity' in x) && !(x.items ?? []).some((i: any) => i.seller && 'activity' in i.seller)) && !/last_seen|show_last_seen|activity/.test(txt) && !ISO_RE.test(JSON.stringify(pages[0]?.activity ?? ''));
  };

  // -- por defecto: apagada (aunque 021 dejó true), nada guardado ni mostrado --
  let r = await call({ tok, body: { action: 'me' } });
  t.check('por defecto APAGADA: sin consentimiento, Mi cuenta la ve apagada aunque la fila diga true (021)', r.code === 200 && r.body?.show_last_seen === false && r.body?.last_seen_decided === false, JSON.stringify(r.body));
  r = await call({ tok, body: { action: 'seen' } });
  t.check('sin consentimiento no se guarda la hora (seen no escribe)', r.code === 200 && r.body?.updated === false && sp().last_seen_at === null, JSON.stringify(r.body));
  sp().last_seen_at = ago(MIN); // aunque hubiera una hora vieja guardada
  r = await act();
  t.check('sin consentimiento el público no recibe nada (ni "inactivo")', r.code === 200 && JSON.stringify(r.body) === '{"activity":{}}', JSON.stringify(r.body));
  t.check('feed, perfil y tienda nunca traen la última conexión', await noTrace());
  sp().last_seen_at = null;
  r = await call({ method: 'GET', query: { activity: 'valeria' } });
  t.check('?activity= sin caché (private, no-store)', /no-store/.test(r.headers['cache-control'] ?? '') && /private/.test(r.headers['cache-control'] ?? ''), r.headers['cache-control']);
  r = await call({ body: { action: 'seen' } });
  t.check('seen sin sesión -> 401', r.code === 401);

  // -- lo enciende: queda registrado --
  r = await call({ tok, body: { action: 'update', show_last_seen: 'si' } });
  t.check('interruptor: valor no booleano -> 400, sin registro', r.code === 400 && consents().length === 0, `${r.code}`);
  r = await call({ tok, body: { action: 'update', show_last_seen: true } });
  const c1 = consents()[0];
  t.check('encender: registro con usuario, valor, fecha y versión del texto', r.code === 200 && r.body?.show_last_seen === true && consents().length === 1
    && c1.user_id === 'seller1' && c1.value === true && c1.text_version === LAST_SEEN_TEXT_VERSION && LAST_SEEN_TEXT_VERSION === 'v2-2026-10-24' && Date.parse(c1.created_at) > Date.now() - MIN, JSON.stringify(consents()));
  t.check('encender: show_last_seen = true y ya cuenta como actividad', sp().show_last_seen === true && typeof sp().last_seen_at === 'string');
  r = await act('valeria,nadie,BAD!!');
  t.check('con consentimiento: ?activity= da el rango ("En línea") y nunca la hora', r.body?.activity?.valeria?.k === 'online' && Object.keys(r.body.activity).length === 1 && !ISO_RE.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  t.check('con consentimiento: feed, perfil y tienda siguen sin traerla (están en caché)', await noTrace());
  r = await call({ tok, body: { action: 'me' } });
  t.check('Mi cuenta: encendida y ya eligió', r.body?.show_last_seen === true && r.body?.last_seen_decided === true && !ISO_RE.test(JSON.stringify({ a: r.body?.show_last_seen })));
  r = await call({ tok, body: { action: 'update', show_last_seen: true } });
  t.check('encender otra vez sin cambio: no duplica el registro', r.code === 200 && consents().length === 1);

  // -- freno de escritura (con consentimiento) --
  sp().last_seen_at = ago(2 * MIN); const before = sp().last_seen_at;
  r = await call({ tok, body: { action: 'seen' } });
  t.check('servidor: dentro de 5 min no vuelve a escribir (update condicional)', r.code === 200 && sp().last_seen_at === before && r.body?.updated === false, JSON.stringify(r.body));
  sp().last_seen_at = ago(6 * MIN);
  r = await call({ tok, body: { action: 'seen' } });
  t.check('servidor: pasados 5 min vuelve a escribir (sin devolver la hora)', r.code === 200 && r.body?.updated === true && Date.parse(sp().last_seen_at) > Date.now() - MIN && !ISO_RE.test(JSON.stringify(r.body)));
  sp().last_seen_at = ago(3 * H + 10 * MIN);
  t.check('rango "hace 3 h"', JSON.stringify((await act()).body?.activity?.valeria) === '{"k":"h","n":3}');
  sp().last_seen_at = ago(9 * D);
  t.check('más de 7 días: nada (no "inactivo")', JSON.stringify((await act()).body) === '{"activity":{}}');

  // -- lo apaga: efecto inmediato, sin rastro, registrado --
  sp().last_seen_at = ago(MIN);
  r = await call({ tok, body: { action: 'update', show_last_seen: false } });
  const c2 = consents()[1];
  t.check('apagar: efecto inmediato, ?activity= ya no trae nada', r.code === 200 && r.body?.show_last_seen === false && JSON.stringify((await act()).body) === '{"activity":{}}', JSON.stringify(r.body));
  t.check('apagar: se borra la hora guardada (sin rastro)', sp().show_last_seen === false && sp().last_seen_at === null && await noTrace());
  t.check('apagar: también queda registrado (valor false, versión, fecha)', consents().length === 2 && c2.value === false && c2.user_id === 'seller1' && c2.text_version === LAST_SEEN_TEXT_VERSION && typeof c2.created_at === 'string');
  r = await call({ tok, body: { action: 'seen' } });
  t.check('apagada: seen no vuelve a guardar la hora', r.body?.updated === false && sp().last_seen_at === null);
  r = await call({ tok, body: { action: 'update', show_last_seen: false } });
  t.check('apagar otra vez sin cambio: no duplica el registro', r.code === 200 && consents().length === 2);
  r = await call({ tok, body: { action: 'update', show_last_seen: true } });
  t.check('volver a encender: tercer registro y se ve', r.code === 200 && consents().length === 3 && (await act()).body?.activity?.valeria?.k === 'online');
  // Inconsistente (fila en true pero el último consentimiento dice false): manda el consentimiento.
  consents().push({ id: 99, user_id: 'seller1', value: false, text_version: LAST_SEEN_TEXT_VERSION, created_at: new Date(Date.now() + 1000).toISOString() });
  t.check('si el último consentimiento es false, no se muestra aunque la fila diga true', sp().show_last_seen === true && JSON.stringify((await act()).body) === '{"activity":{}}');
  consents().pop();

  // -- sin 023 (021 sí, como prod hoy): nadie consiente, sin errores --
  sp().show_last_seen = true; sp().last_seen_at = ago(MIN); sp().whatsapp_public = false;
  const saved = db.tables.last_seen_consents; let restore = withoutMigration(db, { cols: false });
  r = await call({ tok, body: { action: 'me' } });
  t.check('sin 023: Mi cuenta funciona y la ve apagada', r.code === 200 && r.body?.store_slug === 'valeria' && r.body?.show_last_seen === false, `${r.code} ${JSON.stringify(r.body)}`);
  const keep = sp().last_seen_at = ago(10 * MIN);
  r = await call({ tok, body: { action: 'seen' } });
  t.check('sin 023: seen -> 200 sin escribir aunque la fila diga true', r.code === 200 && r.body?.updated === false && sp().last_seen_at === keep);
  r = await act();
  t.check('sin 023: el público no recibe nada aunque la fila diga true', r.code === 200 && JSON.stringify(r.body) === '{"activity":{}}', JSON.stringify(r.body));
  t.check('sin 023: feed y perfil 200 sin rastro', (await profile())?.store_slug === 'valeria' && (await feed())?.items?.length >= 1 && await noTrace());
  r = await call({ tok, body: { action: 'update', show_last_seen: true } });
  t.check('sin 023: encenderla -> 503 amable (sin registro no se enciende)', r.code === 503 && r.body?.code === 'last_seen_unavailable', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ tok, body: { action: 'update', show_last_seen: false } });
  t.check('sin 023: apagarla -> 200 (ya estaba apagada para el público)', r.code === 200 && r.body?.show_last_seen === false, `${r.code} ${JSON.stringify(r.body)}`);
  restore();

  // -- sin 021 ni 023 --
  restore = withoutMigration(db, { cols: true });
  r = await call({ tok, body: { action: 'me' } });
  t.check('sin 021/023: Mi cuenta funciona (apagada)', r.code === 200 && r.body?.show_last_seen === false, `${r.code}`);
  r = await call({ tok, body: { action: 'seen' } });
  t.check('sin 021/023: seen -> 200', r.code === 200 && r.body?.updated === false);
  t.check('sin 021/023: ?activity= -> 200 vacío', JSON.stringify((await act()).body) === '{"activity":{}}');
  r = await call({ tok, body: { action: 'update', display_name: 'Valeria M' } });
  t.check('sin 021/023: el resto de update sigue funcionando', r.code === 200 && sp().display_name === 'Valeria M', `${r.code}`);
  restore(); db.tables.last_seen_consents = saved;

  // ---- código y migraciones ----
  const m23 = readFileSync('supabase/migrations/023_last_seen_consent.sql', 'utf8').toLowerCase();
  t.check('023: default false, idempotente', /alter column show_last_seen set default false/.test(m23) && /add column if not exists show_last_seen boolean not null default false/.test(m23));
  t.check('023: tabla last_seen_consents (id, user_id, value, text_version, created_at default now()) con RLS', /create table if not exists public\.last_seen_consents/.test(m23)
    && /user_id\s+text not null/.test(m23) && /value\s+boolean not null/.test(m23) && /text_version text not null/.test(m23) && /created_at\s+timestamptz not null default now\(\)/.test(m23)
    && /enable row level security/.test(m23) && /create index if not exists/.test(m23));
  t.check('023: apaga (y borra la hora) a todos los que no tienen registro de consentimiento', /update public\.seller_profiles/.test(m23) && /show_last_seen = false/.test(m23) && /last_seen_at = null/.test(m23) && /not exists \(select 1 from public\.last_seen_consents/.test(m23));
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  t.check('la app avisa actividad al abrir y al volver (useLastSeenPing en el layout)', /useLastSeenPing\(/.test(layout));
  const ui = readFileSync('components/Payout.tsx', 'utf8');
  t.check('Mi cuenta: interruptor encendido solo si show_last_seen === true', /COPY\.activity\.toggle\b/.test(ui) && /show_last_seen === true/.test(ui) && !/show_last_seen !== false/.test(ui));
  const inv = readFileSync('components/LastSeenInvite.tsx', 'utf8'), vender = readFileSync('app/(tabs)/vender.tsx', 'utf8');
  t.check('Vender: invitación una sola vez, después de crear el link, con el interruptor apagado', /<LastSeenInvite trigger=\{created\.slug\}/.test(vender) && /useState\(false\)/.test(inv) && /markAsked/.test(inv) && /last_seen_decided/.test(inv) && /COPY\.activity\.invite\b/.test(inv));
  const pubUi = readFileSync('components/Feed.tsx', 'utf8') + readFileSync('app/t/[store].tsx', 'utf8');
  t.check('feed y perfil la piden aparte (useActivity), no del feed cacheado', (pubUi.match(/useActivity\(/g) ?? []).length === 2 && !/seller\.activity|p\.activity/.test(pubUi));
  const icons = readFileSync('components/SellerBits.tsx', 'utf8');
  t.check('el punto verde es un ícono (sin emoji)', /ActivityLine/.test(icons) && !/[\u{1F7E2}\u{1F534}\u{26AB}\u{2B24}]/u.test(icons + JSON.stringify(COPY.activity)));
}
