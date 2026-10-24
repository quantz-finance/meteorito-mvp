// Comprador SIN cuenta: avisos por WhatsApp / correo / cuenta, links de acceso firmados y vínculo con una cuenta Cavos.
// Diseño (docs/guest-contact.md):
//  - Link de acceso = HMAC sin estado {link, slug, buyer_user_id, exp 7 días}. Al abrirlo, el dispositivo recibe un
//    PERMISO {grant, slug, buyer_user_id, exp 120 días} que viaja en X-Order-Access y vale SOLO para ese pedido.
//    Funciona sin la migración 028 (no hay tabla): recuperar el acceso nunca depende de la base.
//  - Contactos, vínculo con cuenta y bitácora de avisos viven en la migración 028. Sin ella: available:false y nada más.
//  - Teléfono y correo NUNCA salen hacia el vendedor: solo el comprador (enmascarado) y el equipo (ADMIN_EMAILS) los ven.
//  - Correo: Brevo transaccional (la misma cuenta del landing), detrás de GUEST_EMAIL_ENABLED=1 + BREVO_API_KEY.
//  - WhatsApp: no hay API de envío. Se guarda el número y el equipo le escribe con un wa.me listo (admin_contacts).
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './auth';
import { isMissingTable } from './push';
import {
  ACCESS_GRANT_DAYS, BETA_NOTICE_TEXT as BETA_NOTICE, ACCESS_LINK_DAYS, CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION, NOTICE_BY_STATUS, buildNotice, maskEmail, maskPhone,
  normalizeEmail, normalizePhone, waLink, type ContactChannel, type NoticeKind, type NoticeOrder,
} from './contactText';

interface Db { from(t: string): any }
type Who = { ids: string[]; guest: string | null; cavos: { sub: string; email?: string } | null };

// ---------- Tokens firmados ----------
type AccessKind = 'link' | 'grant';
export interface AccessClaims { k: AccessKind; s: string; b: string; e: number; n: string }
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function accessKey(): Buffer {
  const secret = process.env.ORDER_ACCESS_SECRET || process.env.PIN_PEPPER;
  if (!secret) throw new HttpError(503, 'Los links de acceso todavía no están disponibles.');
  return createHmac('sha256', secret).update('meteorito-order-access-v1').digest();
}
const sign = (body: string) => createHmac('sha256', accessKey()).update(`v1.${body}`).digest();

export function signAccess(kind: AccessKind, slug: string, buyer: string, now = Date.now()): string {
  const days = kind === 'link' ? ACCESS_LINK_DAYS : ACCESS_GRANT_DAYS;
  const c: AccessClaims = { k: kind, s: slug, b: buyer, e: Math.floor(now / 1000) + days * 86400, n: randomBytes(6).toString('base64url') };
  const body = b64u(JSON.stringify(c));
  return `v1.${body}.${b64u(sign(body))}`;
}
/** Claims si el token es de ese tipo, está firmado con nuestra llave y no venció. Nunca lanza. */
export function verifyAccess(token: unknown, kind: AccessKind, now = Date.now()): AccessClaims | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  try {
    const want = sign(m[1]), got = Buffer.from(m[2], 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const c = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) as AccessClaims;
    if (c.k !== kind || !/^[a-z0-9]{6}$/.test(c.s) || typeof c.b !== 'string' || !c.b || !(c.e * 1000 > now)) return null;
    return c;
  } catch { return null; }
}
/** Permiso X-Order-Access válido para ESTE slug -> buyer_user_id; si no, null. */
export function grantBuyerFromReq(req: any, slug: unknown): string | null {
  const raw = req.headers?.['x-order-access'];
  const tok = Array.isArray(raw) ? raw[0] : raw;
  if (!tok || typeof slug !== 'string') return null;
  const c = verifyAccess(tok, 'grant');
  return c && c.s === slug ? c.b : null;
}

export const appUrl = () => (process.env.APP_URL || 'https://pago.meteorito.app').replace(/\/+$/, '');
export const accessLinkFor = (o: { slug: string; buyer_user_id: string }) => `${appUrl()}/p/${o.slug}?acceso=${signAccess('link', o.slug, o.buyer_user_id)}`;

// ---------- Correo (Brevo) ----------
export interface Mail { to: string; subject: string; html: string; text: string; tag: string }
export type Mailer = (m: Mail) => Promise<{ ok: boolean; status: number }>;
export const emailEnabled = () => process.env.GUEST_EMAIL_ENABLED === '1' && !!process.env.BREVO_API_KEY;
const brevoMailer: Mailer = async (m) => {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', signal: AbortSignal.timeout(6000),
    headers: { 'api-key': process.env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.EMAIL_FROM || 'hola@meteorito.app', name: process.env.EMAIL_FROM_NAME || 'Meteorito' },
      to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text, tags: ['comprador', m.tag],
    }),
  });
  return { ok: r.ok, status: r.status };
};
let mailer: Mailer = brevoMailer;
let mailOn: () => boolean = emailEnabled;
/** Solo tests. */
export const __setMailerForTests = (m: Mailer | null, on?: boolean) => { mailer = m ?? brevoMailer; mailOn = on == null ? emailEnabled : () => on; };

