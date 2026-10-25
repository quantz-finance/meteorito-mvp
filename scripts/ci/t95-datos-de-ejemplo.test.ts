// (95) "Modo de la app" (pedido de Rolando): Datos de ejemplo / Testnet / Mainnet (Próximamente, desactivado). Cada
//      persona en su dispositivo (lib/demoPref.ts); default Testnet = solo reales. La app manda ?ejemplos=1 en el modo
//      "Datos de ejemplo" y el servidor decide POR PEDIDO (demoWanted): sin estado global, lo de uno no afecta a otro.
//      Sin el parámetro: feed, búsqueda, ventas, sugeridas y /t/<ejemplo> sin ningún ejemplo (404). No toca red ni pagos.
import type { T } from './setup';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { res } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { demoWanted } from '../../api/_lib/demoFlag';
import { DEMO_PRODUCTS } from '../../api/_lib/demoProducts';
import { BANNED_COPY, COPY } from '../../lib/copy';
import store from '../../api/store/index';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const get = async (query: any) => { const r = res(); await store({ method: 'GET', headers: {}, body: {}, query }, r); return r; };
const post = async (body: any, guest?: string) => { const r = res(); await store({ method: 'POST', headers: guest ? { 'x-guest-key': guest } : {}, body, query: {} }, r); return r; };
const hasDemo = (items: any[]) => (items ?? []).some((i) => i.demo || i.seller?.demo || String(i.slug).startsWith('ej-'));
const EJ = { ejemplos: '1' };

