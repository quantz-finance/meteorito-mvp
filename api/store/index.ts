// Tienda del vendedor + calificaciones (una sola función para no sumar funciones en Vercel).
//  GET  ?store=<usuario>                         -> tienda pública: nombre, puntuación, productos disponibles (sin datos sensibles)
//  GET  ?feed=1[&q=texto][&verified=true|false|all][&cursor=<iso>][&limit=N]
//                                                 -> feed de Comprar (y buscador): productos activos de vendedores, lo más
//                                                 nuevo primero, paginado por cursor. Sin datos privados. Caché corta.
//  GET  ?profile=<usuario>                        -> perfil público del vendedor (/t/<usuario>): tienda + verificado, ventas,
//                                                 miembro desde, reseñas y WhatsApp (wa.me) SOLO si el vendedor lo puso.
//  GET  ?seller_of=<pedido>                       -> vendedor de un pedido/link para la ficha /p/<slug>: nombre, foto,
//                                                 identidad confirmada, estrellas y cómo salieron sus ventas (sin montos)
//  GET  ?og=<usuario>                             -> HTML de /t/<usuario> con meta OG (vercel.json lo usa para los bots que
//                                                 arman la vista previa al compartir: WhatsApp, Facebook, X, iMessage…)
//  POST { action:'me' }                          (Bearer Cavos) -> mi tienda (la crea con un usuario único si no existe)
//  POST { action:'update', store_slug?, display_name?, avatar_url?, contact_phone?, whatsapp_public? } (Bearer Cavos) -> cambiar usuario, nombre,
//                                                 foto o WhatsApp de contacto (foto: solo una subida a SU carpeta por
//                                                 /api/photos/upload-url; null la quita. Teléfono: CR, se guarda +506XXXXXXXX;
//                                                 '' o null lo quita. Migración 016. whatsapp_public: mostrarlo en el
//                                                 perfil público, opt-in, requiere número; migración 020)
//  POST { action:'seller_contact', slug }        (X-Guest-Key o Bearer del comprador) -> WhatsApp del vendedor, SOLO al comprador
//                                                 del pedido y SOLO pagado (fondeado…resuelto). Sin 016 o sin teléfono: null
//  POST { action:'rate', slug, stars, comment?, buyer_name? } (X-Guest-Key o Bearer del comprador) -> reseña de compra
//                                                 verificada: 1-5 estrellas, comentario opcional (280, sin links) y nombre
//                                                 corto ("María R."), una por pedido, solo con el pedido Liberado (018)
//  POST { action:'buyer_orders' }               (X-Guest-Key y/o Bearer Cavos) -> Mis compras: SOLO los pedidos de los que
//                                                 esta llave o esta cuenta es el comprador (sin datos del vendedor ni PIN)
//  POST { action:'payout_get' } / { action:'payout_set', iban, holder_name, sinpe_phone? } (Bearer Cavos)
//                                                 -> cuenta IBAN para cobrar (migración 011). Solo sale enmascarada.
//  GET  ?push=key                                 -> llave pública VAPID (o null si no hay push configurado)
//  POST { action:'push_subscribe'|'push_unsubscribe', subscription } (Bearer Cavos y/o X-Guest-Key)
//                                                 -> avisos push de los pedidos de esa identidad (migración 011)
//  POST { action:'import_facebook', url }         (Bearer Cavos o X-Guest-Key del comprador que invita) -> lee un anuncio PÚBLICO de Facebook Marketplace (solo
//                                                 facebook.com / fb.me) para precargar Vender: título, precio en colones,
//                                                 descripción y foto (data URL + photo_urls: la misma foto guardada por el
//                                                 servidor en import-<clave>-<uuid>, la única que no viene de la cámara). Nunca crea nada: quien importa revisa y
//                                                 confirma (link de pago en Vender o invitación en Comprar).
//  POST { action:'import_listing', url }          (igual) -> lo mismo para cualquier anuncio público: Facebook, Mercado Libre,
//                                                 Encuentra24, Amazon, AliExpress, Walmart o cualquier página https con
//                                                 JSON-LD/Open Graph (api/_lib/importers, SSRF estricto). + provider y source_url.
import { db, fail, json, orderBySlug } from '../_lib/db';
import { HttpError, requireCavosUser } from '../_lib/auth';
import { isBuyerOf, requireBuyerIdentity } from '../_lib/guest';
import { crIbanError, cleanHolder, normalizeIban, normalizeSinpe, payoutView } from '../_lib/payout';
import { deleteSubscription, isMissingTable, parseSubscription, saveSubscription, vapid } from '../_lib/push';
import { LISTING_STATUSES, missingColumn } from '../_lib/listings';
import { checkFacebookUrl } from '../_lib/fbparse';
import { clientIp, FB_GUEST_IP_PER_MIN, importFacebookListing, fbRateLimited } from '../_lib/fbimport';
import { storeImportedPhotos } from '../_lib/capture';
import { MAX_PHOTO_BYTES } from '../_lib/photos';
import { importListing } from '../_lib/importers';
import { checkListingUrl } from '../_lib/importers/providers';
import { env } from '../_lib/env';
import { canShowContact, normalizeContactPhone } from '../_lib/contact';
import { buyerOrders } from '../_lib/purchases';
import { feedPage, injectMeta, profileMeta, sellerOfOrder, sellerProfile } from '../_lib/feed';
import { avatarUrlOf, baseSlugFromEmail, cleanName, cleanReviewComment, REVIEW_MAX, REVIEW_PAIR_MAX, REVIEW_PAIR_WINDOW_DAYS, shortBuyerName, nameFromEmail, normalizeStoreSlug, RATABLE, storeDbErr, validStoreSlug, withSuffix } from '../_lib/store';

