// Vendedor SIN cuenta Cavos acepta la invitación del comprador (opción A del plan, SOLO TESTNET). Server-only.
//  - Identidad: seller_guests (HMAC del correo + correo cifrado con pii.ts). seller_user_id = 'seller_guest:<uuid>'.
//  - Aceptación: código de 6 dígitos por correo (Brevo, el mismo canal de buyerContact.ts). Solo se guarda el HMAC del código.
//    El RPC seller_guest_accept (migración 038) hace código + lock + pedido + aceptación + sesión en UNA transacción.
//  - Sesión: cookie HttpOnly Secure SameSite=Lax `mss_<slug>` (Path=/api), válida SOLO para ese pedido; en la base solo el hash.
//  - Custodia: receiver = wallet platform (cola IBAN simulada), serviceProvider = backend. Nunca cae a Cavos.
//  - Todo detrás de SELLER_GUEST_ENABLED=1 (apagado por defecto). Sin correo configurado: no hay códigos (503), nunca falsos.
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { HttpError, requireCavosUser } from './auth';
import { db } from './db';
import { env } from './env';
import { guestSubFromReq } from './guest';
import { mailIsOn, sendMail } from './buyerContact';
import { maskEmail, normalizeEmail } from './contactText';
import { loadKeyRing, requireSeal } from './pii';
import { isMissingTable } from './push';
import { walletState } from './wallet';
import { missingColumn } from './listings';
import { HOLDER_PLACEHOLDER, IBAN_PLACEHOLDER } from './payout';
import { CURRENT_RULES_VERSION } from './orderRules';
import { DELIVERY_MODES, type DeliveryMode } from './agreement';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MIN, SELLER_GUEST_BETA, SELLER_GUEST_CONSENT_TEXT, SELLER_GUEST_CONSENT_VERSION, SELLER_GUEST_EXCEPTION, SELLER_GUEST_PREFIX,
  SELLER_GUEST_RETENTION_DAYS, SELLER_NOTICE_VERSION, SESSION_DAYS, guestProtection } from './sellerGuestText';

export const isGuestSellerOrder = (o: any) => o?.seller_auth_kind === 'guest';
/** Feature flag de la custodia para vendedores sin cuenta. Solo testnet (env.network() lanza si no). */
export const sellerGuestEnabled = () => process.env.SELLER_GUEST_ENABLED === '1' && env.network() === 'testnet';
/** ¿Se puede ofrecer hoy? Flag + correo configurado + llaves de PII + roles backend. */
export function sellerGuestAvailable(): { available: boolean; reason?: string } {
  if (!sellerGuestEnabled()) return { available: false, reason: 'disabled' };
  if (!mailIsOn()) return { available: false, reason: 'email_unconfigured' };
  if (!loadKeyRing()) return { available: false, reason: 'pii_unavailable' };
  if (!process.env.SERVICE_SECRET || !process.env.PLATFORM_PUBLIC) return { available: false, reason: 'roles_unconfigured' };
  return { available: true };
}
const unavailable = (reason?: string) => Object.assign(new HttpError(503, 'Por ahora no puedes aceptar sin cuenta. Entra con tu cuenta para aceptar.'), { code: 'seller_guest_unavailable', reason });
export function requireAvailable() { const a = sellerGuestAvailable(); if (!a.available) throw unavailable(a.reason); }

/** Dirección del serviceProvider backend: rol operativo del escrow, NO una wallet del vendedor. */
export const backendServiceProvider = () => Keypair.fromSecret(env.serviceSecret()).publicKey();

// ---------- Secretos derivados ----------
function key(label: string): Buffer {
  const s = process.env.ORDER_ACCESS_SECRET || process.env.PIN_PEPPER;
  if (!s) throw unavailable('secret_missing');
  return createHmac('sha256', s).update(label).digest();
}
export const contactHmac = (email: string) => createHmac('sha256', key('meteorito-seller-contact-v1')).update(email).digest('hex');
export const otpHash = (challengeId: string, code: string) => createHmac('sha256', key('meteorito-seller-otp-v1')).update(`${challengeId}:${code}`).digest('hex');
export const tokenHash = (token: string) => createHash('sha256').update(`meteorito-seller-session-v1:${token}`).digest('hex');