export async function run(t: T) {
  const prevEnv = process.env.FEED_DEMO_PRODUCTS; delete process.env.FEED_DEMO_PRODUCTS; // sin freno: decide cada pedido
  try {
    const db = fakeDb(); __setDbForTests(db as any);
    const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
    db.tables.seller_profiles = [{ sub: 's-r', store_slug: 'real95', display_name: 'Real', verified: true, created_at: at(900) }];
    db.tables.public_stores = [];
    db.tables.orders = [{ id: 'id-r', slug: 'real01', kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null, seller_user_id: 's-r', brand: '', model: 'iPhone real',
      description: null, price_crc: 25000, photos: ['https://x/r.jpg'], created_at: at(5) }];
    const feed = (extra: any = {}) => get({ feed: '1', order: 'rank', verified: 'all', limit: '20', ...extra });

    // --- Testnet (default: la app no manda el parámetro) ---
    let r = await feed();
    t.check('Testnet (default): feed Para ti solo con reales y sin ventas de ejemplo', r.code === 200 && r.body.items.length === 1 && r.body.items[0].slug === 'real01' && !hasDemo(r.body.items) && !('sales' in r.body), JSON.stringify(r.body).slice(0, 160));
    r = await post({ action: 'feed', verified: 'all', q: 'iPhone', limit: '20' });
    t.check('Testnet: búsqueda sin ejemplos', r.code === 200 && r.body.items.length === 1 && !hasDemo(r.body.items));
    r = await post({ action: 'feed', verified: 'all', limit: '20' }, 'a'.repeat(64));
    t.check('Testnet: feed personalizado (POST) sin ejemplos', r.code === 200 && !hasDemo(r.body.items) && !r.body.sales);
    r = await get({ profile: 'tecno-sabana' });
    t.check('Testnet: /t/<tienda de ejemplo> = 404 (no encontrado)', r.code === 404);
    r = await get({ profile: 'real95' });
    t.check('Testnet: las tiendas reales siguen igual', r.code === 200 && r.body.store_slug === 'real95');
    r = await get({ demo: 'suggested' });
    t.check('Testnet: Siguiendo sin tiendas sugeridas de ejemplo', r.code === 200 && Array.isArray(r.body.stores) && r.body.stores.length === 0);
    r = await get({ demo: 'product', slug: 'ej-iphone-13' });
    t.check('Testnet: ficha /p/ej-… = 404', r.code === 404);
    r = await get({ activity: 'tecno-sabana' });
    t.check('Testnet: sin última conexión de ejemplo', r.code === 200 && !('tecno-sabana' in (r.body.activity ?? {})));
    t.check('solo ejemplos=1 / ejemplos:true lo pide (nada de "true", "si" ni otros)', !demoWanted({ query: { ejemplos: 'true' } }) && !demoWanted({ query: { ejemplos: 'si' } }) && !demoWanted({ body: { ejemplos: '1' } }) && !demoWanted(null)
      && demoWanted({ query: { ejemplos: '1' } }) && demoWanted({ body: { ejemplos: true } }));

    // --- Datos de ejemplo (la app manda ?ejemplos=1) ---
    r = await feed(EJ);
    t.check('Datos de ejemplo: reales primero y después los ejemplos, con ventas de ejemplo', r.code === 200 && r.body.items[0].slug === 'real01' && r.body.items.slice(1).every((i: any) => i.demo) && r.body.items.length > 5
      && Array.isArray(r.body.sales) && r.body.sales.length > 0 && r.body.sales.every((s: any) => s.example === true));
    r = await feed({ ...EJ, cursor: r.body.next_cursor });
    t.check('Datos de ejemplo: la 2.ª página sin ventas repetidas', r.code === 200 && !r.body.sales);
    r = await post({ action: 'feed', ejemplos: true, verified: 'all', q: 'iPhone', limit: '20' });
    t.check('Datos de ejemplo: búsqueda con ejemplos y sin ventas mezcladas', r.code === 200 && hasDemo(r.body.items) && !r.body.sales);
    r = await get({ profile: 'tecno-sabana', ...EJ });
    t.check('Datos de ejemplo: /t/<tienda de ejemplo> = 200', r.code === 200 && r.body.demo === true);
    r = await get({ demo: 'suggested', ...EJ });
    t.check('Datos de ejemplo: tiendas sugeridas de ejemplo', r.code === 200 && r.body.stores.length === 6 && r.body.stores.every((s: any) => s.demo === true));
    r = await get({ demo: 'product', slug: DEMO_PRODUCTS[0].slug, ...EJ });
    t.check('Datos de ejemplo: ficha de ejemplo, nunca pagable', r.code === 200 && r.body.demo === true && r.body.payable === false);
    r = await get({ demo: 'product', slug: 'real01', ...EJ });
    t.check('?demo=product con un slug real -> 404', r.code === 404);
    r = await post({ action: 'feed', ejemplos: true, view: 'following', verified: 'all', limit: '20' }, 'b'.repeat(64));
    t.check('Datos de ejemplo: Siguiendo igual sin ejemplos', r.code === 200 && !hasDemo(r.body.items) && !r.body.sales);

    // --- Lo de una persona no afecta a otra (al mismo tiempo, misma instancia) ---
    const [a, b, c] = await Promise.all([feed(EJ), feed(), get({ profile: 'tecno-sabana' })]);
    t.check('a la vez: quien eligió Datos de ejemplo los ve; otra persona en Testnet no', hasDemo(a.body.items) && !!a.body.sales && !hasDemo(b.body.items) && !b.body.sales && c.code === 404);
    r = await feed();
    t.check('después de que otro pidió ejemplos, Testnet sigue sin ejemplos (sin estado global)', !hasDemo(r.body.items) && !r.body.sales);

    // --- Freno de emergencia ---
    process.env.FEED_DEMO_PRODUCTS = '0';
    r = await feed(EJ);
    t.check('FEED_DEMO_PRODUCTS=0 apaga los ejemplos para todos', r.code === 200 && !hasDemo(r.body.items) && !r.body.sales);
    delete process.env.FEED_DEMO_PRODUCTS;
  } finally { if (prevEnv == null) delete process.env.FEED_DEMO_PRODUCTS; else process.env.FEED_DEMO_PRODUCTS = prevEnv; }

  // --- Modo en el dispositivo: default Testnet, Mainnet no se puede elegir ---
  const store_: Record<string, string> = {};
  (globalThis as any).localStorage = { getItem: (k: string) => store_[k] ?? null, setItem: (k: string, v: string) => { store_[k] = String(v); } };
  try {
    const m = await import('../../lib/demoPref');
    t.check('modo por defecto: Testnet (sin ejemplos)', m.getAppMode() === 'testnet' && m.demoPrefOn() === false);
    t.check('elegir Datos de ejemplo: pide los ejemplos', m.setAppMode('ejemplos') === true && m.getAppMode() === 'ejemplos' && m.demoPrefOn() === true);
    t.check('Mainnet: no se puede elegir (no cambia nada)', m.setAppMode('mainnet') === false && m.getAppMode() === 'ejemplos' && !m.SELECTABLE_MODES.includes('mainnet'));
    store_['meteorito:modo-app'] = 'mainnet';
    t.check('un "mainnet" guardado a mano no vale: vuelve al modo de memoria, nunca Mainnet', m.getAppMode() !== 'mainnet');
    t.check('volver a Testnet', m.setAppMode('testnet') === true && m.demoPrefOn() === false);
  } finally { delete (globalThis as any).localStorage; }

  // --- UI: cualquier cuenta, accesible (radiogroup/radio), textos exactos ---
  const ui = src('components/AppModePicker.tsx');
  t.check('textos exactos: Modo de la app / Datos de ejemplo / Testnet / Mainnet / Próximamente', JSON.stringify(COPY.appMode) === JSON.stringify({ label: 'Modo de la app', ejemplos: 'Datos de ejemplo', testnet: 'Testnet', mainnet: 'Mainnet', soon: 'Próximamente' }));
  t.check('sin palabras prohibidas', Object.values(COPY.appMode).every((x) => !BANNED_COPY.test(x) && !/proteg/i.test(x)));
  t.check('accesible: radiogroup + radio con estado (checked/disabled) y filas de 44 px', /accessibilityRole="radiogroup"/.test(ui) && /accessibilityRole="radio"/.test(ui) && /accessibilityState=\{\{ checked: on, disabled: off \}\}/.test(ui) && /minHeight: 44/.test(ui));
  t.check('Mainnet: visible pero desactivado (disabled, no hace nada al tocar)', /disabled=\{off\}/.test(ui) && /if \(off \|\| on\) return/.test(ui) && /COPY\.appMode\.soon/.test(ui));
  const sheet = src('components/AccountSheet.tsx');
  t.check('en Mi cuenta para cualquier cuenta (sin condición de admin)', /<AppModePicker \/>/.test(sheet) && !/useIsAdmin|admin/.test(ui + sheet));
  const st = src('lib/store.ts');
  t.check('la app manda ejemplos solo en el modo Datos de ejemplo (feed GET/POST, perfil, actividad, sugeridas, ficha)', /demoPrefOn\(\)/.test(st) && /qs\.set\('ejemplos', '1'\)/.test(st)
    && (st.match(/ej\(\) \? \{ ejemplos: true \}/g) ?? []).length === 2 && (st.match(/\$\{ejQs\(\)\}/g) ?? []).length === 4);
  t.check('el modo no toca la red, los escrows ni el pago', !/demoPref|getAppMode/.test(src('lib/chain.ts') + src('lib/wallet.ts') + src('components/PayBox.tsx') + src('lib/orders.ts')));
  t.check('la app no decide sola: sin flags de demo en el cliente', !/FEED_DEMO_PRODUCTS|FEED_DEMO_SALES|demoProductsOn/.test(src('components/Feed.tsx') + src('components/DemoProduct.tsx') + src('lib/feedSales.ts') + src('lib/demoFeed.ts')));

  // --- Sin función nueva de Vercel: siguen siendo 12 ---
  const fns: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '_lib') walk(p); } else if (/\.ts$/.test(f)) fns.push(p); } };
  walk(new URL('../../api', import.meta.url).pathname);
  t.check('12 funciones de Vercel (sin sumar ninguna)', fns.length === 12, `${fns.length}`);
}
