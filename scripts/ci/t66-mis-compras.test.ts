// (66) Mis compras: botón arriba a la derecha en Comprar -> lista de compras de ESTE dispositivo (registro guardado al
//      pagar + recuperación retroactiva por PIN/pedido propio) y del servidor SOLO por la llave de invitado y/o la
//      sesión del comprador (/api/store action 'buyer_orders', sin función nueva). Activas primero, cerradas aparte.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { buyerOrders } from '../../api/_lib/purchases';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import {
  hasLocalPurchases, localPurchaseSlugs, mergePurchases, MY_PURCHASES_ACTIVE, MY_PURCHASES_CLOSED, MY_PURCHASES_EMPTY, MY_PURCHASES_NONE_ACTIVE,
  MY_PURCHASES_TITLE, purchaseNext, purchaseStatus, PURCHASES_KEY, readLocalPurchases, rememberPurchase, rowFromOrder, splitPurchases, type PurchaseRow,
} from '../../lib/purchases';

const read = (f: string) => readFileSync(f, 'utf8');
const BANNED = /\bsegur[oa]s?\b|garant[ií]a|verificad[oa]|\bempresa\b|fintech|\bbanco\b|billetera|proteg/i;
const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const call = async (o: { body?: any; guest?: string; tok?: string }) => {
  const r: any = { code: 0, body: null, headers: {} as Record<string, string> }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: {} }, r); return r;
};
/** localStorage en memoria (con length/key, como el del navegador). */
function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, m };
}