// ---------- Acuerdo ----------
const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null);
export const PAYOUT_TERMS = { method: 'iban', simulated: true, network: 'testnet', asset: 'USDC' } as const;
export interface Agreement { delivery_mode: DeliveryMode; protection_minutes: number; rules_version: number; hash: string }
/** Hash del acuerdo exacto que ve el vendedor: producto, precio, fotos, entrega, plazo, reglas, cobro y aviso de beta. */
export function agreementFor(inv: any, mode: DeliveryMode): Agreement {
  const protection_minutes = guestProtection(mode);
  const body = { v: 1, code: inv.code, title: `${inv.brand ?? ''} ${inv.model ?? ''}`.trim(), price_crc: Number(inv.price_crc), photos: Array.isArray(inv.photos) ? inv.photos : [],
    note: inv.note ?? null, source_url: inv.source_url ?? null, delivery_mode: mode, protection_minutes, rules_version: CURRENT_RULES_VERSION, payout: PAYOUT_TERMS, beta: SELLER_GUEST_BETA, exception: SELLER_GUEST_EXCEPTION };
  return { delivery_mode: mode, protection_minutes, rules_version: CURRENT_RULES_VERSION, hash: 'sha256:' + createHash('sha256').update(stable(body)).digest('hex') };
}
export const agreementsFor = (inv: any) => Object.fromEntries(DELIVERY_MODES.map((m) => [m, agreementFor(inv, m)])) as Record<DeliveryMode, Agreement>;
const modeOf = (v: unknown): DeliveryMode => {
  if (!DELIVERY_MODES.includes(v as DeliveryMode)) throw Object.assign(new HttpError(400, 'Elige envío o cara a cara.'), { code: 'bad_agreement' });
  return v as DeliveryMode;
};
const changed = () => Object.assign(new HttpError(409, 'El acuerdo cambió. Revisa los datos y vuelve a pedir el código.'), { code: 'agreement_changed' });
function checkAgreement(inv: any, b: any): Agreement {
  const a = agreementFor(inv, modeOf(b?.delivery_mode));
  if (typeof b?.agreement_hash !== 'string' || b.agreement_hash !== a.hash) throw changed();
  return a;
}
/** Snapshot inmutable del cobro (cola IBAN simulada): nunca un IBAN real. */
export function payoutSnapshot() {
  const receiver = env.platformPublic();
  return { ...PAYOUT_TERMS, receiver, iban: IBAN_PLACEHOLDER, holder_name: HOLDER_PLACEHOLDER, checksum: 'sha256:' + createHash('sha256').update(receiver).digest('hex') };
}

// ---------- Quién pide ----------
/** El comprador NO puede aceptar su propio link (llave de invitado o cuenta Cavos del comprador). */
async function assertNotBuyer(req: any, inv: any) {
  const own = () => Object.assign(new HttpError(400, 'No puedes aceptar tu propia invitación.'), { code: 'own_invite' });
  if (guestSubFromReq(req) === inv.buyer_user_id) throw own();
  if (String(req.headers?.authorization ?? '').startsWith('Bearer ')) {
    const u = await requireCavosUser(req).catch(() => null);
    if (u && u.sub === inv.buyer_user_id) throw own();
  }
}
function notOpen(inv: any) {
  if (inv.status !== 'abierta') throw Object.assign(new HttpError(409, 'Esta invitación ya fue aceptada o cancelada.'), { code: 'invite_not_open' });
}
const schemaMissing = (e: any) => isMissingTable(e) || missingColumn(e) || e?.code === 'PGRST202' || /function .*seller_guest/.test(String(e?.message));

// ---------- Correo ----------
async function mailCode(to: string, code: string, title: string, purpose: 'accept' | 'recover') {
  const what = purpose === 'accept' ? `aceptar la venta de “${title}”` : `recuperar tu acceso a la venta de “${title}”`;
  const text = `Tu código para ${what} es ${code}. Vence en ${OTP_TTL_MIN} minutos. Si no lo pediste, ignora este correo.\n\n${SELLER_GUEST_BETA}`;
  const html = `<p>Tu código para ${what.replace(/</g, '&lt;')} es:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Vence en ${OTP_TTL_MIN} minutos. Si no lo pediste, ignora este correo.</p><p style="color:#666">${SELLER_GUEST_BETA}</p>`;
  let r = { ok: false, status: 0 };
  try { r = await sendMail({ to, subject: `Tu código de Meteorito: ${code}`, html, text, tag: `vendedor_${purpose}` }); } catch { /* red */ }
  if (!r.ok) throw Object.assign(new HttpError(502, 'No pudimos enviar el código. Intenta de nuevo en un momento.'), { code: 'otp_send_failed' });
}

