// (95) Interruptor "Datos de ejemplo" (032, pedido de Rolando): un solo ajuste global en el servidor (app_settings), que
//      solo cambia el admin maestro. Apagado (default): feed, búsqueda, ventas, sugeridas y /t/<ejemplo> sin ningún
//      ejemplo (404). Encendido: los ejemplos se ven para todos. No admin -> 404. Auditoría demo_toggle. Sin función nueva.
import type { T } from './setup';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __resetDemoDataCache, DEMO_CACHE_MS, demoDataOn } from '../../api/_lib/appSettings';
import { DEMO_PRODUCTS } from '../../api/_lib/demoProducts';
import { BANNED_COPY, COPY } from '../../lib/copy';
import store from '../../api/store/index';
import dispute from '../../api/escrow/dispute';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const admin = async (tok: string | null, body: any) => { const r = res(); await dispute(req(tok, { action: 'admin_demo_data', ...body }), r); return r; };
const get = async (query: any) => { const r = res(); await store({ method: 'GET', headers: {}, body: {}, query }, r); return r; };
const post = async (body: any, guest?: string) => { const r = res(); await store({ method: 'POST', headers: guest ? { 'x-guest-key': guest } : {}, body, query: {} }, r); return r; };
const hasDemo = (items: any[]) => (items ?? []).some((i) => i.demo || i.seller?.demo || String(i.slug).startsWith('ej-'));

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = ''; delete process.env.ADMIN_EMAILS;
  const prevEnv = process.env.FEED_DEMO_PRODUCTS; delete process.env.FEED_DEMO_PRODUCTS; // sin freno: decide el interruptor
  try {
    const db = fakeDb(); __setDbForTests(db as any); __resetDemoDataCache();
    const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
    db.tables.seller_profiles = [{ sub: 's-r', store_slug: 'real95', display_name: 'Real', verified: true, created_at: at(900) }];
    db.tables.public_stores = [];
    db.tables.orders = [{ id: 'id-r', slug: 'real01', kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null, seller_user_id: 's-r', brand: '', model: 'iPhone real',
      description: null, price_crc: 25000, photos: ['https://x/r.jpg'], created_at: at(5) }];
    const feed = () => get({ feed: '1', order: 'rank', verified: 'all', limit: '20' });

    // --- Sin migración (sin tabla): apagado ---
    let r = await feed();
    t.check('sin la tabla 032: apagado (solo reales, sin ventas)', r.code === 200 && r.body.items.length === 1 && !hasDemo(r.body.items) && !r.body.sales);

    // --- Apagado (fila en false, el default de 032) ---
    db.tables.app_settings = [{ key: 'demo_data_enabled', value: false }]; __resetDemoDataCache();
    r = await feed();
    t.check('apagado: feed Para ti solo con reales y sin ventas de ejemplo', r.code === 200 && r.body.items.length === 1 && r.body.items[0].slug === 'real01' && !hasDemo(r.body.items) && !('sales' in r.body), JSON.stringify(r.body).slice(0, 160));
    r = await post({ action: 'feed', verified: 'all', q: 'iPhone', limit: '20' });
    t.check('apagado: búsqueda sin ejemplos', r.code === 200 && r.body.items.length === 1 && !hasDemo(r.body.items));
    r = await post({ action: 'feed', verified: 'all', limit: '20' }, 'a'.repeat(64));
    t.check('apagado: feed personalizado (POST) sin ejemplos', r.code === 200 && !hasDemo(r.body.items) && !r.body.sales);
    r = await get({ profile: 'tecno-sabana' });
    t.check('apagado: /t/<tienda de ejemplo> = 404 (no encontrado)', r.code === 404);
    r = await get({ profile: 'real95' });
    t.check('apagado: las tiendas reales siguen igual', r.code === 200 && r.body.store_slug === 'real95');
    r = await get({ demo: 'suggested' });
    t.check('apagado: Siguiendo sin tiendas sugeridas de ejemplo', r.code === 200 && Array.isArray(r.body.stores) && r.body.stores.length === 0);
    r = await get({ demo: 'product', slug: 'ej-iphone-13' });
    t.check('apagado: ficha /p/ej-… = 404', r.code === 404);
    r = await get({ activity: 'tecno-sabana' });
    t.check('apagado: sin última conexión de ejemplo', r.code === 200 && !('tecno-sabana' in (r.body.activity ?? {})));

    // --- Solo el admin maestro ---
    const userTok = await token({ sub: 'u95' });
    r = await admin(userTok, { enabled: true });
    t.check('no admin: cambiarlo -> 404 y no cambia', r.code === 404 && db.tables.app_settings[0].value === false, `${r.code}`);
    r = await admin(userTok, {});
    t.check('no admin: leerlo -> 404', r.code === 404);
    r = await admin(null, { enabled: true });
    t.check('sin sesión -> 401', r.code === 401 && db.tables.app_settings[0].value === false, `${r.code}`);
    const adminTok = await token({ sub: 'admin-sub', email: 'bobbyaliensshop@gmail.com' });
    r = await admin(adminTok, {});
    t.check('admin lo lee: apagado', r.code === 200 && r.body.enabled === false && r.body.available === true);
    r = await admin(adminTok, { enabled: 'si' });
    t.check('valor inválido -> 400', r.code === 400);

    // --- Encendido ---
    r = await admin(adminTok, { enabled: true });
    const audit = db.tables.admin_audit ?? [];
    t.check('admin lo enciende + auditoría demo_toggle', r.code === 200 && r.body.enabled === true && db.tables.app_settings[0].value === true
      && audit.length === 1 && audit[0].kind === 'demo_toggle' && audit[0].admin_email === 'bobbyaliensshop@gmail.com' && audit[0].detail?.enabled === true && audit[0].detail?.before === false);
    r = await feed();
    t.check('encendido: reales primero y después los ejemplos, con ventas de ejemplo', r.code === 200 && r.body.items[0].slug === 'real01' && r.body.items.slice(1).every((i: any) => i.demo) && r.body.items.length > 5
      && Array.isArray(r.body.sales) && r.body.sales.length > 0 && r.body.sales.every((s: any) => s.example === true));
    r = await get({ feed: '1', order: 'rank', verified: 'all', limit: '20', cursor: r.body.next_cursor });
    t.check('encendido: la 2.ª página sin ventas repetidas', r.code === 200 && !r.body.sales);
    r = await post({ action: 'feed', verified: 'all', q: 'iPhone', limit: '20' });
    t.check('encendido: búsqueda con ejemplos y sin ventas mezcladas', r.code === 200 && hasDemo(r.body.items) && !r.body.sales);
    r = await get({ profile: 'tecno-sabana' });
    t.check('encendido: /t/<tienda de ejemplo> = 200', r.code === 200 && r.body.demo === true);
    r = await get({ demo: 'suggested' });
    t.check('encendido: tiendas sugeridas de ejemplo', r.code === 200 && r.body.stores.length === 6 && r.body.stores.every((s: any) => s.demo === true));
    r = await get({ demo: 'product', slug: DEMO_PRODUCTS[0].slug });
    t.check('encendido: ficha de ejemplo, nunca pagable', r.code === 200 && r.body.demo === true && r.body.payable === false);
    r = await get({ demo: 'product', slug: 'real01' });
    t.check('encendido: ?demo=product con un slug real -> 404', r.code === 404);
    r = await post({ action: 'feed', view: 'following', verified: 'all', limit: '20' }, 'b'.repeat(64));
    t.check('encendido: Siguiendo igual sin ejemplos', r.code === 200 && !hasDemo(r.body.items) && !r.body.sales);

    // --- Freno de emergencia ---
    process.env.FEED_DEMO_PRODUCTS = '0';
    r = await feed();
    t.check('FEED_DEMO_PRODUCTS=0 apaga aunque el interruptor esté encendido', r.code === 200 && !hasDemo(r.body.items) && !r.body.sales);
    r = await admin(adminTok, {});
    t.check('el admin ve que el freno está puesto (killed)', r.code === 200 && r.body.enabled === true && r.body.killed === true);
    delete process.env.FEED_DEMO_PRODUCTS;

    // --- Apagarlo otra vez ---
    r = await admin(adminTok, { enabled: false });
    t.check('admin lo apaga (2.ª auditoría)', r.code === 200 && r.body.enabled === false && (db.tables.admin_audit ?? []).length === 2);
    r = await feed();
    t.check('apagado otra vez: sin ejemplos al instante en esta instancia', !hasDemo(r.body.items) && !r.body.sales);
    r = await get({ profile: 'tecno-sabana' });
    t.check('apagado otra vez: /t/<ejemplo> = 404', r.code === 404);

    // --- Caché corta (no lee la base en cada pedido) ---
    t.check('caché ≤ 60 s', DEMO_CACHE_MS > 0 && DEMO_CACHE_MS <= 60_000);
    let reads = 0; const realFrom = db.from.bind(db);
    (db as any).from = (tb: string) => { if (tb === 'app_settings') reads++; return realFrom(tb); };
    __resetDemoDataCache(); const t0 = Date.now();
    await demoDataOn(t0); await demoDataOn(t0 + 1000); await demoDataOn(t0 + 2000);
    const cached = reads;
    await demoDataOn(t0 + DEMO_CACHE_MS + 1);
    t.check('caché: 3 consultas seguidas = 1 lectura; vencida, vuelve a leer', cached === 1 && reads === 2, `${cached}/${reads}`);
    (db as any).from = realFrom;
  } finally { if (prevEnv == null) delete process.env.FEED_DEMO_PRODUCTS; else process.env.FEED_DEMO_PRODUCTS = prevEnv; __resetDemoDataCache(); }

  // --- Migración 032 ---
  const sql = src('supabase/migrations/032_app_settings.sql');
  t.check('032: app_settings (key pk, value jsonb, updated_at), RLS y solo el servidor', /create table if not exists public\.app_settings/.test(sql) && /key\s+text primary key/.test(sql) && /value\s+jsonb not null/.test(sql)
    && /updated_at\s+timestamptz/.test(sql) && /enable row level security/.test(sql) && /revoke all on public\.app_settings from anon, authenticated/.test(sql));
  t.check('032: demo_data_enabled = false por defecto (sin pisar un valor existente)', /'demo_data_enabled', 'false'::jsonb\) on conflict \(key\) do nothing/.test(sql));

  // --- UI: solo el admin maestro, accesible, el único texto nuevo ---
  const tog = src('components/DemoDataToggle.tsx');
  t.check('label exacto "Datos de ejemplo" y sin palabras prohibidas', COPY.demoData.label === 'Datos de ejemplo' && !BANNED_COPY.test(COPY.demoData.label) && !/proteg/i.test(COPY.demoData.label));
  t.check('interruptor accesible (role switch, label, estado) y ≥44 px', /<Switch value=\{on === true\}/.test(tog) && /accessibilityLabel=\{COPY\.demoData\.label\}/.test(tog) && /minHeight: 44/.test(tog));
  t.check('solo lo ve el admin (el servidor decide con admin_me)', /useIsAdmin\(auth\)/.test(tog) && /if \(admin !== true\) return null/.test(tog));
  t.check('vive en Mi cuenta', /<DemoDataToggle \/>/.test(src('components/AccountSheet.tsx')));
  t.check('la app no decide sola: sin flags de demo en el cliente', !/FEED_DEMO_PRODUCTS|FEED_DEMO_SALES|demoProductsOn/.test(src('components/Feed.tsx') + src('components/DemoProduct.tsx') + src('lib/feedSales.ts') + src('lib/demoFeed.ts')));

  // --- Sin función nueva de Vercel: siguen siendo 12 ---
  const fns: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '_lib') walk(p); } else if (/\.ts$/.test(f)) fns.push(p); } };
  walk(new URL('../../api', import.meta.url).pathname);
  t.check('12 funciones de Vercel (sin sumar ninguna)', fns.length === 12, `${fns.length}`);
}