const PUBLIC_COLS = 'store_slug, display_name, rating_avg, rating_count';

async function publicStore(slug: string) {
  // avatar_url: migración 014. Sin ella, la tienda sigue igual (sin foto).
  let { data: store, error } = await db().from('public_stores').select(`${PUBLIC_COLS}, avatar_url`).eq('store_slug', slug).maybeSingle();
  if (error && missingColumn(error)) ({ data: store, error } = await db().from('public_stores').select(PUBLIC_COLS).eq('store_slug', slug).maybeSingle());
  if (error) storeDbErr(error);
  if (!store) return null;
  const { data: items, error: e2 } = await db().from('public_store_items').select('slug, title, price_crc, photo, created_at')
    .eq('store_slug', slug).order('created_at', { ascending: false }).limit(60);
  if (e2) storeDbErr(e2);
  return {
    store_slug: store.store_slug, display_name: store.display_name, avatar_url: (store as any).avatar_url ?? null,
    rating_avg: store.rating_avg == null ? null : Number(store.rating_avg), rating_count: Number(store.rating_count ?? 0),
    items: (items ?? []).map((i: any) => ({ slug: i.slug, title: i.title || 'Artículo', price_crc: Number(i.price_crc), photo: i.photo ?? null })),
  };
}

async function myProfile(sub: string, email?: string) {
  const { data, error } = await db().from('seller_profiles').select('sub, store_slug, display_name').eq('sub', sub).maybeSingle();
  if (error) storeDbErr(error);
  if (data) return data as { sub: string; store_slug: string; display_name: string };
  const base = baseSlugFromEmail(email);
  for (let i = 0; i < 6; i++) {
    const store_slug = i === 0 ? base : withSuffix(base);
    const row = { sub, store_slug, display_name: nameFromEmail(email) };
    const { error: e2 } = await db().from('seller_profiles').insert(row);
    if (!e2) return row;
    if (e2.code !== '23505') storeDbErr(e2);
    const { data: again } = await db().from('seller_profiles').select('sub, store_slug, display_name').eq('sub', sub).maybeSingle();
    if (again) return again; // carrera: otra pestaña la creó
  }
  throw new HttpError(500, 'No pudimos crear tu tienda. Intenta de nuevo.');
}