// ---------- Contactos ----------
const unavailable = () => Object.assign(new HttpError(503, 'Por ahora no podemos guardar tu contacto. Tu compra sigue en este navegador.'), { code: 'contact_unavailable' });
const CONTACT_STATUSES = ['escrow_creado', 'fondeado', 'enviado', 'entregado', 'en_disputa'];

export interface ContactView { channel: ContactChannel; masked: string }
const view = (c: any): ContactView => ({
  channel: c.channel,
  masked: c.channel === 'whatsapp' ? maskPhone(c.phone_e164) : c.email ? maskEmail(c.email) : 'Tu cuenta',
});

/** Estado de la tarjeta: si la función está disponible (028) y qué contactos hay (enmascarados). */
export async function getContacts(db: Db, order: any): Promise<{ available: boolean; contacts: ContactView[]; email: boolean }> {
  const { data, error } = await db.from('buyer_contacts').select('channel, phone_e164, email, account_sub, revoked_at').eq('order_id', order.id);
  if (error) { if (isMissingTable(error)) return { available: false, contacts: [], email: mailOn() }; throw error; }
  return { available: true, contacts: (data ?? []).filter((c: any) => !c.revoked_at).map(view), email: mailOn() };
}

export interface SaveInput { channel: unknown; cc?: unknown; phone?: unknown; email?: unknown; consent?: unknown; consent_version?: unknown }
/** Guarda (o cambia) el contacto de un canal. El consentimiento es obligatorio y se guarda con su versión de texto. */
export async function saveContact(db: Db, order: any, who: Who, b: SaveInput): Promise<{ saved: true; contact: ContactView; emailed: boolean }> {
  if (!CONTACT_STATUSES.includes(order.status)) throw Object.assign(new HttpError(409, 'Esta compra ya no recibe avisos nuevos.'), { code: 'contact_closed' });
  if (b.consent !== true) throw Object.assign(new HttpError(400, 'Marca la casilla para aceptar el uso de tu contacto.'), { code: 'consent_required' });
  if (b.consent_version !== CONTACT_CONSENT_VERSION) throw Object.assign(new HttpError(409, 'Actualiza la página para ver el texto vigente.'), { code: 'consent_outdated' });
  const row: Record<string, unknown> = {
    order_id: order.id, order_slug: order.slug, buyer_user_id: order.buyer_user_id, channel: b.channel,
    phone_e164: null, email: null, account_sub: null, consent_text: CONTACT_CONSENT_TEXT, consent_text_version: CONTACT_CONSENT_VERSION,
    consent_at: new Date().toISOString(), updated_at: new Date().toISOString(), revoked_at: null,
  };
  if (b.channel === 'whatsapp') {
    row.phone_e164 = normalizePhone(b.cc, b.phone);
    if (!row.phone_e164) throw Object.assign(new HttpError(400, 'Revisa el número: código de país y número, sin espacios de más.'), { code: 'bad_phone' });
  } else if (b.channel === 'email') {
    row.email = normalizeEmail(b.email);
    if (!row.email) throw Object.assign(new HttpError(400, 'Revisa el correo.'), { code: 'bad_email' });
  } else if (b.channel === 'account') {
    if (!who.cavos) throw Object.assign(new HttpError(401, 'Entra con tu cuenta para continuar.'), { code: 'auth_missing' });
    row.account_sub = who.cavos.sub; row.email = normalizeEmail(who.cavos.email);
  } else throw new HttpError(400, 'Elige WhatsApp, correo o cuenta.');
  const { error } = await db.from('buyer_contacts').upsert(row, { onConflict: 'order_id,channel' });
  if (error) { if (isMissingTable(error)) throw unavailable(); throw error; }
  // Correo: el primer aviso es el link de acceso (sirve para recuperar la compra en otro teléfono).
  let emailed = false;
  if (row.email && b.channel !== 'whatsapp') emailed = (await sendNotice(db, order, 'acceso', { only: b.channel as ContactChannel })).email > 0;
  return { saved: true, contact: view(row), emailed };
}