/** Busca o crea la identidad no-Cavos de este correo (HMAC único; el correo va cifrado). */
async function guestFor(email: string): Promise<string> {
  const h = contactHmac(email);
  const found = await db().from('seller_guests').select('id').eq('contact_hmac', h).maybeSingle();
  if (found.error) { if (schemaMissing(found.error)) throw unavailable('schema'); throw found.error; }
  if (found.data?.id) return found.data.id;
  const id = randomUUID();
  const ins = await db().from('seller_guests').insert({ id, channel: 'email', contact_hmac: h, contact_enc: requireSeal(email, 'seller_guests', 'email', h) });
  if (ins.error) {
    if (ins.error.code === '23505') { const again = await db().from('seller_guests').select('id').eq('contact_hmac', h).maybeSingle(); if (again.data?.id) return again.data.id; }
    if (schemaMissing(ins.error)) throw unavailable('schema');
    throw ins.error;
  }
  return id;
}

// ---------- Consentimiento del correo (migración 039; separado de la aceptación comercial) ----------
export const CONSENT_TEXT_SHA256 = createHash('sha256').update(SELLER_GUEST_CONSENT_TEXT).digest('hex');
/** Sin la casilla marcada (o con un texto viejo) no se guarda nada ni se manda código. */
export function requireConsent(b: any) {
  if (b?.consent !== true) throw Object.assign(new HttpError(400, 'Marca la casilla de autorización para recibir el código.'), { code: 'consent_required' });
  if (b?.consent_version !== SELLER_GUEST_CONSENT_VERSION) throw Object.assign(new HttpError(409, 'Actualiza la página para ver el texto vigente.'), { code: 'consent_outdated' });
}
async function recordConsent(guestId: string, inviteCode: string, purpose: 'accept' | 'recover'): Promise<string> {
  const id = randomUUID();
  const { error } = await db().from('seller_guest_consents').insert({ id, guest_id: guestId, invite_code: inviteCode, purpose, consent_version: SELLER_GUEST_CONSENT_VERSION,
    notice_version: SELLER_NOTICE_VERSION, consent_text_sha256: CONSENT_TEXT_SHA256, consented_at: new Date().toISOString() });
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  return id;
}

export const INVITE_OTP_PER_HOUR = 8;   // códigos por invitación
export const GUEST_OTP_PER_HOUR = 5;    // códigos por correo
async function capChallenges(col: 'invite_code' | 'guest_id', v: string, max: number) {
  const { data, error } = await db().from('seller_otp_challenges').select('id').eq(col, v).gte('created_at', new Date(Date.now() - 3600_000).toISOString()).limit(max);
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  if ((data ?? []).length >= max) throw Object.assign(new HttpError(429, 'Pediste demasiados códigos. Espera un rato e intenta de nuevo.'), { code: 'rate_limited', retryAfter: 3600 });
}
async function newChallenge(inv: any, guestId: string, purpose: 'accept' | 'recover', a: Agreement | null) {
  await capChallenges('invite_code', inv.code, INVITE_OTP_PER_HOUR);
  await capChallenges('guest_id', guestId, GUEST_OTP_PER_HOUR);
  const consent_id = await recordConsent(guestId, inv.code, purpose);
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires_at = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();
  const { error } = await db().from('seller_otp_challenges').insert({ id, invite_code: inv.code, guest_id: guestId, purpose, otp_hash: otpHash(id, code),
    agreement_hash: a?.hash ?? null, delivery_mode: a?.delivery_mode ?? null, expires_at, consent_id });
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  return { id, code, expires_at };
}