/** ¿El vendedor eligió mostrar su WhatsApp en el perfil público? (migración 020). Sin la columna o ante error: false. */
async function whatsappPublicOf(sub: string): Promise<boolean> {
  try {
    const { data, error } = await db().from('seller_profiles').select('whatsapp_public').eq('sub', sub).maybeSingle();
    return !error && (data as any)?.whatsapp_public === true;
  } catch { return false; }
}
/** WhatsApp de contacto del vendedor (migración 016). Sin la columna o ante cualquier error: null (nunca rompe). */
async function contactPhoneOf(sub: string | null | undefined): Promise<string | null> {
  if (!sub) return null;
  try {
    const { data, error } = await db().from('seller_profiles').select('contact_phone').eq('sub', sub).maybeSingle();
    if (error) return null;
    return typeof (data as any)?.contact_phone === 'string' ? (data as any).contact_phone : null;
  } catch { return null; }
}

/** Mi tienda (dueño): productos activos y en pausa (012). Sin la migración: lo mismo que la tienda pública. */
async function ownerStore(sub: string, p: { store_slug: string; display_name: string }) {
  const pub = (await publicStore(p.store_slug)) ?? { store_slug: p.store_slug, display_name: p.display_name, rating_avg: null, rating_count: 0, items: [] as any[] };
  const { data, error } = await db().from('orders').select('slug, brand, model, price_crc, photos, listing_status, created_at')
    .eq('seller_user_id', sub).eq('kind', 'listing').eq('status', 'creado').in('listing_status', ['activa', 'pausada'])
    .order('created_at', { ascending: false }).limit(60);
  if (error) { if (missingColumn(error)) return pub; throw error; }
  const listings = (data ?? []).map((o: any) => ({ slug: o.slug, title: `${o.brand ?? ''} ${o.model ?? ''}`.trim() || 'Artículo', price_crc: Number(o.price_crc), photo: o.photos?.[0] ?? null, listing_status: o.listing_status }));
  const seen = new Set(listings.map((i: { slug: string }) => i.slug));
  return { ...pub, items: [...listings, ...pub.items.filter((i: any) => !seen.has(i.slug))] };
}

/** Anti-fraude de reseñas: nada de auto-reseñas y, entre el mismo comprador (cuenta o dirección Stellar) y el mismo
 *  vendedor, una reseña cada REVIEW_PAIR_WINDOW_DAYS días y REVIEW_PAIR_MAX en total. */
async function reviewPairGuard(order: any) {
  const seller = order.seller_user_id as string;
  if (order.buyer_user_id === seller || (order.buyer_address && order.buyer_address === order.seller_address))
    throw Object.assign(new HttpError(403, 'No puedes dejarte una reseña a ti mismo.'), { code: 'self_review' });
  // Pedidos de este vendedor con el mismo comprador (misma cuenta o misma dirección Stellar).
  const ids = new Set<string>();
  const add = (rows: any[] | null) => (rows ?? []).forEach((r: any) => r?.id && r.id !== order.id && ids.add(r.id));
  const { data: byUser } = await db().from('orders').select('id').eq('seller_user_id', seller).eq('buyer_user_id', order.buyer_user_id).limit(500);
  add(byUser as any[]);
  if (order.buyer_address) { const { data: byAddr } = await db().from('orders').select('id').eq('seller_user_id', seller).eq('buyer_address', order.buyer_address).limit(500); add(byAddr as any[]); }
  if (!ids.size) return;
  const { data: prev, error } = await db().from('seller_ratings').select('order_id, created_at').eq('seller_user_id', seller).in('order_id', [...ids]);
  if (error) storeDbErr(error);
  const since = Date.now() - REVIEW_PAIR_WINDOW_DAYS * 86400e3;
  if ((prev ?? []).length >= REVIEW_PAIR_MAX || (prev ?? []).some((r: any) => !r.created_at || Date.parse(r.created_at) >= since)) // sin fecha: se toma como reciente
    throw Object.assign(new HttpError(429, `Ya dejaste una reseña a este vendedor hace poco. Puedes dejar otra después de ${REVIEW_PAIR_WINDOW_DAYS} días.`), { code: 'review_limit' });
}