export async function removeContact(db: Db, order: any, channel: unknown) {
  if (!['whatsapp', 'email', 'account'].includes(String(channel))) throw new HttpError(400, 'Canal inválido.');
  const { error } = await db.from('buyer_contacts').update({ revoked_at: new Date().toISOString() }).eq('order_id', order.id).eq('channel', channel);
  if (error) { if (isMissingTable(error)) throw unavailable(); throw error; }
  return { removed: true };
}

// ---------- Cuenta Cavos ----------
/** Vincula la llave de invitado de este dispositivo con la cuenta: sus compras aparecen en la cuenta (y siguen aquí). */
export async function linkAccount(db: Db, who: Who): Promise<{ linked: boolean; reason?: string }> {
  if (!who.cavos) throw Object.assign(new HttpError(401, 'Entra con tu cuenta para continuar.'), { code: 'auth_missing' });
  if (!who.guest) return { linked: false, reason: 'no_guest' };
  const { error } = await db.from('buyer_links').upsert({ guest_sub: who.guest, account_sub: who.cavos.sub }, { onConflict: 'guest_sub,account_sub', ignoreDuplicates: true });
  if (error) { if (isMissingTable(error)) return { linked: false, reason: 'unavailable' }; throw error; }
  return { linked: true };
}
/** Llaves de invitado vinculadas a una cuenta (para requireBuyerIdentity). Sin 028: []. Nunca lanza. */
export async function linkedGuests(db: Db, accountSub: string): Promise<string[]> {
  try {
    const { data, error } = await db.from('buyer_links').select('guest_sub').eq('account_sub', accountSub).limit(50);
    if (error) return [];
    return (data ?? []).map((r: any) => r.guest_sub).filter((g: any) => typeof g === 'string');
  } catch { return []; }
}

// ---------- Link de acceso ----------
/** Abre un link de acceso: devuelve un permiso para este dispositivo (solo ese pedido). */
export function redeemAccess(order: any, token: unknown): { grant: string; slug: string } {
  const c = verifyAccess(token, 'link');
  if (!c || c.s !== order.slug || c.b !== order.buyer_user_id) {
    throw Object.assign(new HttpError(403, 'Este link venció o no es de esta compra. Pide uno nuevo desde el último aviso.'), { code: 'access_invalid' });
  }
  return { grant: signAccess('grant', order.slug, order.buyer_user_id), slug: order.slug };
}

/** Mismo hash que api/_lib/escrow.ts pinHash (t85 lo compara). Aquí para no traer el cliente de Trustless Work a /api/store. */
export const pinHashOf = (orderId: string, pin: string) => createHash('sha256').update(`${process.env.PIN_PEPPER ?? ''}:${orderId}:${pin}`).digest('hex');
/** Código de entrega NUEVO para un dispositivo recuperado (el anterior deja de servir). Solo antes de liberar. */
export async function reissuePin(db: Db, order: any): Promise<{ pin: string }> {
  if (!['fondeado', 'enviado'].includes(order.status)) throw Object.assign(new HttpError(409, 'Esta compra ya no usa código de entrega.'), { code: 'pin_not_needed' });
  if (!process.env.PIN_PEPPER) throw new HttpError(503, 'No pudimos generar el código. Intenta de nuevo.');
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { data, error } = await db.from('orders').update({ delivery_pin_hash: pinHashOf(order.id, pin) }).eq('id', order.id).eq('status', order.status).select('id');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new HttpError(409, 'La compra cambió de estado. Actualiza la página.'), { code: 'status_changed' });
  return { pin };
}

// ---------- Avisos ----------
export const NOTICE_DAILY_CAP = 6;      // por pedido y canal en 24 h
export const ACCESS_RESEND_MIN = 10;    // reenvío del link de acceso: cada 10 min como máximo

