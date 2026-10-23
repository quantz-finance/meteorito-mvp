// Backend simulado + estáticos para el E2E del build REAL (dist-e2e). Mismas formas de respuesta que api/* y la vista
// public_orders. Sin red ni dinero. Control desde los tests: POST /__mock/reset, GET /__mock/state, POST /__mock/fail.
// Uso: node scripts/e2e/mock-server.mjs [carpeta=dist-e2e] [puerto=8084]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'dist-e2e');
const port = Number(process.argv[3] ?? 8084);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const PIN = '135790';
// Llave VAPID pública de prueba (65 bytes, formato base64url). No es una llave real.
const VAPID = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');

let S;
const fresh = (orders = []) => ({ orders: Object.fromEntries(orders.map((o) => [o.slug, base(o)])), calls: [], ph: [], subs: [], ratings: {}, fail: [], seq: 0 });
const base = (o) => ({ kind: 'single', listing_slug: null, listing_status: 'activa', status: 'creado', category: 'otro', brand: '', model: 'Bici de montaña', condition: '', price_crc: 150000,
  description: null, photos: [], identifier_masked: null, checks_summary: [], created_at: new Date().toISOString(), amount_usdc: null, contract_id: null, funded_tx: null, shipped_tx: null,
  released_tx: null, approval_reason: null, auto_release_at: null, disputed_at: null, dispute_tx: null, resolved_tx: null, resolution: null, buyer: null, pin_attempts: 0, ...o });
S = fresh();
const PRIV = ['buyer', 'pin_attempts'];
const pub = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !PRIV.includes(k)));
const hex = (n) => Array.from({ length: n }, (_, i) => ((S.seq * 31 + i * 7) % 16).toString(16)).join('');

function staticFile(path) {
  const clean = decodeURIComponent(path.split('?')[0]).replace(/\.\./g, '');
  if (/^\/p\/[^/]+$/.test(clean)) return join(root, 'p/[slug].html');
  if (/^\/t\/[^/]+$/.test(clean)) return join(root, 't/[store].html');
  if (/^\/i\/[^/]+$/.test(clean) && clean !== '/i/nueva') return join(root, 'i/[code].html');
  const direct = join(root, clean);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (existsSync(direct + '.html')) return direct + '.html';
  return join(root, 'index.html');
}
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });
// PostHog simulado (EXPO_PUBLIC_POSTHOG_HOST=http://localhost:8084/ph): guarda los eventos en S.ph.
const raw = (req) => new Promise((ok) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => ok(Buffer.concat(c))); });
function decodePh(buf, q, type = '') {
  try {
    let txt;
    if (q.get('compression') === 'gzip-js' || (buf[0] === 0x1f && buf[1] === 0x8b)) txt = gunzipSync(buf).toString('utf8');
    else {
      txt = buf.toString('utf8');
      if (type.includes('form') || txt.startsWith('data=')) { const d = new URLSearchParams(txt).get('data') ?? ''; txt = Buffer.from(d, 'base64').toString('utf8'); }
      else if (q.get('compression') === 'base64') txt = Buffer.from(txt, 'base64').toString('utf8');
    }
    const j = JSON.parse(txt);
    return Array.isArray(j) ? j : Array.isArray(j.batch) ? j.batch : [j];
  } catch { return []; }
}
const send = (res, code, j) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(JSON.stringify(j)); };
const E = (status, error, code) => Object.assign(new Error(error), { status, code });

