// (61) Perfil público del vendedor (/t/<usuario>): verificado, ventas, miembro desde, reseñas de compras verificadas,
//      WhatsApp SOLO si el vendedor lo puso, sin datos privados, meta OG para compartir (escapados) y vercel.json. Sin red.
import type { T } from './setup';
import { COPY } from '../../lib/copy';
import { OG_IDENTITY } from '../../api/_lib/feed';
import { readFileSync } from 'node:fs';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import { timeAgo, memberSince } from '../../lib/timeago';

const get = async (query: Record<string, string>, headers: Record<string, string> = {}) => {
  const h: Record<string, string> = {};
  const r: any = { code: 0, body: null, raw: '', headers: h };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { h[k.toLowerCase()] = v; return r; };
  r.send = (b: string) => { r.raw = b; try { r.body = JSON.parse(b); } catch { r.body = null; } return r; };
  await store({ method: 'GET', headers, body: {}, query }, r);
  return r;
};

export async function run(t: T) {
  const now = Date.UTC(2026, 9, 24, 12, 0);
  t.check('timeAgo: ahora / min / h / días / semanas / meses', timeAgo(new Date(now - 20e3).toISOString(), now) === 'ahora' && timeAgo(new Date(now - 5 * 60e3).toISOString(), now) === 'hace 5 min'
    && timeAgo(new Date(now - 3 * 3600e3).toISOString(), now) === 'hace 3 h' && timeAgo(new Date(now - 86400e3).toISOString(), now) === 'hace 1 día'
    && timeAgo(new Date(now - 3 * 86400e3).toISOString(), now) === 'hace 3 días' && timeAgo(new Date(now - 15 * 86400e3).toISOString(), now) === 'hace 2 sem'
    && timeAgo(new Date(now - 70 * 86400e3).toISOString(), now) === 'hace 2 meses', timeAgo(new Date(now - 15 * 86400e3).toISOString(), now));
  t.check('memberSince: "oct. 2026"', memberSince('2026-10-03T10:00:00Z') === 'oct. 2026', memberSince('2026-10-03T10:00:00Z'));

  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [
    { sub: 's-vale', store_slug: 'valeria', display_name: 'Valeria <b>Mora</b>', avatar_url: 'https://x/v.jpg', contact_phone: '+50688881234', whatsapp_public: true, verified: true, verified_at: '2026-10-10T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    { sub: 's-jose', store_slug: 'jose', display_name: 'José', contact_phone: '+50677776666', whatsapp_public: false, created_at: '2026-10-01T00:00:00Z' },
  ];
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria', rating_avg: '4.50', rating_count: 2, verified: true }, { store_slug: 'jose', display_name: 'José', rating_avg: null, rating_count: 0 }];
  db.tables.public_store_items = [{ store_slug: 'valeria', slug: 'aaaaa1', title: 'Silla', price_crc: 25000, photo: 'https://x/0.jpg', created_at: '2026-10-20T00:00:00Z' }];
  db.tables.orders = [
    { id: 'o1', slug: 'zzzzz1', seller_user_id: 's-vale', buyer_user_id: 'guest:abc', status: 'liberado', seller_email: 'vale@correo.com' },
    { id: 'o2', slug: 'zzzzz2', seller_user_id: 's-vale', buyer_user_id: 'guest:def', status: 'liberado' },
    { id: 'o3', slug: 'zzzzz3', seller_user_id: 's-vale', buyer_user_id: 'guest:ghi', status: 'enviado' },
    { id: 'o4', slug: 'zzzzz4', seller_user_id: 's-vale', buyer_user_id: 'guest:jkl', status: 'resuelto', price_crc: 99000, resolution: { buyerPct: 50 } },
    { id: 'o5', slug: 'zzzzz5', seller_user_id: 's-vale', buyer_user_id: 'guest:mno', status: 'en_disputa', price_crc: 77000 },
  ];
  db.tables.seller_ratings = [
    { order_id: 'o1', order_slug: 'zzzzz1', seller_user_id: 's-vale', buyer_user_id: 'guest:abc', stars: 5, created_at: '2026-10-21T00:00:00Z' },
    { order_id: 'o2', order_slug: 'zzzzz2', seller_user_id: 's-vale', buyer_user_id: 'guest:def', stars: 4, created_at: '2026-10-22T00:00:00Z' },
  ];

  let r = await get({ profile: 'valeria' });
  const p = r.body;
  t.check('perfil: nombre, foto, verificado, estrellas, ventas completadas y miembro desde', r.code === 200 && p.display_name === 'Valeria <b>Mora</b>' && p.avatar_url === 'https://x/v.jpg' && p.verified === true
    && p.rating_avg === 4.5 && p.rating_count === 2 && p.sales_completed === 3 && p.member_since === '2026-09-01T00:00:00Z', JSON.stringify(p));
  t.check('perfil: cómo salieron sus ventas, sin montos (2 sin problemas, 1 disputa resuelta, 1 en disputa)', p?.sales?.completed === 3 && p.sales.no_issues === 2 && p.sales.disputes_resolved === 1 && p.sales.disputes_open === 1
    && !/99000|77000|price|amount|buyerPct/.test(JSON.stringify(p.sales)), JSON.stringify(p?.sales));
  t.check('perfil: WhatsApp como wa.me cuando el vendedor eligió mostrarlo', p?.whatsapp === 'https://wa.me/50688881234', p?.whatsapp);
  t.check('perfil: productos y reseñas (más nuevas primero, nombre corto, sin id del comprador)', p?.items?.length === 1 && p?.reviews?.map((x: any) => x.stars).join() === '4,5'
    && p.reviews.every((x: any) => 'buyer_name' in x && !('buyer_user_id' in x)), JSON.stringify(p?.reviews));
  const txt = JSON.stringify(p);
  t.check('perfil: sin datos privados (sub, correo, comprador, contact_phone crudo, pedidos)', !/s-vale|correo\.com|guest:|"sub"|contact_phone|zzzzz|"\+506/.test(txt), txt.slice(0, 300));
  t.check('perfil: caché corta pública', /public/.test(r.headers['cache-control']) && /s-maxage=\d+/.test(r.headers['cache-control']));
  r = await get({ profile: 'jose' });
  t.check('teléfono guardado pero sin elegir mostrarlo -> whatsapp null y el número no sale', r.code === 200 && r.body.whatsapp === null && !JSON.stringify(r.body).includes('7777'), JSON.stringify(r.body));
  t.check('sin verificar -> verified false; sin reseñas -> []', r.code === 200 && r.body.whatsapp === null && r.body.verified === false && r.body.reviews.length === 0 && r.body.sales_completed === 0, JSON.stringify(r.body));
  db.tables.seller_profiles[1].contact_phone = null; db.tables.seller_profiles[1].whatsapp_public = true;
  r = await get({ profile: 'jose' });
  t.check('eligió mostrarlo pero no tiene teléfono -> whatsapp null', r.body?.whatsapp === null);
  const orig = db.from; const colErr = { code: '42703', message: 'column seller_profiles.whatsapp_public does not exist' };
  (db as any).from = (tb: string) => { const q = orig(tb); const sel = q.select;
    q.select = (cols?: string) => (tb === 'seller_profiles' && /whatsapp_public/.test(String(cols ?? '')) ? Object.assign(q, { maybeSingle: async () => ({ data: null, error: colErr }) }) : sel(cols)); return q; };
  delete db.tables.seller_profiles[0].whatsapp_public; // sin la columna (el fake devuelve todas las columnas)
  r = await get({ profile: 'valeria' });
  t.check('sin migración 018: el perfil carga y NO muestra WhatsApp (se prometió solo tras pagar)', r.code === 200 && r.body?.whatsapp === null && !!r.body?.display_name, `${r.body?.whatsapp}`);
  (db as any).from = orig;
  r = await get({ profile: 'no-existe' });
  t.check('perfil inexistente -> 404', r.code === 404, `${r.code}`);
  r = await get({ store: 'valeria' });
  t.check('GET ?store (Mi tienda / compatibilidad) sigue sin teléfono', r.code === 200 && !JSON.stringify(r.body).includes('8888'));

  // Vista previa al compartir (bots): HTML con OG del vendedor, escapado; host desconocido -> no se hace fetch (SSRF).
  r = await get({ og: 'valeria' }, { host: 'evil.example.com' });
  t.check('og: HTML con og:title/og:description/og:image/og:url del vendedor', r.code === 200 && /text\/html/.test(r.headers['content-type'])
    && /property="og:title" content="Valeria &lt;b&gt;Mora&lt;\/b&gt; \(identidad confirmada\) en Meteorito"/.test(r.raw) && /og:image" content="https:\/\/x\/v\.jpg"/.test(r.raw)
    && /og:url" content="https:\/\/pago\.meteorito\.app\/t\/valeria"/.test(r.raw) && /4\.5 estrellas \(2 reseñas\)/.test(r.raw), r.raw.slice(0, 400));
  t.check('og: nada sin escapar ni el teléfono', !/<b>Mora/.test(r.raw) && !/8888/.test(r.raw));
  r = await get({ og: 'nadie' }, { host: 'evil.example.com' });
  t.check('og de un perfil que no existe -> 404 con HTML genérico', r.code === 404 && /Meteorito/.test(r.raw));

  // Ficha /p/<slug>: vendedor del pedido + cómo salieron sus ventas; sin datos privados ni montos.
  r = await get({ seller_of: 'zzzzz3' });
  const so = r.body?.seller;
  t.check('ficha: vendedor del pedido con estrellas y cómo salieron sus ventas', r.code === 200 && so?.store_slug === 'valeria' && so?.verified === true && so?.sales?.completed === 3 && so?.rating_count === 2, JSON.stringify(r.body));
  t.check('ficha: sin datos privados ni montos', !/s-vale|correo|guest:|"sub"|contact_phone|listed|99000|77000|price/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  r = await get({ seller_of: 'nooooo' });
  t.check('ficha: pedido sin vendedor -> seller null (200)', r.code === 200 && r.body?.seller === null, JSON.stringify(r.body));
  r = await get({ seller_of: '../x' });
  t.check('ficha: slug inválido -> 400', r.code === 400);

  const vj = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const iOg = vj.rewrites.findIndex((x: any) => x.source === '/t/:store' && /og=:store/.test(x.destination));
  const iSpa = vj.rewrites.findIndex((x: any) => x.source === '/t/:store' && !/og=/.test(x.destination));
  const ua = vj.rewrites[iOg]?.has?.find((h: any) => h.type === 'header' && h.key === 'user-agent')?.value ?? '';
  t.check('vercel.json: /t/:store de bots (WhatsApp, Facebook, X…) -> /api/store?og, antes que la SPA', iOg >= 0 && iOg < iSpa && /facebookexternalhit/.test(ua) && /WhatsApp/i.test(ua) && /Twitterbot/.test(ua), `${iOg} ${iSpa}`);

  const page = readFileSync(new URL('../../app/t/[store].tsx', import.meta.url), 'utf8');
  for (const e of ['seller_profile_viewed', 'seller_whatsapp_clicked', 'seller_profile_shared']) t.check(`evento ${e}`, page.includes(`'${e}'`));
  t.check('perfil: nota sutil "Identidad sin confirmar" y recordatorio del escrow (lib/copy.ts)', /COPY\.identity\.unconfirmed/.test(page) && COPY.identity.unconfirmed === 'Identidad sin confirmar' && /custodia/.test(COPY.profile.escrowNote));
  t.check('OG usa el mismo texto que la app', OG_IDENTITY === COPY.identity.ogSuffix);
  t.check('perfil y ficha muestran cómo salieron las ventas', /SalesOutcomeLine/.test(page) && /SalesOutcomeLine/.test(readFileSync(new URL('../../app/p/[slug].tsx', import.meta.url), 'utf8')));
}