interface SendOpts { only?: ContactChannel; now?: number }
/** Envía un aviso a los contactos del pedido. Deduplica por (pedido, canal, aviso) y limita la frecuencia. Nunca lanza. */
export async function sendNotice(db: Db, order: NoticeOrder & { id: string; buyer_user_id: string }, kind: NoticeKind, opts: SendOpts = {}): Promise<{ email: number; whatsapp: number; skipped: number }> {
  const out = { email: 0, whatsapp: 0, skipped: 0 };
  try {
    let q = db.from('buyer_contacts').select('channel, phone_e164, email, revoked_at').eq('order_id', order.id);
    if (opts.only) q = q.eq('channel', opts.only);
    const { data: contacts, error } = await q;
    if (error || !contacts?.length) return out;
    const now = opts.now ?? Date.now();
    for (const c of contacts) {
      if (c.revoked_at) continue;
      const channel = c.channel as ContactChannel;
      if (channel !== 'whatsapp' && !c.email) continue;
      const dedupe = kind === 'acceso' ? `acceso:${Math.floor(now / (ACCESS_RESEND_MIN * 60_000))}` : kind;
      const { data: recent } = await db.from('buyer_notifications').select('id').eq('order_id', order.id).eq('channel', channel)
        .gte('created_at', new Date(now - 86_400_000).toISOString()).limit(NOTICE_DAILY_CAP);
      if ((recent ?? []).length >= NOTICE_DAILY_CAP) { out.skipped++; continue; }
      const link = accessLinkFor(order);
      const n = buildNotice(kind, order, link, BETA_NOTICE);
      const isEmail = channel !== 'whatsapp';
      const status = isEmail ? (mailOn() ? 'sent' : 'skipped') : 'pending_manual';
      // Reserva primero (índice único): dos cambios de estado simultáneos no mandan el mismo aviso dos veces.
      const ins = await db.from('buyer_notifications').insert({ order_id: order.id, channel, kind, dedupe_key: dedupe, status, detail: {}, created_at: new Date(now).toISOString() });
      if (ins.error) { out.skipped++; continue; }
      if (!isEmail) { out.whatsapp++; continue; } // el equipo lo envía con el wa.me de admin_contacts
      if (!mailOn()) { out.skipped++; continue; }
      let r = { ok: false, status: 0 };
      try { r = await mailer({ to: c.email, subject: n.subject, html: n.html, text: n.text, tag: kind }); } catch { /* red */ }
      if (r.ok) out.email++;
      else {
        out.skipped++;
        await db.from('buyer_notifications').update({ status: 'failed', detail: { http: r.status } }).eq('order_id', order.id).eq('channel', channel).eq('dedupe_key', dedupe);
      }
    }
  } catch (e: any) { console.warn('[buyerContact] aviso falló', kind, e?.message); }
  return out;
}
/** Hook de cambio de estado (db.ts advance). Best-effort. */
export async function notifyBuyerStatus(db: Db, o: { id: string; slug: string; status: string; buyer_user_id?: string | null; brand?: string | null; model?: string | null }) {
  const kind = NOTICE_BY_STATUS[o.status];
  if (!kind || !o.buyer_user_id) return null;
  return sendNotice(db, { ...o, buyer_user_id: o.buyer_user_id }, kind);
}

// ---------- Equipo ----------
const admins = () => (process.env.ADMIN_EMAILS ?? '').split(',').map((x: string) => x.trim().toLowerCase()).filter(Boolean) as string[];
export function requireAdmin(who: Who) {
  const email = normalizeEmail(who.cavos?.email);
  if (!who.cavos || !email || !admins().includes(email)) throw Object.assign(new HttpError(403, 'Solo el equipo.'), { code: 'not_admin' });
}
/** Contactos de un pedido para el EQUIPO (sin enmascarar) con el wa.me del último aviso listo para enviar. */
export async function adminContacts(db: Db, order: any) {
  const { data, error } = await db.from('buyer_contacts').select('channel, phone_e164, email, consent_text_version, consent_at, revoked_at').eq('order_id', order.id);
  if (error) { if (isMissingTable(error)) return { available: false, contacts: [] }; throw error; }
  const kind: NoticeKind = NOTICE_BY_STATUS[order.status] ?? 'acceso';
  const n = buildNotice(kind, order, accessLinkFor(order), BETA_NOTICE);
  return {
    available: true,
    contacts: (data ?? []).map((c: any) => ({ ...c, wa_link: c.channel === 'whatsapp' && c.phone_e164 && !c.revoked_at ? waLink(c.phone_e164, n.whatsapp) : null })),
  };
}

/** Cron: pedidos con la liberación automática en menos de 24 h -> aviso 'por_liberar' (una vez por pedido y canal). */
export async function notifyDueSoon(db: Db, now = Date.now()): Promise<number> {
  try {
    const { data: contacts, error } = await db.from('buyer_contacts').select('order_id').is('revoked_at', null).limit(500);
    if (error || !contacts?.length) return 0;
    const ids = [...new Set(contacts.map((c: any) => c.order_id))];
    const { data: orders } = await db.from('orders').select('id, slug, status, buyer_user_id, brand, model, auto_release_at, delivery_mode')
      .in('id', ids).in('status', ['enviado', 'fondeado']).gt('auto_release_at', new Date(now).toISOString())
      .lte('auto_release_at', new Date(now + 86_400_000).toISOString()).limit(50);
    let sent = 0;
    for (const o of orders ?? []) {
      if (o.status === 'fondeado' && o.delivery_mode !== 'cara_a_cara') continue; // envío: el plazo corre desde "Ya lo envié"
      const r = await sendNotice(db, o, 'por_liberar', { now });
      sent += r.email + r.whatsapp;
    }
    return sent;
  } catch (e: any) { console.warn('[buyerContact] por_liberar falló', e?.message); return 0; }
}
