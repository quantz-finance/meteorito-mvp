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
const fresh = (orders = [], card = false, cardMode = 'inapp') => ({ orders: Object.fromEntries(orders.map((o) => [o.slug, base(o)])), calls: [], ph: [], subs: [], ratings: {}, fail: [], seq: 0, card, cardMode, lendara: {} });
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
      return { slug: o.slug, contractId: o.contract_id, amountUsdc: o.amount_usdc, priceCrc: o.price_crc, sinpe: { simulated: true, reference: `MET-${o.slug.toUpperCase()}` }, card: S.card, cardMode: S.cardMode, guest: true };
    }
    if (b.step === 'confirm_sinpe') {
      if (o.buyer !== guest) throw E(403, 'no eres el comprador de este pedido');
      if (o.status === 'fondeado') return { funded: true, fundedTx: o.funded_tx, pin: null }; // idempotente: el PIN no se re-emite
      if (o.status !== 'escrow_creado') throw E(409, 'Primero inicia el pago.', 'bad_state');
      Object.assign(o, { status: 'fondeado', funded_tx: 'f'.repeat(64) }); return { funded: true, fundedTx: o.funded_tx, pin: PIN };
    }
    // Pago con tarjeta (Lendara simulado): el widget es /__mock/lendara/widget/<id> (mismo origen), igual que el real postea
    // { transaction } al padre. card_confirm decide con el estado guardado (como el servidor real con Lendara + Horizon).
    // Tarjeta in-app (card_pay): como api/_lib/lendara.ts cardPay. Aprobada: 1 consulta "pending" y luego completed;
    // demorada: 3 consultas "pending". Rechazada / no recibida: error inmediato con el mensaje real.
    if (b.step === 'card_pay') {
      if (o.buyer !== guest) throw E(403, 'no eres el comprador de este pedido');
      if (!S.card) throw E(503, 'El pago con tarjeta no está disponible por ahora. Paga por SINPE Móvil.', 'card_unavailable');
      if (Object.keys(b).some((k) => /^(card|cardnumber|card_number|number|pan|cvc|cvv|csc|exp|expiry)$/i.test(k))) throw E(400, 'Solicitud inválida.', 'card_input');
      if (o.status !== 'escrow_creado') throw E(409, 'Este pedido ya está pagado o ya no se puede pagar.', 'bad_state');
      if (!['approved', 'kyc_rejected', 'payment_not_received', 'delayed'].includes(b.scenario)) throw E(400, 'Tarjeta no aceptada. Prueba con otra o paga por SINPE Móvil.', 'card_input');
      if (!b.name || !/@/.test(b.email ?? '')) throw E(400, 'Revisa tu correo.', 'card_input');
      if (Object.values(S.lendara).some((x) => x.slug === o.slug && x.status === 'pending_anchor')) return { pending: true };
      const id = `lnd-${Object.keys(S.lendara).length + 1}`;
      if (b.scenario === 'kyc_rejected') { S.lendara[id] = { slug: o.slug, status: 'kyc_rejected' }; throw E(402, 'Tu tarjeta fue rechazada. Prueba con otra tarjeta o paga por SINPE Móvil.', 'card_kyc_rejected'); }
      if (b.scenario === 'payment_not_received') { S.lendara[id] = { slug: o.slug, status: 'expired' }; throw E(402, 'No pudimos procesar el pago con tu tarjeta. Vuelve a intentarlo o paga por SINPE Móvil.', 'card_expired'); }
      S.lendara[id] = { slug: o.slug, status: 'pending_anchor', polls: b.scenario === 'delayed' ? 3 : 1, buyer: { name: b.name, email: b.email } };
      return { pending: true };
    }
    if (b.step === 'card_session' || b.step === 'card_confirm') {
      if (o.buyer !== guest) throw E(403, 'no eres el comprador de este pedido');
      if (!S.card) throw E(503, 'El pago con tarjeta no está disponible por ahora. Paga por SINPE Móvil.', 'card_unavailable');
      if (o.status === 'fondeado' && b.step === 'card_confirm') return { fundedTx: o.funded_tx, pin: null };
      if (o.status !== 'escrow_creado') throw E(409, 'Primero inicia el pago.', 'bad_state');
      const mine = Object.entries(S.lendara).filter(([, x]) => x.slug === o.slug).reverse();
      const done = mine.find(([, x]) => x.status === 'completed');
      const fund = () => { Object.assign(o, { status: 'fondeado', funded_tx: 'c'.repeat(64) }); return { fundedTx: o.funded_tx, pin: PIN }; };
      if (done) return fund();
      const inapp = mine.find(([, x]) => x.status === 'pending_anchor' && x.polls != null);
      if (inapp && b.step === 'card_confirm') { if (--inapp[1].polls <= 0) { inapp[1].status = 'completed'; return fund(); } return { pending: true }; }
      if (mine.some(([, x]) => x.status === 'pending_anchor')) return { pending: true };
      if (b.step === 'card_session') {
        const id = `lnd-${Object.keys(S.lendara).length + 1}`; S.lendara[id] = { slug: o.slug, status: 'incomplete' };
        return { sessionId: id, url: `http://localhost:${port}/__mock/lendara/widget/${id}`, expiresAt: null };
      }
      const last = mine[0]?.[1];
      if (!last) throw E(409, 'Todavía no hay un pago con tarjeta para este pedido. Toca "Pagar con tarjeta".', 'card_no_session');
      if (last.status === 'kyc_rejected') throw E(402, 'Tu tarjeta fue rechazada. Prueba con otra tarjeta o paga por SINPE Móvil.', 'card_kyc_rejected');
      if (last.status === 'expired') throw E(402, 'No pudimos procesar el pago con tu tarjeta. Vuelve a intentarlo o paga por SINPE Móvil.', 'card_expired');
      return { pending: true };
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

// Widget de Lendara simulado: mismo contrato de mensajes que /widget/[id] (postMessage({ transaction }) y lendara:close).
const lendaraWidget = (id) => `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lendara (simulado)</title>
<body style="font:16px system-ui;margin:0;padding:24px;display:grid;gap:12px">
<h1 style="font-size:20px;margin:0">Pago con tarjeta</h1>
<label>Número de tarjeta <input id="n" inputmode="numeric" style="font-size:16px;width:100%;padding:12px" placeholder="4242 4242 4242 4242"></label>
<button id="pay" style="font-size:16px;padding:14px">Pagar</button><button id="close" style="font-size:16px;padding:14px">Cerrar</button>
<script>
const SC = { '4242424242424242': 'completed', '4000000000000002': 'kyc_rejected', '4000000000009995': 'expired', '4000000000000077': 'pending_anchor' };
const post = (m) => parent.postMessage(m, '*');
document.getElementById('pay').onclick = async () => {
  const s = SC[document.getElementById('n').value.replace(/\\s/g, '')] || 'completed';
  await fetch('/__mock/lendara/${id}/' + s, { method: 'POST' });
  const status = s === 'kyc_rejected' ? 'error' : s;
  post({ transaction: { id: '${id}', kind: 'deposit', status, started_at: new Date().toISOString(), message: s === 'kyc_rejected' ? 'KYC rejected (sandbox scenario).' : undefined } });
  document.body.insertAdjacentHTML('beforeend', '<p id="st">' + status + '</p>');
};
document.getElementById('close').onclick = () => post({ type: 'lendara:close' });
</script></body></html>`;

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (u.pathname.startsWith('/__mock/')) {
    const b = await body(req);
    if (u.pathname === '/__mock/reset') { S = fresh(b.orders ?? [], !!b.card, b.cardMode ?? 'inapp'); return send(res, 200, { ok: true }); }
    const lw = u.pathname.match(/^\/__mock\/lendara\/widget\/([\w-]+)$/);
    if (lw) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(lendaraWidget(lw[1])); }
    const ls = u.pathname.match(/^\/__mock\/lendara\/([\w-]+)\/(completed|kyc_rejected|expired|pending_anchor)$/);
    if (ls && S.lendara[ls[1]]) { S.lendara[ls[1]].status = ls[2]; return send(res, 200, { ok: true }); }
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
    S.calls.push({ method: req.method, path: u.pathname, step: b.step, action: b.action, slug: b.slug, guest: !!req.headers['x-guest-key'], at: Date.now(), ...(b.step === 'card_pay' ? { body: b } : {}) });
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