export async function run(t: T) {
  // ---------- API: buyer_orders ----------
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  const gA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!, gB = guestSubFromReq({ headers: { 'x-guest-key': KEY_B } })!;
  const o = (slug: string, buyer: string | null, status: string, extra: any = {}) => ({ id: `id-${slug}`, slug, buyer_user_id: buyer, status, seller_user_id: 'seller1', seller_address: 'GSELLER', seller_email: 'v@x.com',
    identifier: '356938035643809', brand: '', model: `Item ${slug}`, price_crc: '150000', photos: [`https://cdn/x/${slug}.jpg`], contract_id: 'C123', pin_hash: 'h', created_at: `2026-10-${10 + slug.length}T10:00:00Z`, delivery_mode: 'envio', ...extra });
  db.tables.orders.push(o('ga1', gA, 'fondeado'), o('ga22', gA, 'liberado'), o('ga333', gA, 'creado'), o('gb1', gB, 'enviado'), o('cav1', 'cavos-sub-1', 'en_disputa'), o('lst1', null, 'creado', { kind: 'listing' }));

  let r = await call({ body: { action: 'buyer_orders' } });
  t.check('sin llave ni sesión -> 401 (nunca lista nada)', r.code === 401, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'buyer_orders' } });
  const slugsA = (r.body?.orders ?? []).map((x: any) => x.slug).sort().join(',');
  t.check('llave A: solo sus compras (sin la de B, sin la de otra cuenta, sin pedidos sin pagar ni productos)', r.code === 200 && slugsA === 'ga1,ga22', `${r.code} ${slugsA}`);
  t.check('no-store (no se cachea por proxy)', /no-store/.test(r.headers['Cache-Control'] ?? ''), JSON.stringify(r.headers));
  const leaked = JSON.stringify(r.body);
  t.check('sin datos privados: ni comprador, vendedor, correo, identificador, contrato ni PIN', !/buyer_user_id|seller_user_id|seller_email|seller_address|identifier|356938035643809|contract_id|pin|guest:/.test(leaked), leaked);
  const row = r.body.orders.find((x: any) => x.slug === 'ga1');
  t.check('fila: título, monto numérico, foto, estado y tipo de entrega', row.model === 'Item ga1' && row.price_crc === 150000 && row.photo === 'https://cdn/x/ga1.jpg' && row.status === 'fondeado' && row.delivery_mode === 'envio', JSON.stringify(row));
  r = await call({ guest: KEY_B, body: { action: 'buyer_orders' } });
  t.check('llave B: solo la suya', r.body?.orders?.map((x: any) => x.slug).join(',') === 'gb1', JSON.stringify(r.body));
  r = await call({ guest: 'c'.repeat(64), body: { action: 'buyer_orders' } });
  t.check('llave nueva sin compras -> lista vacía', r.code === 200 && r.body.orders.length === 0);
  const tok = await token({ sub: 'cavos-sub-1' });
  r = await call({ tok, body: { action: 'buyer_orders' } });
  t.check('con sesión: las compras de la cuenta', r.code === 200 && r.body.orders.map((x: any) => x.slug).join(',') === 'cav1', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ tok, guest: KEY_A, body: { action: 'buyer_orders' } });
  t.check('llave + sesión: las dos (este dispositivo y la cuenta)', r.body?.orders?.map((x: any) => x.slug).sort().join(',') === 'cav1,ga1,ga22', JSON.stringify(r.body));
  r = await call({ tok: 'malo', guest: KEY_A, body: { action: 'buyer_orders' } });
  t.check('token malo + llave: se ignora el token (solo lo de la llave)', r.code === 200 && r.body.orders.map((x: any) => x.slug).sort().join(',') === 'ga1,ga22', `${r.code}`);
  t.check('buyerOrders sin identidades -> [] sin consultar', (await buyerOrders({ from: () => { throw new Error('no debería consultar'); } }, [])).length === 0);
  // Sin migraciones 017/005: se piden solo las columnas básicas.
  const asked: string[] = [];
  const old = { from: () => ({ select: (c: string) => { asked.push(c); const q: any = { in: () => q, neq: () => q, order: () => q, limit: async () => (c.includes('delivery_mode') ? { data: null, error: { code: '42703', message: 'column orders.delivery_mode does not exist' } } : { data: [{ slug: 'x1', brand: 'Apple', model: 'iPhone', price_crc: 1, photos: null, status: 'enviado', created_at: null }], error: null }) }; return q; } }) };
  const legacy = await buyerOrders(old, [gA]);
  t.check('sin columnas nuevas: reintenta con las básicas', asked.length === 2 && legacy[0]?.slug === 'x1' && legacy[0].delivery_mode === null && legacy[0].photo === null, JSON.stringify({ asked, legacy }));

  // ---------- Registro local + recuperación retroactiva ----------
  const ls = mem({
    'meteorito:guest:v1': KEY_A, // la llave no es una compra
    'meteorito:guest:pin:old111': '135790', // compra anterior a este registro: solo quedó el PIN
    'meteorito.listing-orders': JSON.stringify({ prod01: 'hab12c', bad: '../x' }), // pedido propio de un producto permanente
    'meteorito:rated:zzz999': '5',
  });
  t.check('retroactivo: PIN guardado y pedido propio de un producto cuentan como compras (sin la llave ni basura)', localPurchaseSlugs(ls as any).sort().join(',') === 'hab12c,old111' && hasLocalPurchases(ls as any), localPurchaseSlugs(ls as any).join(','));
  t.check('dispositivo sin nada -> sin compras', !hasLocalPurchases(mem() as any));
  rememberPurchase({ slug: 'new222', title: 'Bici de montaña', price_crc: 150000, photo: 'https://cdn/x/b.jpg', status: 'escrow_creado', delivery_mode: 'envio', at: '2026-10-24T10:00:00Z' }, ls as any);
  rememberPurchase({ slug: 'new222', title: 'Artículo', price_crc: 150000, photo: null, status: 'fondeado', at: '2026-10-24T10:05:00Z' }, ls as any);
  const saved = readLocalPurchases(ls as any);
  t.check('al pagar se guarda la compra y se actualiza sin perder título ni foto', saved.length === 1 && saved[0].slug === 'new222' && saved[0].status === 'fondeado' && saved[0].title === 'Bici de montaña' && saved[0].photo === 'https://cdn/x/b.jpg', JSON.stringify(saved));
  t.check('el registro guarda solo la fila (sin llave ni PIN)', !/135790|aaaa/.test(ls.getItem(PURCHASES_KEY) ?? ''));
  rememberPurchase({ slug: 'x/../y', title: 'malo' }, ls as any);
  t.check('slug inválido no se guarda', readLocalPurchases(ls as any).length === 1);
  ls.setItem(PURCHASES_KEY, '{roto');
  t.check('registro dañado no rompe', readLocalPurchases(ls as any).length === 0);
  for (let i = 0; i < 60; i++) rememberPurchase({ slug: `s${String(i).padStart(4, '0')}`, title: 'x', status: 'liberado' }, ls as any);
  t.check('registro acotado a 50', readLocalPurchases(ls as any).length === 50);

  // ---------- Lista: activas primero, cerradas aparte ----------
  const R = (slug: string, status: string | null, at: string, extra: Partial<PurchaseRow> = {}): PurchaseRow => ({ slug, title: slug, price_crc: 1000, photo: null, status, at, ...extra });
  const { active, closed } = splitPurchases([
    R('pag', 'fondeado', '2026-10-20T00:00:00Z'), R('env', 'enviado', '2026-10-22T00:00:00Z'), R('dis', 'en_disputa', '2026-10-21T00:00:00Z'),
    R('lib', 'liberado', '2026-10-23T00:00:00Z'), R('res', 'resuelto', '2026-10-19T00:00:00Z', { resolution: { buyerPct: 100 } }), R('can', 'cancelado', '2026-10-18T00:00:00Z'),
    R('nopag', 'creado', '2026-10-24T00:00:00Z'), R('sin', null, '2026-10-24T00:00:00Z'), R('esp', 'escrow_creado', '2026-10-01T00:00:00Z'),
  ]);
  t.check('activas: pagado, enviado, en disputa y pago sin terminar; lo más reciente primero', active.map((x) => x.slug).join(',') === 'env,dis,pag,esp', active.map((x) => x.slug).join(','));
  t.check('cerradas: liberado, resuelto, cancelado (sin "creado" ni filas sin estado)', closed.map((x) => x.slug).join(',') === 'lib,res,can', closed.map((x) => x.slug).join(','));
  t.check('estado visible', purchaseStatus(R('a', 'fondeado', '')) === 'Pagado' && purchaseStatus(R('a', 'enviado', '')) === 'Enviado' && purchaseStatus(R('a', 'en_disputa', '')) === 'En disputa'
    && purchaseStatus(R('a', 'resuelto', '', { resolution: { buyerPct: 100 } })) === 'Reembolsado' && purchaseStatus(R('a', 'liberado', '')) === 'Pago liberado');
  t.check('siguiente paso: envío, cara a cara (tu código), enviado (tu código), disputa', purchaseNext(R('a', 'fondeado', '')) === 'Esperando que el vendedor lo envíe.'
    && purchaseNext(R('a', 'fondeado', '', { delivery_mode: 'cara_a_cara' })) === 'Revisa el producto y dale tu código al vendedor.'
    && purchaseNext(R('a', 'enviado', '')) === 'Cuando lo recibas, dale tu código al vendedor.' && purchaseNext(R('a', 'en_disputa', '')) === 'Lo estamos revisando. El pago está en pausa.');
  const merged = mergePurchases([rowFromOrder({ slug: 'mm1', brand: '', model: '', price_crc: 5, photos: [], status: 'enviado', created_at: '2026-10-24T00:00:00Z' })!],
    [R('mm1', 'fondeado', '2026-10-20T00:00:00Z', { title: 'Bici', photo: 'https://cdn/b.jpg' })]);
  t.check('merge: estado del servidor + título y foto del registro local', merged.length === 1 && merged[0].status === 'enviado' && merged[0].title === 'Bici' && merged[0].photo === 'https://cdn/b.jpg', JSON.stringify(merged));
  t.check('foto: solo https o ruta propia', rowFromOrder({ slug: 'pp1', photos: ['javascript:alert(1)'], status: 'fondeado' })!.photo === null && rowFromOrder({ slug: 'pp1', photo: '//evil/x.png', status: 'fondeado' })!.photo === null);

  // ---------- Copy ----------
  const copy = [MY_PURCHASES_TITLE, MY_PURCHASES_EMPTY, MY_PURCHASES_ACTIVE, MY_PURCHASES_CLOSED, MY_PURCHASES_NONE_ACTIVE,
    ...['escrow_creado', 'fondeado', 'enviado', 'en_disputa', 'entregado', 'liberado', 'resuelto', 'cancelado'].flatMap((s) => [purchaseNext({ status: s }), purchaseNext({ status: s, delivery_mode: 'cara_a_cara' }), purchaseStatus({ status: s })])];
  t.check('copy sin palabras prohibidas', !copy.some((c) => BANNED.test(c)), copy.find((c) => BANNED.test(c)));
  t.check('estado vacío amable: este dispositivo o tu cuenta', MY_PURCHASES_EMPTY === 'Aquí van a aparecer las compras que hagas en este dispositivo o con tu cuenta.');
  const screenSrc = read('app/mis-compras.tsx');
  const literals = [...screenSrc.matchAll(/(?:title|label)="([^"]+)"|>([^<>{}]*[a-záéíóú][^<>{}]*)</g)].map((m) => m[1] ?? m[2]).filter(Boolean);
  t.check('pantalla sin palabras prohibidas', !literals.some((c) => BANNED.test(c)), literals.find((c) => BANNED.test(c)));

  // ---------- Cableado ----------
  const comprar = read('app/(tabs)/comprar.tsx');
  t.check('Comprar: botón de icono arriba a la derecha "Mis compras" -> /mis-compras', /right=\{<IconButton icon="bag-handle-outline" label=\{MY_PURCHASES_TITLE\} onPress=\{\(\) => router\.push\('\/mis-compras'\)\}/.test(comprar) && MY_PURCHASES_TITLE === 'Mis compras');
  const pay = read('components/PayBox.tsx');
  t.check('PayBox guarda la compra al iniciar el pago (pedido propio) y al completarlo', /remember\(r\.slug \?\? order\.slug, 'escrow_creado'\)/.test(pay) && /remember\(order\.slug, 'fondeado'\)/.test(pay));
  t.check('cada fila abre su seguimiento /p/<pedido>', /pathname: '\/p\/\[slug\]', params: \{ slug: r\.slug \}/.test(screenSrc));
  t.check('pantalla sin scroll (páginas con GridPager) y cerradas detrás de un selector', /scroll=\{false\}/.test(screenSrc) && /GridPager/.test(screenSrc) && /accessibilityRole="tablist"/.test(screenSrc));
  const layout = read('app/_layout.tsx');
  t.check('Mis compras visible sin cuenta (comprador invitado) + acceso en la bienvenida si este dispositivo compró', /segments\[0\] === 'mis-compras'/.test(layout) && /hasLocalPurchases\(\)/.test(read('components/Welcome.tsx')));
  const loader = read('lib/myPurchases.ts');
  t.check('servidor por /api/store action buyer_orders (llave y/o sesión), sin función nueva', /guestApi<[^>]+>\(auth, '\/api\/store', \{ action: 'buyer_orders' \}\)/.test(loader));
  const fns: string[] = []; const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '_lib' && f !== 'api') walk(p); } else if (/\.ts$/.test(f) && f !== 'tsconfig.json') fns.push(p); } };
  walk('api');
  t.check('siguen siendo 12 funciones de Vercel', fns.length === 12, fns.join(','));
}