async function api(req, path, q, b) {
  const guest = String(req.headers['x-guest-key'] ?? '');
  const needGuest = () => { if (!/^[0-9a-f]{64}$/.test(guest)) throw E(401, 'Falta la llave de invitado. Vuelve a abrir el link en el mismo navegador.', 'guest_key_missing'); };
  const get = (slug) => { const o = S.orders[slug]; if (!o) throw E(404, 'Pedido no encontrado', 'not_found'); return o; };
  if (path === '/api/health') return { ok: true, config: { autoReleaseMinutes: 10 } };
  if (path === '/api/escrow/pay') {
    needGuest(); let o = get(String(b.slug));
    if (b.step === 'start') {
      if (o.kind === 'listing') {
        if (o.listing_status !== 'activa') throw E(409, 'El vendedor pausó este producto por ahora.', 'listing_paused');
        const parent = o; o = Object.values(S.orders).find((c) => c.listing_slug === parent.slug && c.buyer === guest && ['creado', 'escrow_creado'].includes(c.status));
        if (!o) { S.seq++; const slug = 'h' + hex(5); o = S.orders[slug] = base({ ...parent, slug, kind: 'single', listing_slug: parent.slug, buyer: guest, status: 'creado' }); }
      }
      if (o.buyer && o.buyer !== guest) throw E(403, 'este pedido ya tiene comprador', 'taken');
      if (!['creado', 'escrow_creado'].includes(o.status)) throw E(409, 'Este pedido ya no está disponible.', 'bad_state');
      Object.assign(o, { buyer: guest, status: 'escrow_creado', contract_id: o.contract_id ?? 'C' + 'E2E'.padEnd(55, 'A'), amount_usdc: Math.round(o.price_crc / 510 * 100) / 100 });
      return { slug: o.slug, contractId: o.contract_id, amountUsdc: o.amount_usdc, priceCrc: o.price_crc, sinpe: { simulated: true, reference: `MET-${o.slug.toUpperCase()}` }, guest: true };
    }
    if (b.step === 'confirm_sinpe') {
      if (o.buyer !== guest) throw E(403, 'no eres el comprador de este pedido');
      if (o.status === 'fondeado') return { funded: true, fundedTx: o.funded_tx, pin: null }; // idempotente: el PIN no se re-emite
      if (o.status !== 'escrow_creado') throw E(409, 'Primero inicia el pago.', 'bad_state');
      Object.assign(o, { status: 'fondeado', funded_tx: 'f'.repeat(64) }); return { funded: true, fundedTx: o.funded_tx, pin: PIN };
    }
    throw E(400, 'step inválido');
  }
  if (path === '/api/escrow/confirm') {
    needGuest(); const o = get(String(b.slug));
    if (o.buyer !== guest) throw E(403, 'no eres el comprador');
    if (o.status !== 'enviado') throw E(409, 'Este pedido no está enviado.', 'bad_state');
    Object.assign(o, { status: 'liberado', released_tx: 'r'.repeat(64), approval_reason: 'buyer_confirm' }); return { released: true, releasedTx: o.released_tx };
  }
  if (path === '/api/escrow/dispute') {
    needGuest(); const o = get(String(b.slug));
    if (o.buyer !== guest) throw E(403, 'Solo el comprador puede reportar un problema.');
    if (!['fondeado', 'enviado', 'entregado'].includes(o.status)) throw E(409, 'Ya no se puede reportar un problema.', 'bad_state');
    Object.assign(o, { status: 'en_disputa', disputed_at: new Date().toISOString() }); return { disputed: true };
  }
  if (path === '/api/escrow/cron') {
    const o = S.orders[String(q.get('slug'))];
    if (o && o.status === 'enviado' && o.auto_release_at && new Date(o.auto_release_at) <= new Date() && o.pin_attempts < 3) Object.assign(o, { status: 'liberado', released_tx: 'a'.repeat(64), approval_reason: 'timeout' });
    return { ok: true };
  }
  if (path === '/api/store') {
    if (req.method === 'GET' && q.get('push') === 'key') return { key: VAPID };
    if (req.method === 'GET' && q.get('store')) return q.get('store') === 'valeria' ? { store_slug: 'valeria', display_name: 'Valeria', rating_avg: null, rating_count: 0, items: Object.values(S.orders).filter((o) => o.status === 'creado' && !o.listing_slug && o.listing_status === 'activa').map((o) => ({ slug: o.slug, title: o.model, price_crc: o.price_crc, photo: null })) } : null;
    if (b.action === 'push_subscribe') { needGuest(); if (!b.subscription?.endpoint) throw E(400, 'suscripción inválida'); S.subs.push({ guest, endpoint: b.subscription.endpoint }); return { ok: true }; }
    if (b.action === 'rate') {
      needGuest(); const o = get(String(b.slug)); const stars = Number(b.stars);
      if (o.buyer !== guest) throw E(403, 'Solo el comprador puede calificar.');
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw E(400, 'Elige de 1 a 5 estrellas.', 'bad_stars');
      if (S.ratings[o.slug]) throw E(409, 'Ya calificaste este pedido.', 'already_rated');
      S.ratings[o.slug] = stars; return { rated: true, stars };
    }
    throw E(401, 'Inicia sesión para continuar.');
  }
  if (path === '/api/invites') { if (req.method === 'GET') throw E(404, 'invitación no existe'); needGuest(); throw E(400, 'op inválida'); }
  throw E(404, 'no simulado: ' + path);
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (u.pathname.startsWith('/__mock/')) {
    const b = await body(req);
    if (u.pathname === '/__mock/reset') { S = fresh(b.orders ?? []); return send(res, 200, { ok: true }); }
    if (u.pathname === '/__mock/state') return send(res, 200, S);
    if (u.pathname === '/__mock/patch') { Object.assign(S.orders[b.slug], b.set); return send(res, 200, S.orders[b.slug]); }
    if (u.pathname === '/__mock/fail') { S.fail.push(b); return send(res, 200, { ok: true }); }
  }
  if (u.pathname.startsWith('/ph/')) {
    if (req.method === 'POST') {
      const evs = decodePh(await raw(req), u.searchParams, String(req.headers['content-type'] ?? ''));
      for (const e of evs) if (e?.event) S.ph.push({ event: e.event, distinct_id: e.distinct_id, properties: e.properties ?? {}, $set_once: e.$set_once ?? e.properties?.$set_once });
    }
    if (u.pathname.includes('/flags') || u.pathname.includes('/decide')) return send(res, 200, { featureFlags: {}, featureFlagPayloads: {}, sessionRecording: false, supportedCompression: [] });
    return send(res, 200, { status: 1 });
  }
  if (u.pathname.startsWith('/sb/rest/v1/public_orders')) {
    const slug = (u.searchParams.get('slug') ?? '').replace(/^eq\./, '');
    S.calls.push({ method: 'GET', path: '/sb/public_orders', slug });
    return send(res, 200, S.orders[slug] ? [pub(S.orders[slug])] : []);
  }
  if (u.pathname.startsWith('/sb/')) return send(res, 404, { message: 'no simulado' });
  if (u.pathname.startsWith('/api/')) {
    const b = req.method === 'POST' ? await body(req) : {};
    S.calls.push({ method: req.method, path: u.pathname, step: b.step, action: b.action, slug: b.slug, guest: !!req.headers['x-guest-key'], at: Date.now() });
    const f = S.fail.find((x) => x.path === u.pathname && (x.step == null || x.step === b.step) && x.times > 0);
    if (f) { f.times--; if (f.delayMs) await new Promise((r) => setTimeout(r, f.delayMs)); if (f.status) return send(res, f.status, { error: f.error ?? 'Error del servidor de prueba', code: f.code }); }
    try { return send(res, 200, await api(req, u.pathname, u.searchParams, b)); }
    catch (e) { return send(res, e.status ?? 500, { error: e.message, code: e.code }); }
  }
  const file = staticFile(u.pathname);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`E2E mock en http://localhost:${port} (carpeta: ${root})`));
