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
