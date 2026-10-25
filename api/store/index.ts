// Tienda del vendedor + calificaciones (una sola función para no sumar funciones en Vercel).
//  GET  ?store=<usuario>                         -> tienda pública: nombre, puntuación, productos disponibles (sin datos sensibles)
//  GET  ?feed=1[&q=texto][&verified=true|false|all][&cursor=<iso>][&limit=N]
//                                                 -> feed de Comprar (y buscador): productos activos de vendedores, lo más
//                                                 nuevo primero, paginado por cursor. Sin datos privados. Caché corta.
//       [&order=rank]                            -> con el algoritmo (api/_lib/feedRank.ts), sin personalizar (caché pública)
//                                                 + productos de EJEMPLO (demo: true) DESPUÉS de los reales, cursor e…_…
//                                                 (api/_lib/demoProducts.ts; FEED_DEMO_PRODUCTS en api/_lib/demoFlag.ts)
//                                                 + sponsored: bloque Patrocinado (024), solo en la 1.ª página, [] si no hay
//  POST { action:'feed', q?, verified?, cursor?, limit? } (X-Guest-Key y/o Bearer) -> el mismo feed con el algoritmo y el
//                                                 impulso de los vendedores que SIGUE quien pide (022). Sin caché.
//       [view:'following']                       -> "Siguiendo": SOLO publicaciones de las tiendas que sigue quien pide (misma
//                                                 identidad que seguir: cuenta y/o llave del dispositivo), con filtro y búsqueda;
//                                                 sin productos de ejemplo (ej-) ni Patrocinado. No sigue a nadie -> items [].
//  GET  ?profile=<usuario>                        -> perfil público del vendedor (/t/<usuario>): tienda + verificado, ventas, followers (SOLO el número; nunca quiénes, ni al dueño: t86),
//                                                 miembro desde, reseñas y WhatsApp (wa.me) SOLO si el vendedor lo puso.
//  GET  ?seller_of=<pedido>                       -> vendedor de un pedido/link para la ficha /p/<slug>: nombre, foto,
//                                                 identidad confirmada, estrellas y cómo salieron sus ventas (sin montos)
//  GET  ?og=<usuario>                             -> HTML de /t/<usuario> con meta OG (vercel.json lo usa para los bots que
//                                                 arman la vista previa al compartir: WhatsApp, Facebook, X, iMessage…)
//  POST { action:'me' }                          (Bearer Cavos) -> mi tienda (la crea con un usuario único si no existe)
//  GET  ?activity=<usuario>[,<usuario>…]        -> última conexión en rango grueso SOLO de quienes consintieron (021+023).
//                                                 Sin caché: apagarla se nota de inmediato. Nunca la hora exacta.
//  POST { action:'seen' }                        (Bearer Cavos) -> marca actividad (última conexión); solo con consentimiento; máx. 1 escritura / 5 min
//  POST { action:'update', store_slug?, display_name?, avatar_url?, contact_phone?, whatsapp_public?, show_last_seen?, socials? } (Bearer Cavos) -> cambiar usuario, nombre,
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
//  POST { action:'payout_get' } / { action:'payout_set' } (Bearer Cavos) -> Cuenta IBAN para cobrar (011). BETA: lo enviado en
//                                                 iban/holder_name/sinpe_phone se descarta y se guarda el dato de ejemplo.
//  POST { action:'payout_set', method:'wallet', stellar_address } / { action:'payout_check', stellar_address }
//                                                 -> cobrar en USDC a su wallet Stellar (029): valida G…, cuenta y trustline USDC.
//                                                 payout_get devuelve choice:true|false (¿existe 029?). docs/cobro-wallet-iban.md
//  GET  ?push=key                                 -> llave pública VAPID (o null si no hay push configurado)
//  POST { action:'push_subscribe'|'push_unsubscribe', subscription } (Bearer Cavos y/o X-Guest-Key)
//                                                 -> avisos push de los pedidos de esa identidad (migración 011)
//  POST { action:'follow'|'unfollow', store_slug }   (X-Guest-Key y/o Bearer Cavos) -> seguir o dejar de seguir a un vendedor
//                                                 (migración 022). Privado: devuelve { following, followers } (solo el número).
//                                                 Anti-spam: FOLLOW_PER_MIN por identidad (+ por IP sin cuenta), tope 500.
//  POST { action:'following' }                    (X-Guest-Key y/o Bearer Cavos) -> { store_slugs }: a quién sigo YO. Sin 022: [].
//  GET  ?chat=status                             -> { available }: ¿está el chat (migración 025)? Caché pública corta. Sin ella la app
//                                                 oculta los botones de mensaje. Ver api/_lib/chat.ts y docs/chat.md.
//  POST { action:'chat_open', store_slug, item_slug? } | { action:'chat_open', order_slug } (X-Guest-Key y/o Bearer)
//                                                 -> { token, role }: conversación con el vendedor (antes de comprar) o del pedido
//  POST { action:'chat_get', token, after?, before?, typing?, full? } -> mensajes (solo las dos partes; si no, 404)
//  POST { action:'chat_send', token, body, client_id } -> { message } (1000 caracteres, límite por minuto, push a la otra parte)
//  POST { action:'chat_list', as:'buyer'|'seller', summary? } -> bandeja { unread, conversations } (vendedor: Bearer Cavos)
//  POST { action:'chat_block', token, blocked } (vendedor) / { action:'chat_report', token, reason, detail? } (cualquiera)
//  POST { action:'import_facebook', url }         (Bearer Cavos o X-Guest-Key del comprador que invita) -> lee un anuncio PÚBLICO de Facebook Marketplace (solo
//                                                 facebook.com / fb.me) para precargar Vender: título, precio en colones,
//                                                 descripción y foto (data URL + photo_urls: la misma foto guardada por el
//                                                 servidor en import-<clave>-<uuid>, la única que no viene de la cámara). Nunca crea nada: quien importa revisa y
//                                                 confirma (link de pago en Vender o invitación en Comprar).
//  POST { action:'import_listing', url }          (igual) -> lo mismo para cualquier anuncio público: Facebook, Mercado Libre,
//                                                 Encuentra24, Amazon, AliExpress, Walmart o cualquier página https con
//                                                 JSON-LD/Open Graph (api/_lib/importers, SSRF estricto). + provider y source_url.
import { activityBySlug, lastSeenStateOf, LastSeenUnavailable, setLastSeen, touchSeen } from '../_lib/activity';
import { db, fail, json, logEvent, orderBySlug } from '../_lib/db';
import { HttpError, requireCavosUser } from '../_lib/auth';
import { isBuyerOf, requireBuyerIdentity } from '../_lib/guest';
import { adminContacts, getContacts, linkAccount, redeemAccess, reissuePin, removeContact, requireAdmin, saveContact, sendNotice } from '../_lib/buyerContact';
import { normalizeEmail } from '../_lib/contactText';
import { payoutView, placeholderPayoutRow } from '../_lib/payout';
import { checkWallet, isMissing as isPayoutMissing, isStellarAddress, normalizeStellar, payoutChoiceReady, PAYOUT_ERR } from '../_lib/payoutChoice';
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
import { FOLLOW_IP_PER_MIN, followedSellerSubs, followingSlugs, followRateLimited, setFollow } from '../_lib/follows';
import { sponsoredFor } from '../_lib/sponsored';
import { blockChat, chatAvailable, listChats, openChat, readChat, reportChat, sendChat } from '../_lib/chat';
import { parseVerified, searchTokens } from '../_lib/feedText';
import { feedPage, injectMeta, profileMeta, sellerOfOrder, sellerProfile, socialsOf, type FeedQuery } from '../_lib/feed';
import { normalizeSocials, socialError } from '../_lib/socials';
import { decodeDemoCursor, demoPage, demoProductsOn, demoProfile, isDemoStoreSlug, looksLikeDemoProduct, mergeDemo } from '../_lib/demoProducts';
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
    const store_slug = i === 0 && !isDemoStoreSlug(base) ? base : withSuffix(base); // los usuarios de las tiendas de ejemplo quedan reservados
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
  const p = validStoreSlug(slug) ? (demoProductsOn() && demoProfile(slug)) || await sellerProfile(slug).catch(() => null) : null;
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

