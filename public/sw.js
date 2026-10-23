// Service worker de Meteorito (lo completa scripts/build/preload.mjs al exportar: versión + precache).
// - /_expo/static y /assets: nombres con hash de contenido -> cache-first (segunda visita sin red para el JS/imágenes).
// - Páginas: red primero (siempre la versión nueva); sin red, la última copia guardada.
// - /api y otros dominios (Supabase, Stellar, Cavos): no se tocan.
const V = '__SW_VERSION__';
const STATIC = 'mt-static-' + V, PAGES = 'mt-pages-' + V;
const PRECACHE = [/*__PRECACHE__*/];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mt-') && k !== STATIC && k !== PAGES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if (/^\/(_expo\/static|assets)\//.test(u.pathname)) {
    e.respondWith(caches.open(STATIC).then((c) => c.match(r).then((hit) => hit || fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }))));
    return;
  }
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const cp = res.clone(); caches.open(PAGES).then((c) => c.put(r, cp)); } return res; })
      .catch(() => caches.open(PAGES).then((c) => c.match(r).then((hit) => hit || c.match('/')))).then((res) => res || Response.error()));
  }
});

// Web Push: aviso de cada paso del pedido. Al tocarlo se abre (o enfoca) el pedido.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Meteorito';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/pedidos' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/pedidos', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const same = cs.find((c) => c.url === url) || cs[0];
    if (same) return same.focus().then((c) => (c && c.url !== url && 'navigate' in c ? c.navigate(url) : c));
    return self.clients.openWindow(url);
  }));
});