/** Vista previa al compartir /t/<usuario>: el HTML de la app (mismo deploy) con los meta OG del vendedor. */
async function ogPage(req: any, res: any) {
  const slug = normalizeStoreSlug(req.query.og);
  const p = validStoreSlug(slug) ? await sellerProfile(slug).catch(() => null) : null;
  const url = `https://pago.meteorito.app/t/${slug}`;
  let appHtml: string | null = null;
  const host = String(req.headers?.host ?? '');
  if (/^[a-z0-9.-]+\.(meteorito\.app|vercel\.app)$/i.test(host)) { // nunca un host arbitrario (SSRF)
    try {
      const r = await fetch(`https://${host}/t/%5Bstore%5D.html`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) appHtml = await r.text();
    } catch { /* página mínima */ }
  }
  const meta = p ? profileMeta(p) : '<title>Meteorito</title><meta property="og:title" content="Meteorito" />';
  res.status(p ? 200 : 404).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.send(injectMeta(appHtml, meta, url));
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET' && req.query?.push === 'key') {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
      return json(res, 200, { key: vapid()?.publicKey ?? null });
    }
    if (req.method === 'GET' && req.query?.feed != null) {
      const page = await feedPage({ q: req.query.q, cursor: req.query.cursor, limit: req.query.limit, verified: req.query.verified });
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60');
      return json(res, 200, page);
    }
    if (req.method === 'GET' && req.query?.profile != null) {
      const slug = normalizeStoreSlug(req.query.profile);
      const p = validStoreSlug(slug) ? await sellerProfile(slug) : null;
      if (!p) throw new HttpError(404, 'Este perfil no existe.');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
      return json(res, 200, p);
    }
    if (req.method === 'GET' && req.query?.og != null) return ogPage(req, res);
    if (req.method === 'GET' && req.query?.seller_of != null) {
      const slug = String(req.query.seller_of);
      if (!/^[a-z0-9]{6}$/.test(slug)) throw new HttpError(400, 'slug inválido');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      return json(res, 200, { seller: await sellerOfOrder(slug) });
    }
    if (req.method === 'GET') {
      const slug = normalizeStoreSlug(req.query?.store);
      if (!validStoreSlug(slug)) throw new HttpError(404, 'Esta tienda no existe.');
      const store = await publicStore(slug);
      if (!store) throw new HttpError(404, 'Esta tienda no existe.');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
      return json(res, 200, store);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const b = req.body ?? {};

    if (b.action === 'rate') {
      // Reseña de compra verificada: estrellas + comentario opcional + nombre corto opcional (migración 018).
      const stars = Number(b.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'Elige de 1 a 5 estrellas.');
      const comment = cleanReviewComment(b.comment);
      if (comment === 'too_long') throw Object.assign(new HttpError(400, `El comentario puede tener hasta ${REVIEW_MAX} caracteres.`), { code: 'bad_comment' });
      if (comment === 'link') throw Object.assign(new HttpError(400, 'Quita los links del comentario.'), { code: 'bad_comment' });
      const buyer_name = shortBuyerName(b.buyer_name);
      const order = await orderBySlug(b.slug);
      const who = await requireBuyerIdentity(req);
      if (!isBuyerOf(order, who)) throw new HttpError(403, 'Solo quien compró puede calificar este pedido.');
      if (!RATABLE.includes(order.status)) throw Object.assign(new HttpError(409, 'Podrás dejar tu reseña cuando se libere el pago.'), { code: 'not_ratable' });
      if (!order.seller_user_id) throw new HttpError(409, 'Este pedido no se puede calificar.');
      await reviewPairGuard(order);
      const base = { order_id: order.id, order_slug: order.slug, seller_user_id: order.seller_user_id, buyer_user_id: order.buyer_user_id, stars };
      let { error } = await db().from('seller_ratings').insert({ ...base, comment, buyer_name });
      if (error && missingColumn(error)) ({ error } = await db().from('seller_ratings').insert(base)); // sin 018: solo estrellas
      if (error?.code === '23505') throw Object.assign(new HttpError(409, 'Ya calificaste este pedido.'), { code: 'already_rated' });
      if (error) storeDbErr(error);
      const { data: sp } = await db().from('seller_profiles').select('store_slug').eq('sub', order.seller_user_id).maybeSingle();
      return json(res, 200, { rated: true, stars, store_slug: (sp as any)?.store_slug ?? null });
    }

    if (b.action === 'push_subscribe' || b.action === 'push_unsubscribe') {
      const sub = parseSubscription(b.subscription);
      if (!sub) throw new HttpError(400, 'Suscripción inválida.');
      const who = await requireBuyerIdentity(req); // sesión Cavos (vendedor o comprador) y/o llave de invitado
      try {
        if (b.action === 'push_subscribe') await saveSubscription(who.ids, sub, String(req.headers?.['user-agent'] ?? ''));
        else await deleteSubscription(who.ids, sub.endpoint);
      } catch (e: any) {
        if (isMissingTable(e)) throw Object.assign(new HttpError(503, 'Las notificaciones todavía no están disponibles.'), { code: 'push_unavailable' });
        throw e;
      }
      return json(res, 200, { ok: true });
    }

    if (b.action === 'seller_contact') {
      // Contacto del vendedor para coordinar el envío o reclamar después: solo quien pagó este pedido, nunca antes del pago.
      const order = await orderBySlug(b.slug);
      const who = await requireBuyerIdentity(req);
      if (!isBuyerOf(order, who)) throw Object.assign(new HttpError(403, 'Solo quien compró puede ver el contacto del vendedor.'), { code: 'not_buyer' });
      if (!canShowContact(order.status)) throw Object.assign(new HttpError(409, 'Verás el contacto del vendedor cuando pagues.'), { code: 'not_paid' });
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { contact_phone: await contactPhoneOf(order.seller_user_id) });
    }

    if (b.action === 'import_facebook' || b.action === 'import_listing') {
      // Vendedor (Bearer Cavos) o comprador sin cuenta que invita al vendedor desde el anuncio (X-Guest-Key).
      // import_listing: cualquier anuncio público (Facebook, Mercado Libre, Encuentra24, Amazon…), con protección SSRF.
      const who = await requireBuyerIdentity(req);
      const any = b.action === 'import_listing';
      const chk = any ? checkListingUrl(b.url) : checkFacebookUrl(b.url);
      if (!chk.ok) throw Object.assign(new HttpError(400, chk.error), { code: any ? 'import_url_invalid' : 'fb_url_invalid' });
      // Límite por identidad (8/min) y, para invitados, también por IP: la llave de invitado es gratis de generar.
      const ip = who.cavos ? null : clientIp(req);
      if (fbRateLimited(who.cavos?.sub ?? who.guest!) || (ip && fbRateLimited(`ip:${ip}`, Date.now(), FB_GUEST_IP_PER_MIN))) {
        throw Object.assign(new HttpError(429, 'Espera un momento antes de importar otro anuncio.'), { code: 'fb_rate_limited' });
      }
      res.setHeader?.('Cache-Control', 'no-store');
      const r = any ? await importListing(chk.url, { rate: env.crcUsdcRate() }) : await importFacebookListing(chk.url, { rate: env.crcUsdcRate() });
      // Las fotos del anuncio quedan guardadas por el servidor (import-<clave del link>-<uuid>): son las únicas que no se
      // toman con la cámara, y solo valen en un producto o invitación que mande este mismo source_url (el canónico del import).
      const source_url = ('source_url' in r && typeof r.source_url === 'string' && r.source_url) || chk.url;
      const photo_urls = r.photos.length ? await storeImportedPhotos(db().storage, r.photos, who.cavos?.sub ?? who.guest!, MAX_PHOTO_BYTES, source_url) : [];
      return json(res, 200, { ...r, photo_urls, source_url });
    }

    if (b.action === 'buyer_orders') {
      // Mis compras: la llave de invitado de este dispositivo y/o la sesión Cavos. Nunca por slug ni por dirección.
      const who = await requireBuyerIdentity(req);
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { orders: await buyerOrders(db(), who.ids) });
    }

    const user = await requireCavosUser(req);
    if (b.action === 'payout_get' || b.action === 'payout_set') {
      const missing = (e: any) => { if (isMissingTable(e)) throw Object.assign(new HttpError(503, 'Todavía no puedes registrar tu cuenta. Intenta más tarde.'), { code: 'payout_unavailable' }); throw e; };
      if (b.action === 'payout_get') {
        const { data, error } = await db().from('seller_payout').select('iban, holder_name, sinpe_phone, updated_at').eq('sub', user.sub).maybeSingle();
        if (error) missing(error);
        return json(res, 200, { payout: data ? payoutView(data) : null });
      }
      const err = crIbanError(b.iban);
      if (err) throw Object.assign(new HttpError(400, err), { code: 'bad_iban' });
      const holder_name = cleanHolder(b.holder_name);
      if (holder_name.length < 3) throw Object.assign(new HttpError(400, 'Escribe el nombre del titular como aparece en el banco.'), { code: 'bad_holder' });
      const sinpe = normalizeSinpe(b.sinpe_phone);
      if (sinpe === 'invalid') throw Object.assign(new HttpError(400, 'El SINPE Móvil son 8 dígitos (ej. 8888 1234).'), { code: 'bad_sinpe' });
      const row = { sub: user.sub, iban: normalizeIban(b.iban), holder_name, sinpe_phone: sinpe, updated_at: new Date().toISOString() };
      const { error } = await db().from('seller_payout').upsert(row, { onConflict: 'sub' });
      if (error) missing(error);
      return json(res, 200, { payout: payoutView(row) });
    }
    if (b.action === 'orders') {
      // Pedidos del vendedor CON sesión (antes: RPC pública seller_orders con cualquier dirección -> fuga de datos).
      const cols = 'slug, category, brand, model, price_crc, status, identifier, created_at, kind, listing_slug, listing_status';
      // delivery_mode (migración 017) para la línea de tiempo cara a cara; released_at/resolved_at/resolution (005-006) para el
      // historial de ventas (resultado y lo cobrado). Sin la 017 se pide sin delivery_mode; sin esas columnas, solo lo básico.
      const hist = 'released_at, resolved_at, resolution';
      let q = await db().from('orders').select(`${cols}, ${hist}, delivery_mode`).eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error && missingColumn(q.error)) q = await db().from('orders').select(`${cols}, ${hist}`).eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error && missingColumn(q.error)) q = await db().from('orders').select(cols).eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error && missingColumn(q.error)) q = await db().from('orders').select('slug, category, brand, model, price_crc, status, identifier, created_at').eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error) throw q.error;
      const orders = (q.data ?? []).map(({ identifier, ...o }: any) => ({ ...o, price_crc: Number(o.price_crc), identifier_masked: identifier ? '••••' + String(identifier).slice(-4) : null }))
        .filter((o: any) => !(o.listing_slug && o.status === 'creado'));
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { orders });
    }
    if (b.action === 'me') {
      const p = await myProfile(user.sub, user.email);
      const [mine, contact_phone, whatsapp_public] = await Promise.all([ownerStore(user.sub, p), contactPhoneOf(user.sub), whatsappPublicOf(user.sub)]);
      return json(res, 200, { ...mine, contact_phone, whatsapp_public: !!contact_phone && whatsapp_public });
    }
    if (b.action === 'listing_set') {
      if (!LISTING_STATUSES.includes(b.status)) throw new HttpError(400, 'Estado inválido.');
      if (typeof b.slug !== 'string' || !/^[a-z0-9]{6}$/.test(b.slug)) throw new HttpError(400, 'slug inválido');
      const { data, error } = await db().from('orders').update({ listing_status: b.status }).eq('slug', b.slug).eq('seller_user_id', user.sub).eq('kind', 'listing').select('slug');
      if (error && missingColumn(error)) throw Object.assign(new HttpError(503, 'Todavía no puedes pausar productos. Intenta más tarde.'), { code: 'listings_unavailable' });
      if (error) throw error;
      if (!data?.length) throw Object.assign(new HttpError(404, 'Este link es de un solo uso: no se puede pausar.'), { code: 'not_listing' });
      const p = await myProfile(user.sub, user.email);
      return json(res, 200, await ownerStore(user.sub, p));
    }
    if (b.action === 'update') {
      const cur = await myProfile(user.sub, user.email);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.store_slug != null) {
        const s = normalizeStoreSlug(b.store_slug);
        if (!validStoreSlug(s)) throw Object.assign(new HttpError(400, 'Usa de 3 a 30 letras o números (sin espacios).'), { code: 'bad_store_slug' });
        patch.store_slug = s;
      }
      if (b.display_name != null) patch.display_name = cleanName(b.display_name);
      if (b.avatar_url !== undefined) {
        const url = b.avatar_url === null ? null : avatarUrlOf(b.avatar_url, user.sub);
        if (b.avatar_url !== null && !url) throw Object.assign(new HttpError(400, 'No pudimos usar esa foto. Elige otra imagen e intenta de nuevo.'), { code: 'bad_avatar' });
        patch.avatar_url = url;
      }
      if (b.contact_phone !== undefined) {
        const phone = normalizeContactPhone(b.contact_phone);
        if (phone === 'invalid') throw Object.assign(new HttpError(400, 'Escribe un número de Costa Rica: 8 dígitos (ej. 8888 1234).'), { code: 'bad_phone' });
        patch.contact_phone = phone;
      }
      // WhatsApp en el perfil público: opt-in explícito del dueño, solo con número guardado. Quitar el número lo apaga.
      let implicitWa = false;
      if (b.whatsapp_public !== undefined) {
        if (typeof b.whatsapp_public !== 'boolean') throw Object.assign(new HttpError(400, 'Valor inválido.'), { code: 'bad_flag' });
        if (b.whatsapp_public && !('contact_phone' in patch ? patch.contact_phone : await contactPhoneOf(user.sub)))
          throw Object.assign(new HttpError(400, 'Primero guarda tu WhatsApp.'), { code: 'no_phone' });
        patch.whatsapp_public = b.whatsapp_public;
      } else if ('contact_phone' in patch && patch.contact_phone === null) { patch.whatsapp_public = false; implicitWa = true; }
      let { error } = await db().from('seller_profiles').update(patch).eq('sub', user.sub); // solo el perfil del dueño
      if (error && 'whatsapp_public' in patch && missingColumn(error) && /whatsapp_public/.test(String(error.message ?? ''))) {
        if (!implicitWa) throw Object.assign(new HttpError(503, 'Todavía no puedes mostrar tu WhatsApp en el perfil. Intenta más tarde.'), { code: 'whatsapp_public_unavailable' });
        delete patch.whatsapp_public; // sin 020 no hay nada que apagar
        ({ error } = await db().from('seller_profiles').update(patch).eq('sub', user.sub));
      }
      if (error?.code === '23505') throw Object.assign(new HttpError(409, 'Ese nombre de usuario ya está en uso. Prueba otro.'), { code: 'store_slug_taken' });
      if (error && 'contact_phone' in patch && missingColumn(error) && (!('avatar_url' in patch) || /contact_phone/.test(String(error.message ?? ''))))
        throw Object.assign(new HttpError(503, 'Todavía no puedes guardar tu WhatsApp. Intenta más tarde.'), { code: 'phone_unavailable' });
      if (error && 'avatar_url' in patch && missingColumn(error)) throw Object.assign(new HttpError(503, 'Todavía no puedes poner foto a tu tienda. Intenta más tarde.'), { code: 'avatar_unavailable' });
      if (error) storeDbErr(error);
      const slug = (patch.store_slug as string) ?? cur.store_slug;
      const fresh = (await publicStore(slug)) ?? { store_slug: slug, display_name: (patch.display_name as string) ?? cur.display_name, avatar_url: null, rating_avg: null, rating_count: 0, items: [] };
      const contact_phone = 'contact_phone' in patch ? patch.contact_phone as string | null : await contactPhoneOf(user.sub);
      const whatsapp_public = 'whatsapp_public' in patch ? patch.whatsapp_public === true : await whatsappPublicOf(user.sub);
      return json(res, 200, { ...('avatar_url' in patch ? { ...fresh, avatar_url: patch.avatar_url } : fresh), contact_phone, whatsapp_public: !!contact_phone && whatsapp_public });
    }
    throw new HttpError(400, 'acción inválida');
  } catch (e) { return fail(res, e); }
}
