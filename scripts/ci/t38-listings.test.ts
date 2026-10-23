// (38) Productos permanentes (migración 012): dos compradores pagan el MISMO producto -> dos pedidos con escrows
// separados; el producto sigue disponible. Reintento del mismo comprador reusa su pedido. Pausa bloquea compras.
// Links viejos (sin kind) siguen siendo de un uso. Sin red.
import type { T } from './setup';
import { fakeDb } from './fakedb';
import { childRow, missingColumn, orderForBuyer } from '../../api/_lib/listings';
import { visibleSellerOrders } from '../../lib/listings';
import type { SellerOrder } from '../../lib/orders';

export async function run(t: T) {
  const db = fakeDb();
  const parent = { id: 'p1', slug: 'prod01', kind: 'listing', listing_status: 'activa', stock: null, status: 'creado', seller_address: 'G' + 'S'.repeat(55), seller_user_id: 'seller-1', seller_email: null, category: 'otro', brand: '', model: 'Audífonos', condition: '', price_crc: 25000, description: null, identifier: null, photos: ['https://x/a.jpg'], checks: [] };
  db.tables.orders.push({ ...parent });
  // Despliegue simulado (el real es deployFor -> Trustless Work): un contrato por pedido.
  const deploy = (o: any) => { const r = db.tables.orders.find((x) => x.slug === o.slug); if (!r.contract_id) { r.contract_id = 'C' + o.slug.toUpperCase(); r.status = 'escrow_creado'; } return r; };

  const a = deploy(await orderForBuyer(db, parent, 'guest:A'));
  const b = deploy(await orderForBuyer(db, parent, 'guest:B'));
  t.check('dos compradores -> dos pedidos distintos', a.slug !== b.slug && a.slug !== parent.slug && b.slug !== parent.slug, `${a.slug} ${b.slug}`);
  t.check('cada pedido con su propio escrow', !!a.contract_id && !!b.contract_id && a.contract_id !== b.contract_id);
  t.check('pedidos ligados al producto y a su comprador', a.listing_slug === 'prod01' && b.listing_slug === 'prod01' && a.buyer_user_id === 'guest:A' && b.buyer_user_id === 'guest:B' && a.kind === 'single');
  t.check('precio y destino copiados del producto (inmutables desde ahí)', a.price_crc === 25000 && a.seller_address === parent.seller_address && a.seller_user_id === 'seller-1');
  const p = db.tables.orders.find((x) => x.slug === 'prod01');
  t.check('el producto sigue disponible (creado, activo, sin escrow ni comprador)', p.status === 'creado' && p.listing_status === 'activa' && !p.contract_id && !p.buyer_user_id);
  const again = await orderForBuyer(db, parent, 'guest:A');
  t.check('reintento del mismo comprador -> reusa su pedido (sin escrow duplicado)', again.slug === a.slug && db.tables.orders.length === 3);
  // Tras pagar (fondeado) puede comprar otra vez: pedido nuevo.
  db.tables.orders.find((x) => x.slug === a.slug).status = 'fondeado';
  const second = await orderForBuyer(db, parent, 'guest:A');
  t.check('mismo comprador compra otra vez tras pagar -> pedido nuevo', second.slug !== a.slug);

  const paused = await orderForBuyer(db, { ...parent, listing_status: 'pausada' }, 'guest:C').then(() => null, (e) => e);
  t.check('producto en pausa -> 409 listing_paused', paused?.status === 409 && paused?.code === 'listing_paused');
  const legacy = { id: 'o9', slug: 'viejo1', status: 'creado', price_crc: 1000 };
  t.check('link viejo (sin kind) -> el mismo pedido, como antes', (await orderForBuyer(db, legacy, 'guest:D')) === legacy);
  t.check('pedido hijo sin datos del comprador ajenos', !('buyer_address' in childRow(parent, 'guest:E', 'zzzzzz')));
  t.check('sin migración 012 (columna inexistente) -> se detecta para caer al modo anterior', missingColumn({ code: 'PGRST204', message: "Could not find the 'kind' column" }) && missingColumn({ code: '42703' }) && !missingColumn({ code: '23505' }));
  const seller: SellerOrder[] = db.tables.orders.map((o) => ({ ...o, identifier_masked: null, created_at: '' }));
  seller.push({ slug: 'hijo00', listing_slug: 'prod01', status: 'creado', kind: 'single' } as any);
  const vis = visibleSellerOrders(seller).map((o) => o.slug);
  t.check('Pedidos del vendedor: producto + cada pedido por separado (sin el hijo vacío)', vis.includes('prod01') && vis.includes(a.slug) && vis.includes(b.slug) && !vis.includes('hijo00'));
}
