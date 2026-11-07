// (114) Vendedor SIN cuenta acepta el link del comprador (opción A, solo testnet). Sin red. QA del plan:
// comprador no acepta su link; link reenviado no autoriza envío/cobro; OTP vencido/reusado/fuerza bruta; un pedido por
// invitación; cambio de precio/entrega invalida el código; sesión recuperada revoca la anterior; sin schema no se crea ni
// fondea; platform sin trustline bloquea; flag apagado; nunca cae a Cavos; sin PII/OTP en la vista pública;
// "fondos en custodia" solo con depósito confirmado; cola IBAN idempotente con el principal no-Cavos.
import { createHash, randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { __setMailerForTests } from '../../api/_lib/buyerContact';
import { env } from '../../api/_lib/env';
import { agreementFor, guestPayee, sellerOrderView, sellerGuestAvailable, tokenHash } from '../../api/_lib/sellerGuest';
import { serviceProviderFor, mockRampFund } from '../../api/_lib/escrow';
import { enqueueIbanPayout } from '../../api/_lib/payoutChoice';
import { IBAN_PLACEHOLDER } from '../../api/_lib/payout';
import { SELLER_GUEST_BETA, SELLER_GUEST_CONSENT_TEXT, SELLER_GUEST_CONSENT_VERSION, SELLER_NOTICE_VERSION } from '../../api/_lib/sellerGuestText';
const CONSENT = { consent: true, consent_version: SELLER_GUEST_CONSENT_VERSION };
import invites from '../../api/invites/index';
import pay from '../../api/escrow/pay';
import ship from '../../api/escrow/ship';
import confirm from '../../api/escrow/confirm';
import upload from '../../api/photos/upload-url';

const BUYER_KEY = 'a'.repeat(64), SELLER_KEY = 'b'.repeat(64), OTHER_KEY = 'c'.repeat(64);
const SP = Keypair.random(), PLATFORM = Keypair.random().publicKey();

function mkRes() {
  const r: any = { code: 0, body: null as any, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; return r; };
  r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  return r;
}
async function call(h: any, o: { method?: string; body?: any; query?: any; guest?: string | null; tok?: string | null; cookie?: string | null }) {
  const r = mkRes();
  const rq: any = { method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) }, body: o.body ?? {}, query: o.query ?? {} };
  await h(rq, r); return r;
}
const cookieOf = (r: any) => String(r.headers['set-cookie'] ?? '').split(';')[0];