/** Feed + productos de EJEMPLO (solo con el algoritmo, que es lo que pide la app): los reales primero; cuando se terminan,
 *  los ejemplos rellenan la página y siguen con el cursor e…_…. Con FEED_DEMO_PRODUCTS apagado: el feed de siempre. */
async function feedWithDemo(p: FeedQuery) {
  if (!demoProductsOn() || p.order !== 'rank') return feedPage(p);
  const dc = decodeDemoCursor(p.cursor);
  let verified;
  try { verified = parseVerified(p.verified); } catch (e: any) { throw Object.assign(new HttpError(400, e.message), { code: 'bad_filter' }); }
  if (dc) return { ...demoPage({ q: p.q, verified, cursor: dc, limit: p.limit }), verified };
  return mergeDemo(await feedPage(p), { q: p.q, verified, limit: p.limit });
}

/** Bloque Patrocinado (024): solo en la primera página del feed con el algoritmo, con el mismo filtro y búsqueda. */
async function withSponsored<P extends { verified: any }>(page: P, q: any): Promise<P & { sponsored?: unknown[] }> {
  if ((q.cursor != null && q.cursor !== '') || (q.order !== 'rank' && q.action !== 'feed')) return page;
  // Ranking honesto: un producto de ejemplo nunca sale como Patrocinado (aunque alguien lo pusiera en la tabla).
  const sponsored = (await sponsoredFor({ verified: parseVerified(q.verified), tokens: searchTokens(q.q) })).filter((x) => !looksLikeDemoProduct(x.slug));
  return { ...page, sponsored };
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET' && req.query?.push === 'key') {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
      return json(res, 200, { key: vapid()?.publicKey ?? null });
    }
    if (req.method === 'GET' && req.query?.feed != null) {
      const page = await withSponsored(await feedWithDemo({ q: req.query.q, cursor: req.query.cursor, limit: req.query.limit, verified: req.query.verified, order: req.query.order }), req.query);
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60');
      return json(res, 200, page);
    }
    if (req.method === 'GET' && req.query?.profile != null) {
      const slug = normalizeStoreSlug(req.query.profile);
      // Tiendas de ejemplo (ficticias, demo: true): sus usuarios están reservados, así que nunca tapan una tienda real.
      const p = validStoreSlug(slug) ? (demoProductsOn() && demoProfile(slug)) || await sellerProfile(slug) : null;
      if (!p) throw new HttpError(404, 'Este perfil no existe.');
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
      return json(res, 200, p);
    }
    if (req.method === 'GET' && req.query?.activity != null) {
      // Última conexión: aparte del feed y del perfil (que se cachean) para que apagarla no deje rastro en ninguna caché.
      const slugs = [...new Set(String(req.query.activity).split(',').map(normalizeStoreSlug).filter(validStoreSlug))].slice(0, 60);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      return json(res, 200, { activity: await activityBySlug(slugs) });
    }
    if (req.method === 'GET' && req.query?.og != null) return ogPage(req, res);
    if (req.method === 'GET' && req.query?.chat === 'status') {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      return json(res, 200, { available: await chatAvailable() });
    }
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

    if (typeof b.action === 'string' && (b.action.startsWith('buyer_contact_') || b.action.startsWith('buyer_access_') || b.action === 'buyer_link_account' || b.action === 'buyer_pin_reissue' || b.action === 'admin_contacts')) {
      // Avisos y recuperación del comprador sin cuenta (api/_lib/buyerContact.ts, migración 028). Teléfono y correo
      // nunca salen hacia el vendedor: aquí solo responde el comprador (enmascarado) o el equipo (ADMIN_EMAILS).
      res.setHeader?.('Cache-Control', 'no-store');
      if (b.action === 'buyer_link_account') {
        const who = await requireBuyerIdentity(req);
        const r = await linkAccount(db(), who);
        if (r.linked && typeof b.slug === 'string' && b.consent === true) { // y avisos a la cuenta para esta compra
          const order = await orderBySlug(b.slug);
          if (isBuyerOf(order, who)) {
            try { await saveContact(db(), order, who, { channel: 'account', consent: true, consent_version: b.consent_version }); }
            catch (e: any) { if (e?.code !== 'contact_unavailable' && e?.code !== 'contact_closed') throw e; }
          }
        }
        return json(res, 200, r);
      }
      const order = await orderBySlug(b.slug);
      if (b.action === 'buyer_access_redeem') return json(res, 200, redeemAccess(order, b.token)); // el token ES la prueba
      if (b.action === 'buyer_access_request') {
        // Otro dispositivo: si el correo coincide con el contacto guardado, le mandamos un link nuevo. Respuesta siempre igual.
        const email = normalizeEmail(b.email);
        if (email && !fbRateLimited(`acc:${clientIp(req) ?? 'x'}`, Date.now(), 4)) {
          const { data } = await db().from('buyer_contacts').select('channel, email').eq('order_id', order.id).eq('email', email).is('revoked_at', null);
          const ch = (data ?? [])[0]?.channel;
          if (ch) await sendNotice(db(), order, 'acceso', { only: ch as 'email' | 'account' });
        }
        return json(res, 200, { requested: true });
      }
      const who = await requireBuyerIdentity(req);
      if (b.action === 'admin_contacts') { requireAdmin(who); return json(res, 200, await adminContacts(db(), order)); }
      if (!isBuyerOf(order, who)) throw Object.assign(new HttpError(403, 'Solo quien compró puede hacer esto.'), { code: 'not_buyer' });
      if (b.action === 'buyer_contact_get') return json(res, 200, await getContacts(db(), order));
      if (b.action === 'buyer_contact_save') return json(res, 200, await saveContact(db(), order, who, b));
      if (b.action === 'buyer_contact_remove') return json(res, 200, await removeContact(db(), order, b.channel));
      if (b.action === 'buyer_pin_reissue') {
        const r = await reissuePin(db(), order);
        await logEvent(order.id, 'pin_reissued', { via: who.cavos ? 'account' : 'access_link' });
        return json(res, 200, r);
      }
      throw new HttpError(400, 'acción inválida');
    }

    if (b.action === 'buyer_orders') {
      // Mis compras: la llave de invitado de este dispositivo y/o la sesión Cavos. Nunca por slug ni por dirección.
      const who = await requireBuyerIdentity(req);
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { orders: await buyerOrders(db(), who.ids) });
    }
    if (b.action === 'follow' || b.action === 'unfollow') {
      const slug = normalizeStoreSlug(b.store_slug);
      if (!validStoreSlug(slug)) throw new HttpError(400, 'Usuario inválido.');
      const who = await requireBuyerIdentity(req);
      const ip = who.cavos ? null : clientIp(req);
      if (followRateLimited(`f:${who.ids[0]}`) || (ip && followRateLimited(`fip:${ip}`, Date.now(), FOLLOW_IP_PER_MIN)))
        throw Object.assign(new HttpError(429, 'Espera un momento antes de seguir a más vendedores.'), { code: 'follow_rate_limited' });
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, await setFollow(who, slug, b.action === 'follow'));
    }
    if (b.action === 'feed') {
      // Búsqueda sin llave ni sesión (el texto va en el body, nunca en la URL ni en logs): sin impulso de seguidos.
      // Siguiendo sí pide identidad.
      const anon = b.view !== 'following' && !req.headers?.['x-guest-key'] && !String(req.headers?.authorization ?? '').startsWith('Bearer ');
      const who = anon ? { ids: [] as string[] } : await requireBuyerIdentity(req);
      if (b.view != null && b.view !== 'for_you' && b.view !== 'following') throw Object.assign(new HttpError(400, 'Vista inválida.'), { code: 'bad_view' });
      const followed = who.ids.length ? await followedSellerSubs(who.ids) : [];
      if (b.view === 'following') { // Siguiendo: solo las tiendas que sigue; sin ejemplos ni Patrocinado.
        const page = await feedPage({ q: b.q, cursor: b.cursor, limit: b.limit, verified: b.verified, order: 'rank', followed, onlyFollowed: true });
        res.setHeader?.('Cache-Control', 'private, no-store');
        return json(res, 200, { ...page, items: page.items.filter((i: any) => !looksLikeDemoProduct(i.slug) && !i.seller?.demo), sponsored: [], view: 'following' });
      }
      const page = await withSponsored(await feedWithDemo({ q: b.q, cursor: b.cursor, limit: b.limit, verified: b.verified, order: 'rank', followed }), b);
      res.setHeader?.('Cache-Control', 'private, no-store');
      return json(res, 200, page);
    }
    if (b.action === 'following') {
      const who = await requireBuyerIdentity(req);
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { store_slugs: await followingSlugs(who.ids) });
    }

    if (typeof b.action === 'string' && b.action.startsWith('chat_')) {
      res.setHeader?.('Cache-Control', 'private, no-store');
      if (b.action === 'chat_list') {
        const as = b.as === 'seller' ? 'seller' : 'buyer';
        if (as === 'seller') { const u = await requireCavosUser(req); return json(res, 200, await listChats({ ids: [u.sub] }, 'seller', u.sub, b.summary === true)); }
        const who = await requireBuyerIdentity(req);
        return json(res, 200, await listChats(who, 'buyer', null, b.summary === true));
      }
      const who = await requireBuyerIdentity(req);
      if (b.action === 'chat_open') return json(res, 200, await openChat(who, b, who.cavos ? null : clientIp(req)));
      if (b.action === 'chat_get') return json(res, 200, await readChat(who, b));
      if (b.action === 'chat_send') return json(res, 200, await sendChat(who, b, { ip: who.cavos ? null : clientIp(req) }));
      if (b.action === 'chat_block') return json(res, 200, await blockChat(who, b));
      if (b.action === 'chat_report') return json(res, 200, await reportChat(who, b));
      throw new HttpError(400, 'acción inválida');
    }

    const user = await requireCavosUser(req);
    if (b.action === 'payout_get' || b.action === 'payout_set' || b.action === 'payout_check') {
      const missing = (e: any) => { if (isMissingTable(e)) throw Object.assign(new HttpError(503, 'Todavía no puedes registrar tu cuenta. Intenta más tarde.'), { code: 'payout_unavailable' }); throw e; };
      // Elección wallet / Cuenta IBAN (029). Sin 029: solo la Cuenta IBAN, como antes (choice:false).
      if (b.action === 'payout_check') return json(res, 200, { state: await checkWallet(b.stellar_address) });
      if (b.action === 'payout_get') {
        const { data, error } = await db().from('seller_payout').select('*').eq('sub', user.sub).maybeSingle();
        if (error) missing(error);
        return json(res, 200, { payout: data ? payoutView(data) : null, choice: await payoutChoiceReady(data) });
      }
      const now = new Date().toISOString();
      if (b.method === 'wallet') {
        if (!(await payoutChoiceReady(null))) throw PAYOUT_ERR.unavailable();
        if (!isStellarAddress(b.stellar_address)) throw PAYOUT_ERR.address();
        const addr = normalizeStellar(b.stellar_address);
        if (addr === env.platformPublic()) throw PAYOUT_ERR.platform();
        const state = await checkWallet(addr);
        if (state === 'no_account') throw PAYOUT_ERR.noAccount();
        // Solo las columnas de la wallet: el resto de la fila (si existe) no se lee ni se reescribe.
        const row = { sub: user.sub, payout_method: 'wallet', stellar_address: addr, updated_at: now };
        const { error } = await db().from('seller_payout').upsert(row, { onConflict: 'sub' });
        if (error) { if (isPayoutMissing(error)) throw PAYOUT_ERR.unavailable(); throw error; }
        const { data: saved } = await db().from('seller_payout').select('*').eq('sub', user.sub).maybeSingle();
        return json(res, 200, { payout: payoutView(saved ?? row), state });
      }
      // Beta en testnet: el IBAN, el titular y el SINPE que lleguen se DESCARTAN (nunca se validan, guardan ni registran);
      // se guarda el dato de ejemplo. Así ningún error de la base ni log puede contener una cuenta real.
      const base = placeholderPayoutRow(user.sub, now);
      // Con 029 guardar la Cuenta IBAN también la elige para cobrar ('iban'); la wallet guardada se conserva por si vuelve.
      let row: Record<string, unknown> = { ...base, payout_method: 'iban' };
      let { error } = await db().from('seller_payout').upsert(row, { onConflict: 'sub' });
      if (error && missingColumn(error)) { row = base; ({ error } = await db().from('seller_payout').upsert(row, { onConflict: 'sub' })); }
      if (error) missing(error);
      return json(res, 200, { payout: payoutView(row as any) });
    }
    if (b.action === 'orders') {
      // Pedidos del vendedor CON sesión (antes: RPC pública seller_orders con cualquier dirección -> fuga de datos).
      const cols = 'slug, category, brand, model, price_crc, status, identifier, created_at, kind, listing_slug, listing_status, photos'; // photos: solo la 1.ª va a Home (miniatura)
      // delivery_mode (migración 017) para la línea de tiempo cara a cara; released_at/resolved_at/resolution (005-006) para el
      // historial de ventas (resultado y lo cobrado). Sin la 017 se pide sin delivery_mode; sin esas columnas, solo lo básico.
      const hist = 'released_at, resolved_at, resolution';
      let q = await db().from('orders').select(`${cols}, ${hist}, delivery_mode`).eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error && missingColumn(q.error)) q = await db().from('orders').select(`${cols}, ${hist}`).eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error && missingColumn(q.error)) q = await db().from('orders').select(cols).eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error && missingColumn(q.error)) q = await db().from('orders').select('slug, category, brand, model, price_crc, status, identifier, created_at').eq('seller_user_id', user.sub).order('created_at', { ascending: false }).limit(200);
      if (q.error) throw q.error;
      const orders = (q.data ?? []).map(({ identifier, photos, ...o }: any) => ({ ...o, price_crc: Number(o.price_crc), photo: Array.isArray(photos) ? photos[0] ?? null : null, identifier_masked: identifier ? '••••' + String(identifier).slice(-4) : null }))
        .filter((o: any) => !(o.listing_slug && o.status === 'creado'));
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { orders });
    }
    if (b.action === 'seen') {
      // Última conexión: UPDATE condicional (no escribe si ya hay una de hace menos de 5 min). Nunca devuelve la hora.
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, { updated: await touchSeen(user.sub) });
    }
    if (b.action === 'me') {
      const p = await myProfile(user.sub, user.email);
      const [mine, contact_phone, whatsapp_public, ls, socials] = await Promise.all([ownerStore(user.sub, p), contactPhoneOf(user.sub), whatsappPublicOf(user.sub), lastSeenStateOf(user.sub), socialsOf(user.sub), touchSeen(user.sub)]);
      return json(res, 200, { ...mine, socials, contact_phone, whatsapp_public: !!contact_phone && whatsapp_public, show_last_seen: ls.show, last_seen_decided: ls.decided });
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
        if (isDemoStoreSlug(s)) throw Object.assign(new HttpError(409, 'Ese nombre de usuario ya está en uso. Prueba otro.'), { code: 'store_slug_taken' }); // tienda de ejemplo
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
      // Última conexión pública: solo con consentimiento (apagada por defecto). Cada cambio queda registrado (023).
      let lastSeen: boolean | undefined;
      if (b.show_last_seen !== undefined) {
        if (typeof b.show_last_seen !== 'boolean') throw Object.assign(new HttpError(400, 'Valor inválido.'), { code: 'bad_flag' });
        try { lastSeen = (await setLastSeen(user.sub, b.show_last_seen)).show; }
        catch (e) {
          if (e instanceof LastSeenUnavailable) throw Object.assign(new HttpError(503, 'Todavía no puedes cambiar esto. Intenta más tarde.'), { code: 'last_seen_unavailable' });
          throw e;
        }
      }
      // Redes (031): validadas aquí (https, dominio de cada red, largo) y guardadas aparte para que sin la columna lo demás funcione.
      let socials: Record<string, string> | undefined;
      if (b.socials !== undefined) {
        const r = normalizeSocials(b.socials);
        if ('bad' in r) throw Object.assign(new HttpError(400, socialError(r.bad)), { code: 'bad_social', field: r.bad });
        const { error: se } = await db().from('seller_profiles').update({ socials: Object.keys(r.socials).length ? r.socials : null }).eq('sub', user.sub);
        if (se && missingColumn(se)) throw Object.assign(new HttpError(503, 'Todavía no puedes agregar tus redes. Intenta más tarde.'), { code: 'socials_unavailable' });
        if (se) storeDbErr(se);
        socials = r.socials;
      }
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
      const show_last_seen = lastSeen ?? (await lastSeenStateOf(user.sub)).show;
      socials ??= await socialsOf(user.sub);
      return json(res, 200, { socials, ...('avatar_url' in patch ? { ...fresh, avatar_url: patch.avatar_url } : fresh), contact_phone, whatsapp_public: !!contact_phone && whatsapp_public, show_last_seen });
    }
    throw new HttpError(400, 'acción inválida');
  } catch (e) { return fail(res, e); }
}