/** op seller_otp_request: { code, email, delivery_mode, agreement_hash } -> manda el código. */
export async function otpRequest(req: any, inv: any, b: any) {
  requireAvailable();
  notOpen(inv);
  await assertNotBuyer(req, inv);
  requireConsent(b);
  const email = normalizeEmail(b?.email);
  if (!email) throw Object.assign(new HttpError(400, 'Escribe un correo válido.'), { code: 'bad_email' });
  const a = checkAgreement(inv, b);
  const guestId = await guestFor(email);
  const ch = await newChallenge(inv, guestId, 'accept', a);
  try { await mailCode(email, ch.code, `${inv.brand ?? ''} ${inv.model ?? ''}`.trim(), 'accept'); }
  catch (e) { await db().from('seller_otp_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', ch.id); throw e; }
  return { challenge_id: ch.id, expires_at: ch.expires_at, sent_to: maskEmail(email) };
}

const RPC_ERR: Record<string, [number, string]> = {
  bad_code: [401, 'El código no es correcto.'],
  challenge_expired: [410, 'El código venció. Pide uno nuevo.'],
  challenge_used: [409, 'Ese código ya se usó. Pide uno nuevo.'],
  challenge_invalid: [400, 'Pide un código nuevo.'],
  too_many_attempts: [429, 'Demasiados intentos con este código. Pide uno nuevo.'],
  agreement_changed: [409, 'El acuerdo cambió. Revisa los datos y vuelve a pedir el código.'],
  invite_not_open: [409, 'Esta invitación ya fue aceptada o cancelada.'],
};
function rpcFail(r: any): never {
  const [status, msg] = RPC_ERR[r?.error] ?? [409, 'No pudimos aceptar. Intenta de nuevo.'];
  throw Object.assign(new HttpError(status, msg), { code: r?.error ?? 'accept_failed', ...(r?.attempts_left != null ? { attempts_left: r.attempts_left } : {}) });
}
const validOtp = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);
const validUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const cookieName = (slug: string) => `mss_${slug}`;
function setSessionCookie(res: any, slug: string, token: string) {
  res.setHeader?.('Set-Cookie', `${cookieName(slug)}=${token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}
function newSession() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token), expires: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString() };
}

/** op seller_accept: { code, challenge_id, otp, delivery_mode, agreement_hash } -> pedido + aceptación + sesión, atómico. */
export async function acceptInvite(req: any, res: any, inv: any, b: any) {
  requireAvailable();
  notOpen(inv);
  await assertNotBuyer(req, inv);
  if (!validUuid(b?.challenge_id) || !validOtp(b?.otp)) throw Object.assign(new HttpError(400, 'Escribe el código de 6 dígitos.'), { code: 'bad_code' });
  const a = checkAgreement(inv, b);
  // El receiver (platform) tiene que poder recibir USDC ya al aceptar; se revalida antes de desplegar y de fondear.
  await assertPlatformReady();
  const s = newSession();
  const order = { seller_address: backendServiceProvider(), price_crc: Number(inv.price_crc), delivery_mode: a.delivery_mode, protection_minutes: a.protection_minutes };
  const { data, error } = await db().rpc('seller_guest_accept', {
    p_challenge_id: b.challenge_id, p_otp_hash: otpHash(b.challenge_id, b.otp), p_agreement_hash: a.hash, p_order: order, p_payout: payoutSnapshot(),
    p_terms_version: a.rules_version, p_session_hash: s.hash, p_session_expires: s.expires, p_max_attempts: OTP_MAX_ATTEMPTS,
  });
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  if (!data?.ok) rpcFail(data);
  setSessionCookie(res, data.slug, s.token);
  return { slug: data.slug, accepted: true };
}

/** op seller_recover_request: { code, email }. Respuesta siempre igual (no dice si el correo es el del vendedor). */
export async function recoverRequest(inv: any, b: any) {
  requireAvailable();
  requireConsent(b);
  const email = normalizeEmail(b?.email);
  if (!email) throw Object.assign(new HttpError(400, 'Escribe un correo válido.'), { code: 'bad_email' });
  const same = { sent: true, challenge_id: null as string | null };
  if (inv.status !== 'aceptada') return same;
  const acc = await db().from('seller_acceptances').select('guest_id').eq('invite_code', inv.code).maybeSingle();
  if (acc.error) { if (schemaMissing(acc.error)) throw unavailable('schema'); throw acc.error; }
  const g = await db().from('seller_guests').select('id').eq('contact_hmac', contactHmac(email)).maybeSingle();
  // Mismo challenge_id falso cuando no coincide: el cliente no puede distinguir.
  if (!acc.data || !g.data || g.data.id !== acc.data.guest_id) return { ...same, challenge_id: randomUUID() };
  const ch = await newChallenge(inv, g.data.id, 'recover', null);
  await mailCode(email, ch.code, `${inv.brand ?? ''} ${inv.model ?? ''}`.trim(), 'recover');
  return { ...same, challenge_id: ch.id };
}
/** op seller_recover_verify: { code, challenge_id, otp } -> sesión nueva; las anteriores quedan revocadas. */
export async function recoverVerify(res: any, b: any) {
  requireAvailable();
  if (!validUuid(b?.challenge_id) || !validOtp(b?.otp)) throw Object.assign(new HttpError(400, 'Escribe el código de 6 dígitos.'), { code: 'bad_code' });
  const s = newSession();
  const { data, error } = await db().rpc('seller_guest_recover', { p_challenge_id: b.challenge_id, p_otp_hash: otpHash(b.challenge_id, b.otp), p_session_hash: s.hash, p_session_expires: s.expires, p_max_attempts: OTP_MAX_ATTEMPTS });
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  if (!data?.ok) rpcFail(data);
  setSessionCookie(res, data.slug, s.token);
  return { slug: data.slug, recovered: true };
}

// ---------- Sesión ----------
function cookies(req: any): Record<string, string> {
  const raw = String(req.headers?.cookie ?? '');
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
/** Sesión válida del vendedor sin cuenta para ESTE pedido (cookie mss_<slug>). Nunca lanza; null si no hay. */
export async function guestSellerSession(req: any, order: any): Promise<{ guest_id: string } | null> {
  if (!isGuestSellerOrder(order) || typeof order.slug !== 'string') return null;
  const tok = cookies(req)[cookieName(order.slug)];
  if (!tok || !/^[A-Za-z0-9_-]{43}$/.test(tok)) return null;
  try {
    const { data, error } = await db().from('seller_guest_sessions').select('guest_id, order_id, expires_at, revoked_at').eq('token_hash', tokenHash(tok)).maybeSingle();
    if (error || !data) return null;
    if (data.order_id !== order.id || data.revoked_at || !(Date.parse(data.expires_at) > Date.now()) || data.guest_id !== order.seller_guest_id) return null;
    const a = Buffer.from(`${SELLER_GUEST_PREFIX}${data.guest_id}`), bb = Buffer.from(String(order.seller_user_id));
    return a.length === bb.length && timingSafeEqual(a, bb) ? { guest_id: data.guest_id } : null;
  } catch { return null; }
}
/** Quién actúa como vendedor de este pedido: la cuenta Cavos (pedidos de siempre) o la sesión del vendedor sin cuenta.
 *  Devuelve el sub a comparar con order.seller_user_id; quien llama mantiene su comprobación de siempre. */
export async function sellerSubFor(req: any, order: any): Promise<string> {
  if (isGuestSellerOrder(order)) {
    const s = await guestSellerSession(req, order);
    if (!s) throw Object.assign(new HttpError(401, 'Abre el link de la venta en el navegador donde aceptaste, o recupera tu acceso con tu correo.'), { code: 'seller_session_required' });
    return order.seller_user_id;
  }
  return (await requireCavosUser(req)).sub;
}
/** Subs de vendedor sin cuenta con sesión válida en esta petición (todas las cookies mss_*). Para el bucket de fotos. */
export async function guestSellerSubs(req: any): Promise<string[]> {
  const slugs = Object.keys(cookies(req)).filter((k) => /^mss_[a-z0-9]{6}$/.test(k)).map((k) => k.slice(4)).slice(0, 10);
  const out: string[] = [];
  for (const slug of slugs) {
    const { data } = await db().from('orders').select('id, slug, seller_auth_kind, seller_guest_id, seller_user_id').eq('slug', slug).maybeSingle();
    if (data && (await guestSellerSession(req, data))) out.push(data.seller_user_id);
  }
  return out;
}

// ---------- Custodia ----------
async function assertPlatformReady() {
  const st = await walletState(env.platformPublic()).catch(() => 'error');
  if (st !== 'ready') throw Object.assign(new HttpError(503, 'Por ahora no podemos recibir pagos para ventas sin cuenta. Intenta más tarde.'), { code: 'platform_not_ready' });
}
/** Antes de desplegar y antes de CUALQUIER fondeo de un pedido de vendedor sin cuenta: flag encendido, aceptación válida y
 *  el destino guardado = platform (cola IBAN simulada). Si algo no cuadra: error, jamás fallback a Cavos ni a otra dirección. */
export async function guestPayee(order: any, opts: { checkWallet?: boolean } = {}): Promise<{ address: string; route: 'iban' }> {
  if (!sellerGuestEnabled()) throw Object.assign(new HttpError(503, 'Los pagos a vendedores sin cuenta todavía no están habilitados.'), { code: 'seller_guest_disabled' });
  const { data: acc, error } = await db().from('seller_acceptances').select('order_id, agreement_hash, payout_snapshot, terms_version').eq('order_id', order.id).maybeSingle();
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  if (!acc) throw Object.assign(new HttpError(409, 'Quien vende todavía no aceptó este acuerdo.'), { code: 'seller_not_accepted' });
  const platform = env.platformPublic();
  const snap = acc.payout_snapshot ?? {};
  if (snap.method !== 'iban' || snap.simulated !== true || snap.receiver !== platform || order.payout_method !== 'iban' || order.payout_address !== platform)
    throw Object.assign(new HttpError(409, 'El destino del cobro no coincide con lo aceptado.'), { code: 'payout_mismatch' });
  if (order.seller_address !== backendServiceProvider()) throw Object.assign(new HttpError(409, 'El pedido no coincide con lo aceptado.'), { code: 'payout_mismatch' });
  if (opts.checkWallet) await assertPlatformReady();
  return { address: platform, route: 'iban' };
}

// ---------- Vista del vendedor ----------
/** Lo que ve el vendedor sin cuenta en /i/<code> (solo con su sesión). "Fondos en custodia" solo con depósito verificado on-chain:
 *  el pedido llega a 'fondeado' únicamente después de fundingCheck (monto exacto) en escrow.ts. */
export function sellerOrderView(o: any) {
  const paid = !!o.funded_tx && ['fondeado', 'enviado', 'entregado', 'en_disputa'].includes(o.status);
  return { slug: o.slug, status: o.status, delivery_mode: o.delivery_mode ?? 'envio', funds_in_custody: paid, funded_at: paid ? o.funded_at ?? null : null,
    shipped_at: o.shipped_at ?? null, shipped_tx: o.shipped_tx ?? null, auto_release_at: o.auto_release_at ?? null, release_ext: o.release_ext ?? null,
    rules_version: o.rules_version ?? null, released: o.status === 'liberado' || o.status === 'resuelto', price_crc: Number(o.price_crc), payout: 'iban_simulado' };
}

// ---------- Retención (migración 039) ----------
/** Disocia el correo de vendedores sin cuenta vencidos (pg_cron lo hace cada día) o, con email, de ese vendedor a pedido
 *  (supresión antes de plazo; nunca con una venta abierta: blocked=1). Solo admin (api/invites op seller_guest_purge). */
export async function purgeGuests(b: any) {
  const email = b?.email == null ? null : normalizeEmail(b.email);
  if (b?.email != null && !email) throw Object.assign(new HttpError(400, 'Escribe un correo válido.'), { code: 'bad_email' });
  let guest: string | null = null;
  if (email) {
    const g = await db().from('seller_guests').select('id').eq('contact_hmac', contactHmac(email)).maybeSingle();
    if (g.error) { if (schemaMissing(g.error)) throw unavailable('schema'); throw g.error; }
    if (!g.data?.id) return { ok: true, erased: 0, sessions: 0, codes: 0, blocked: 0, found: false };
    guest = g.data.id;
  }
  const { data, error } = await db().rpc('seller_guest_purge', { p_days: guest ? 0 : SELLER_GUEST_RETENTION_DAYS, p_guest: guest });
  if (error) { if (schemaMissing(error)) throw unavailable('schema'); throw error; }
  return { ...(data ?? {}), found: guest ? true : undefined };
}