/** Mismo comportamiento que los RPC de la migración 038 (la versión SQL se prueba en t115 con Postgres real). */
function installRpc(db: any) {
  const T = db.tables;
  for (const t of ['seller_guests', 'seller_otp_challenges', 'seller_acceptances', 'seller_guest_sessions']) T[t] ??= [];
  db.rpc = async (name: string, a: any) => {
    if (name === 'rate_limit_hit') return { data: [{ allowed: true }], error: null };
    if (name === 'seller_guest_purge') { db.purgeCalls = [...(db.purgeCalls ?? []), a]; return { data: { ok: true, erased: a.p_guest ? 1 : 0, sessions: 0, codes: 0, blocked: 0 }, error: null }; }
    if (db.noRpc) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    const ch = T.seller_otp_challenges.find((c: any) => c.id === a.p_challenge_id);
    const want = name === 'seller_guest_accept' ? 'accept' : 'recover';
    if (!ch || (ch.purpose ?? 'accept') !== want) return { data: { ok: false, error: 'challenge_invalid' }, error: null };
    if (ch.consumed_at) return { data: { ok: false, error: 'challenge_used' }, error: null };
    if (Date.parse(ch.expires_at) <= Date.now()) return { data: { ok: false, error: 'challenge_expired' }, error: null };
    if ((ch.attempts ?? 0) >= a.p_max_attempts) return { data: { ok: false, error: 'too_many_attempts' }, error: null };
    if (ch.otp_hash !== a.p_otp_hash) { ch.attempts = (ch.attempts ?? 0) + 1; return { data: { ok: false, error: 'bad_code', attempts_left: Math.max(0, a.p_max_attempts - ch.attempts) }, error: null }; }
    if (name === 'seller_guest_recover') {
      const acc = T.seller_acceptances.find((x: any) => x.invite_code === ch.invite_code);
      ch.consumed_at = new Date().toISOString();
      if (!acc || acc.guest_id !== ch.guest_id) return { data: { ok: false, error: 'challenge_invalid' }, error: null };
      T.seller_guest_sessions.filter((s: any) => s.order_id === acc.order_id && !s.revoked_at).forEach((s: any) => { s.revoked_at = new Date().toISOString(); });
      T.seller_guest_sessions.push({ token_hash: a.p_session_hash, guest_id: acc.guest_id, order_id: acc.order_id, expires_at: a.p_session_expires, revoked_at: null });
      return { data: { ok: true, slug: T.orders.find((o: any) => o.id === acc.order_id).slug }, error: null };
    }
    if (ch.agreement_hash !== a.p_agreement_hash || ch.delivery_mode !== a.p_order.delivery_mode) { ch.consumed_at = 'x'; return { data: { ok: false, error: 'agreement_changed' }, error: null }; }
    const inv = T.invitations.find((i: any) => i.code === ch.invite_code);
    if (!inv || inv.status !== 'abierta') { ch.consumed_at = 'x'; return { data: { ok: false, error: 'invite_not_open' }, error: null }; }
    if (Number(inv.price_crc) !== Number(a.p_order.price_crc)) { ch.consumed_at = 'x'; return { data: { ok: false, error: 'agreement_changed' }, error: null }; }
    const id = randomUUID(), slug = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    T.orders.push({ id, slug, seller_address: a.p_order.seller_address, seller_user_id: `seller_guest:${ch.guest_id}`, seller_auth_kind: 'guest', seller_guest_id: ch.guest_id,
      category: inv.category, brand: inv.brand, model: inv.model, price_crc: inv.price_crc, photos: inv.photos ?? [], status: 'creado', kind: 'single',
      delivery_mode: a.p_order.delivery_mode, protection_minutes: a.p_order.protection_minutes, rules_version: a.p_terms_version, payout_method: 'iban', payout_address: a.p_payout.receiver });
    T.seller_acceptances.push({ invite_code: inv.code, order_id: id, guest_id: ch.guest_id, challenge_id: ch.id, terms_version: a.p_terms_version, agreement_hash: a.p_agreement_hash, payout_snapshot: a.p_payout });
    Object.assign(inv, { status: 'aceptada', order_slug: slug, seller_user_id: `seller_guest:${ch.guest_id}` });
    ch.consumed_at = new Date().toISOString();
    T.seller_guest_sessions.push({ token_hash: a.p_session_hash, guest_id: ch.guest_id, order_id: id, expires_at: a.p_session_expires, revoked_at: null });
    return { data: { ok: true, slug, order_id: id }, error: null };
  };
}

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  Object.assign(process.env, { SERVICE_SECRET: SP.secret(), PLATFORM_PUBLIC: PLATFORM, SELLER_GUEST_ENABLED: '1', RATE_LIMIT_DISABLED: '1' });
  let platformReady = true;
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: a === PLATFORM && !platformReady ? [] : [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer(), is_authorized: true }] }) }) as any);
  const mails: { to: string; text: string }[] = [];
  __setMailerForTests(async (m) => { mails.push({ to: m.to, text: m.text }); return { ok: true, status: 201 }; }, true);
  const lastCode = () => /(\d{6})/.exec(mails[mails.length - 1]?.text ?? '')?.[1] ?? '';
  const db: any = fakeDb(); __setDbForTests(db); installRpc(db);

  // Comprador (invitado) crea la invitación.
  let r = await call(invites, { guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }), body: { op: 'create', title: 'Bicicleta de montaña', price_crc: 120000 } });
  const code = r.body?.code as string;
  t.check('comprador crea la invitación', r.code === 200 && /^[a-z0-9]{8}$/.test(code), `${r.code} ${r.body?.error}`);

  // GET público: acuerdo exacto, sin PII.
  r = await call(invites, { method: 'GET', query: { code }, guest: SELLER_KEY });
  const ag = r.body?.seller_guest?.agreements;
  t.check('GET: available + hashes por tipo de entrega (24 h cara a cara, 7 días envío)', r.body?.seller_guest?.available === true && /^sha256:/.test(ag?.envio?.hash) && ag?.cara_a_cara?.protection_minutes === 1440 && ag?.envio?.protection_minutes === 10080, JSON.stringify(r.body?.seller_guest));
  r = await call(invites, { method: 'GET', query: { code }, guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }) });
  t.check('GET del comprador: sin bloque de vendedor', r.body?.mine === true && !('seller_guest' in r.body));
  const h = ag.envio.hash;

  // El comprador con cuenta no puede aceptar su propio link.
  r = await call(invites, { guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }), body: { op: 'seller_otp_request', code, email: 'yo@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  t.check('comprador (misma llave) no puede pedir código para su link -> 400 own_invite', r.code === 400 && r.body?.code === 'own_invite' && mails.length === 0, `${r.code} ${r.body?.code}`);
  const inv0 = db.tables.invitations[0];
  inv0.buyer_user_id = 'cavos-buyer-1'; // comprador con cuenta (PR "Comprar primero")
  r = await call(invites, { tok: await token({ sub: 'cavos-buyer-1' }), body: { op: 'seller_otp_request', code, email: 'yo@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  t.check('comprador (cuenta Cavos) no puede aceptar su link -> 400 own_invite', r.code === 400 && r.body?.code === 'own_invite', `${r.code} ${r.body?.code}`);

  // Hash viejo / modo cambiado.
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'cara_a_cara', agreement_hash: h, ...CONSENT } });
  t.check('hash de otro acuerdo (entrega distinta) -> 409 agreement_changed', r.code === 409 && r.body?.code === 'agreement_changed', `${r.code} ${r.body?.code}`);

  // Flag apagado / correo sin configurar: sin códigos.
  process.env.SELLER_GUEST_ENABLED = '';
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  t.check('flag apagado -> 503 seller_guest_unavailable, sin correo', r.code === 503 && r.body?.code === 'seller_guest_unavailable' && mails.length === 0, `${r.code}`);
  process.env.SELLER_GUEST_ENABLED = '1';
  __setMailerForTests(async () => ({ ok: true, status: 201 }), false);
  t.check('correo sin configurar -> no disponible (no se inventan códigos)', sellerGuestAvailable().available === false && sellerGuestAvailable().reason === 'email_unconfigured');
  __setMailerForTests(async (m) => { mails.push({ to: m.to, text: m.text }); return { ok: true, status: 201 }; }, true);

  // Consentimiento del correo (revisión de Harvey): sin la casilla no se guarda nada ni se manda código.
  const pre = { g: (db.tables.seller_guests ?? []).length, m: mails.length };
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h } });
  t.check('sin consentimiento -> 400 consent_required, sin correo ni identidad guardada', r.code === 400 && r.body?.code === 'consent_required' && mails.length === pre.m && (db.tables.seller_guests ?? []).length === pre.g, `${r.code} ${r.body?.code}`);
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, consent: false, consent_version: SELLER_GUEST_CONSENT_VERSION } });
  t.check('consent:false -> 400 consent_required', r.code === 400 && r.body?.code === 'consent_required' && mails.length === pre.m);
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, consent: true, consent_version: 'vendedor-correo-v0' } });
  t.check('texto de consentimiento viejo -> 409 consent_outdated', r.code === 409 && r.body?.code === 'consent_outdated' && mails.length === pre.m);
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_recover_request', code, email: 'vende@ejemplo.com' } });
  t.check('recuperar sin consentimiento -> 400 consent_required', r.code === 400 && r.body?.code === 'consent_required');

  // Pedir código.
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'Vende@Ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  const ch1 = r.body?.challenge_id as string;
  t.check('vendedor sin cuenta pide el código: correo enviado, respuesta enmascarada', r.code === 200 && !!ch1 && /^v•+@ejemplo\.com$/.test(r.body?.sent_to) && mails.length === 1 && mails[0].to === 'vende@ejemplo.com' && mails[0].text.includes(SELLER_GUEST_BETA), JSON.stringify(r.body));
  const code1 = lastCode();
  const g = db.tables.seller_guests[0], c1 = db.tables.seller_otp_challenges[0];
  t.check('no se guarda el correo ni el código en claro (HMAC + pii:v1)', !JSON.stringify(db.tables.seller_guests).includes('ejemplo.com') && /^pii:v1:/.test(g.contact_enc) && /^[a-f0-9]{64}$/.test(g.contact_hmac) && c1.otp_hash !== code1 && !JSON.stringify(c1).includes(code1));

  const cons = (db.tables.seller_guest_consents ?? [])[0];
  t.check('consentimiento guardado aparte: versión del texto, del aviso, hash del texto y fecha; el código lo referencia',
    !!cons && cons.guest_id === g.id && cons.invite_code === code && cons.purpose === 'accept' && cons.consent_version === SELLER_GUEST_CONSENT_VERSION
      && cons.notice_version === SELLER_NOTICE_VERSION && cons.consent_text_sha256 === createHash('sha256').update(SELLER_GUEST_CONSENT_TEXT).digest('hex')
      && !Number.isNaN(Date.parse(cons.consented_at)) && c1.consent_id === cons.id && !JSON.stringify(cons).includes('ejemplo.com'), JSON.stringify(cons));

  // Fuerza bruta: 5 intentos por código.
  const accept = (otp: string, chId = ch1, extra: any = {}, cookie?: string) => call(invites, { guest: SELLER_KEY, cookie, body: { op: 'seller_accept', code, challenge_id: chId, otp, delivery_mode: 'envio', agreement_hash: h, ...extra } });
  const wrong = code1 === '000000' ? '111111' : '000000';
  r = await accept(wrong);
  t.check('código equivocado -> 401 con intentos restantes', r.code === 401 && r.body?.code === 'bad_code' && r.body?.attempts_left === 4, `${r.code} ${JSON.stringify(r.body)}`);
  for (let i = 0; i < 4; i++) await accept(wrong);
  r = await accept(code1);
  t.check('tras 5 intentos el código queda bloqueado aunque sea el correcto -> 429', r.code === 429 && r.body?.code === 'too_many_attempts' && db.tables.orders.length === 0, `${r.code} ${r.body?.code}`);

  // Vencido.
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  const ch2 = r.body.challenge_id; const code2 = lastCode();
  db.tables.seller_otp_challenges.find((c: any) => c.id === ch2).expires_at = new Date(Date.now() - 1000).toISOString();
  r = await accept(code2, ch2);
  t.check('código vencido -> 410', r.code === 410 && r.body?.code === 'challenge_expired', `${r.code}`);

  // Cambio de precio después de pedir el código -> invalida.
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  const ch3 = r.body.challenge_id; const code3 = lastCode();
  inv0.price_crc = 130000;
  r = await accept(code3, ch3);
  t.check('precio cambió después del código -> 409 agreement_changed y sin pedido', r.code === 409 && r.body?.code === 'agreement_changed' && db.tables.orders.length === 0, `${r.code} ${r.body?.code}`);
  inv0.price_crc = 120000;

  // Platform sin trustline bloquea antes de aceptar.
  r = await call(invites, { guest: SELLER_KEY, body: { op: 'seller_otp_request', code, email: 'vende@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  const ch4 = r.body.challenge_id; const code4 = lastCode();
  platformReady = false;
  r = await accept(code4, ch4);
  t.check('receiver platform sin trustline -> 503 antes de aceptar', r.code === 503 && r.body?.code === 'platform_not_ready' && db.tables.orders.length === 0, `${r.code} ${r.body?.code}`);
  platformReady = true;

  // Sin schema (038 sin aplicar): no se crea nada.
  db.noRpc = true;
  r = await accept(code4, ch4);
  t.check('sin la migración 038 -> 503 y sin pedido', r.code === 503 && db.tables.orders.length === 0, `${r.code} ${r.body?.code}`);
  db.noRpc = false;

  // Aceptar.
  r = await accept(code4, ch4);
  const slug = r.body?.slug as string; const ck = cookieOf(r);
  const setCookie = String(r.headers['set-cookie'] ?? '');
  t.check('acepta: pedido + cookie HttpOnly Secure SameSite Path=/api del pedido', r.code === 200 && !!slug && ck.startsWith(`mss_${slug}=`) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Path=\/api/.test(setCookie), `${r.code} ${r.body?.error} ${setCookie}`);
  const o = db.tables.orders[0];
  t.check('pedido: principal no-Cavos, SP backend, cobro platform/iban, reglas versionadas', o?.seller_user_id === `seller_guest:${g.id}` && o.seller_auth_kind === 'guest' && o.seller_address === SP.publicKey() && o.payout_method === 'iban' && o.payout_address === PLATFORM && o.rules_version >= 3 && o.delivery_mode === 'envio');
  const acc = db.tables.seller_acceptances[0];
  t.check('aceptación inmutable: hash del acuerdo + snapshot IBAN de ejemplo (nunca un IBAN real)', acc?.agreement_hash === h && acc.payout_snapshot.iban === IBAN_PLACEHOLDER && acc.payout_snapshot.simulated === true && acc.payout_snapshot.receiver === PLATFORM);
  t.check('sesión: solo el hash del token en la base', db.tables.seller_guest_sessions.length === 1 && db.tables.seller_guest_sessions[0].token_hash === tokenHash(ck.split('=')[1]) && !JSON.stringify(db.tables.seller_guest_sessions).includes(ck.split('=')[1]));
  r = await accept(code4, ch4);
  t.check('código reusado -> 409 (o invitación ya aceptada) y un solo pedido', (r.code === 409) && db.tables.orders.length === 1, `${r.code} ${r.body?.code}`);
  r = await call(invites, { guest: OTHER_KEY, body: { op: 'seller_otp_request', code, email: 'otro@ejemplo.com', delivery_mode: 'envio', agreement_hash: h, ...CONSENT } });
  t.check('otra persona con el link ya aceptado -> 409 invite_not_open', r.code === 409 && r.body?.code === 'invite_not_open', `${r.code}`);

  // Vista pública vs. del vendedor.
  r = await call(invites, { method: 'GET', query: { code }, guest: OTHER_KEY });
  const pub = JSON.stringify(r.body);
  t.check('link reenviado (sin sesión): sin panel de venta, sin PII/hash/sesión', r.body?.seller_order == null && r.body?.seller_guest?.order_is_guest === true && !pub.includes('ejemplo.com') && !pub.includes(g.id) && !pub.includes('otp') && !pub.includes(IBAN_PLACEHOLDER), pub);
  r = await call(invites, { method: 'GET', query: { code }, cookie: ck });
  t.check('con su sesión: panel de la venta, sin "fondos en custodia" antes de pagar', r.body?.seller_order?.slug === slug && r.body.seller_order.funds_in_custody === false, JSON.stringify(r.body?.seller_order));

  // Fondos en custodia solo con depósito confirmado.
  t.check('escrow_creado / XDR pendiente -> sin fondos en custodia', sellerOrderView({ ...o, status: 'escrow_creado', contract_id: 'C' }).funds_in_custody === false);
  t.check('fondeado sin funded_tx -> sin fondos en custodia', sellerOrderView({ ...o, status: 'fondeado', funded_tx: null }).funds_in_custody === false);
  t.check('fondeado con depósito verificado -> fondos en custodia', sellerOrderView({ ...o, status: 'fondeado', funded_tx: 'abc' }).funds_in_custody === true);

  // Link reenviado no autoriza envío ni PIN.
  o.status = 'fondeado'; o.funded_tx = 'abc'; o.contract_id = 'CABC'; o.sp_mode = 'backend';
  r = await call(ship, { guest: OTHER_KEY, body: { slug, evidence: {} } });
  t.check('"Ya lo envié" sin sesión del vendedor -> 401 seller_session_required', r.code === 401 && r.body?.code === 'seller_session_required', `${r.code} ${r.body?.code}`);
  r = await call(ship, { tok: await token({ sub: 'otro-cavos' }), body: { slug, evidence: {} } });
  t.check('una cuenta Cavos cualquiera tampoco -> 401', r.code === 401, `${r.code}`);
  r = await call(confirm, { guest: OTHER_KEY, body: { slug, reason: 'pin', pin: '123456' } });
  t.check('PIN sin sesión del vendedor -> 401', r.code === 401, `${r.code}`);
  r = await call(ship, { cookie: ck, body: { slug, evidence: {} } });
  t.check('con su sesión pasa la autorización (pide la foto de la cámara)', r.code === 400 && r.body?.code === 'ship_photo_required', `${r.code} ${r.body?.code}`);
  r = await call(upload, { cookie: ck, body: { action: 'capture_token', purpose: 'ship', ref: slug } });
  t.check('token de cámara para el envío con la sesión del pedido', r.code === 200 && r.body?.purpose === 'ship' && !!r.body?.token, `${r.code} ${r.body?.error}`);
  r = await call(upload, { guest: OTHER_KEY, body: { action: 'capture_token', purpose: 'ship', ref: slug } });
  t.check('token de cámara sin sesión -> 401', r.code === 401, `${r.code}`);
  const wrongCookie = `mss_${slug}=${'A'.repeat(43)}`;
  r = await call(ship, { cookie: wrongCookie, body: { slug, evidence: {} } });
  t.check('cookie falsa -> 401', r.code === 401, `${r.code}`);
  o.status = 'creado'; delete o.funded_tx; delete o.contract_id;

  // Recuperar sesión revoca la anterior.
  r = await call(invites, { guest: OTHER_KEY, body: { op: 'seller_recover_request', code, email: 'intruso@ejemplo.com', ...CONSENT } });
  const before = mails.length;
  t.check('recuperar con otro correo: misma respuesta, sin correo', r.code === 200 && r.body?.sent === true && typeof r.body?.challenge_id === 'string' && mails.length === before);
  r = await call(invites, { guest: OTHER_KEY, body: { op: 'seller_recover_request', code, email: 'vende@ejemplo.com', ...CONSENT } });
  const rch = r.body.challenge_id; const rcode = lastCode();
  r = await call(invites, { body: { op: 'seller_recover_verify', code, challenge_id: rch, otp: rcode } });
  const ck2 = cookieOf(r);
  t.check('recupera con el correo de la venta: sesión nueva', r.code === 200 && ck2.startsWith(`mss_${slug}=`) && ck2 !== ck, `${r.code} ${r.body?.error}`);
  r = await call(invites, { method: 'GET', query: { code }, cookie: ck });
  const r2 = await call(invites, { method: 'GET', query: { code }, cookie: ck2 });
  t.check('la sesión anterior quedó revocada; la nueva sirve', r.body?.seller_order == null && r2.body?.seller_order?.slug === slug);

  // Custodia: flag, aceptación, destino. Nunca Cavos.
  t.check('serviceProvider = backend aunque SERVICE_PROVIDER_MODE=seller', env.spMode() === 'seller' && serviceProviderFor(o) === SP.publicKey());
  process.env.SELLER_GUEST_ENABLED = '';
  r = await call(pay, { guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }), body: { slug, step: 'start' } });
  t.check('flag apagado: pagar -> 503 seller_guest_disabled (sin escrow)', r.code === 503 && r.body?.code === 'seller_guest_disabled' && !o.contract_id, `${r.code} ${r.body?.code}`);
  r = await call(pay, { guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }), body: { slug, step: 'confirm_sinpe' } });
  t.check('flag apagado: confirm_sinpe también -> 503', r.code === 503, `${r.code}`);
  r = await call(pay, { guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }), body: { slug, step: 'card_pay' } });
  t.check('flag apagado: tarjeta también -> 503', r.code === 503, `${r.code}`);
  r = await call(pay, { guest: BUYER_KEY, tok: await token({ sub: 'cavos-buyer-1' }), body: { slug, step: 'crypto_quote', asset: 'USDC' } });
  t.check('flag apagado: cripto también -> 503', r.code === 503, `${r.code}`);
  process.env.SELLER_GUEST_ENABLED = '1';
  const savedAcc = db.tables.seller_acceptances.splice(0, 1);
  let e1: any = null; try { await guestPayee(o); } catch (e) { e1 = e; }
  t.check('sin aceptación -> 409 seller_not_accepted', e1?.code === 'seller_not_accepted');
  db.tables.seller_acceptances.push(...savedAcc);
  const evil = { ...o, payout_address: Keypair.random().publicKey() };
  let e2: any = null; try { await guestPayee(evil); } catch (e) { e2 = e; }
  t.check('destino distinto al aceptado -> 409 payout_mismatch (no cae a Cavos)', e2?.code === 'payout_mismatch');
  const ok = await guestPayee(o);
  t.check('con aceptación válida: receiver = platform, ruta iban', ok.address === PLATFORM && ok.route === 'iban');
  o.status = 'escrow_creado'; o.contract_id = 'CABC'; o.amount_usdc = 236;
  savedAcc.length = 0; db.tables.seller_acceptances.length = 0;
  let e3: any = null; try { await mockRampFund(o.id); } catch (e) { e3 = e; }
  t.check('fondeo (mockRampFund: SINPE/tarjeta/cripto) sin aceptación -> rechazado antes de tomar el lock', e3?.code === 'seller_not_accepted' && !(db.tables.ramp_mock_payments ?? []).length, `${e3?.code}`);
  db.tables.seller_acceptances.push(acc);
  r = await call(pay, { guest: OTHER_KEY, body: { slug, step: 'start' } });
  t.check('otro invitado debe entrar para intentar pagar el link reservado', r.code === 401, `${r.code} ${r.body?.code}`);

  // Cola IBAN simulada, idempotente, con el principal no-Cavos.
  o.status = 'liberado';
  await enqueueIbanPayout(o, { amountUsdc: 235.29, amountCrc: 120000, tx: 'rel1' });
  await enqueueIbanPayout(o, { amountUsdc: 235.29, amountCrc: 120000, tx: 'rel1' });
  const q = db.tables.payout_queue ?? [];
  t.check('cola IBAN: una fila, seller_sub = seller_guest:<uuid>, IBAN de ejemplo', q.length === 1 && q[0].seller_sub === o.seller_user_id && q[0].iban === IBAN_PLACEHOLDER);

  // Cambio de acuerdo -> hash distinto.
  const a1 = agreementFor({ ...inv0, price_crc: 120000 }, 'envio').hash, a2 = agreementFor({ ...inv0, price_crc: 120001 }, 'envio').hash, a3 = agreementFor({ ...inv0, photos: ['x'] }, 'envio').hash;
  t.check('hash del acuerdo cambia con precio, fotos o entrega', a1 !== a2 && a1 !== a3 && a1 !== agreementFor(inv0, 'cara_a_cara').hash);
  t.check('el hash no depende del orden de claves (estable)', agreementFor({ model: inv0.model, brand: inv0.brand, code: inv0.code, price_crc: 120000, photos: [] }, 'envio').hash === agreementFor({ code: inv0.code, brand: inv0.brand, model: inv0.model, price_crc: 120000, photos: [] }, 'envio').hash);
  // Retención: op admin seller_guest_purge (solo admin; pg_cron la corre cada día con 90 días).
  r = await call(invites, { tok: await token({ sub: 'no-admin' }), body: { op: 'seller_guest_purge' } });
  t.check('purga: quien no es admin -> 404 (no se revela)', r.code === 404 && !(db.purgeCalls ?? []).length, `${r.code}`);
  r = await call(invites, { guest: OTHER_KEY, body: { op: 'seller_guest_purge' } });
  t.check('purga: sin sesión -> 401', r.code === 401 && !(db.purgeCalls ?? []).length, `${r.code}`);
  const adm = await token({ sub: 'admin-1', email: 'bobbyaliensshop@gmail.com', emailVerified: true });
  r = await call(invites, { tok: adm, body: { op: 'seller_guest_purge' } });
  t.check('purga admin: RPC con 90 días y sin vendedor puntual', r.code === 200 && db.purgeCalls?.[0]?.p_days === 90 && db.purgeCalls?.[0]?.p_guest === null, JSON.stringify(db.purgeCalls));
  r = await call(invites, { tok: adm, body: { op: 'seller_guest_purge', email: 'VENDE@ejemplo.com' } });
  t.check('purga admin a pedido: busca por HMAC del correo y disocia solo a ese vendedor', r.code === 200 && db.purgeCalls?.[1]?.p_guest === g.id && db.purgeCalls?.[1]?.p_days === 0 && r.body?.found === true, JSON.stringify(r.body));
  void createHash;
}
