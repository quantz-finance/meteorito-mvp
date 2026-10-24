// (85) Comprador sin cuenta: avisos por WhatsApp / correo / cuenta y recuperación del acceso.
//  - Consentimiento obligatorio con versión; teléfono E.164 (+506 por defecto) y correo validados; nunca al vendedor.
//  - Link de acceso firmado (HMAC) y con vencimiento -> permiso SOLO para ese pedido (X-Order-Access); sin la 028 funciona.
//  - Cuenta Cavos: vincula la llave del dispositivo; Mis compras de la cuenta incluye la compra; el dispositivo la sigue viendo.
//  - Avisos en pagado / enviado / por liberar / liberado / disputa: una vez por estado y canal, con tope diario, las tres vías.
//  - Sin la migración 028: available:false, contact_unavailable, sin vínculo, y el pago/advance siguen igual. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { installTestJwks, token } from './jwt';
import { __setDbForTests, advance } from '../../api/_lib/db';
import { guestSubFromReq, requireBuyerIdentity } from '../../api/_lib/guest';
import {
  __setMailerForTests, ACCESS_RESEND_MIN, NOTICE_DAILY_CAP, notifyDueSoon, pinHashOf, sendNotice, signAccess, verifyAccess, type Mail,
} from '../../api/_lib/buyerContact';
import {
  BETA_NOTICE_TEXT, buildNotice, CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION, maskEmail, maskPhone, normalizeEmail, normalizePhone, waLink,
} from '../../api/_lib/contactText';
import { BETA_NOTICE } from '../../lib/rules';
import { pinHash } from '../../api/_lib/escrow';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const BANNED = /\b(segur[oa]s?|garant[ií]as?|verificad[oa]s?|empresas?|fintech|bancos?|billeteras?)\b|proteg/i;
const call = async (o: { body?: any; guest?: string; tok?: string; access?: string }) => {
  const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.access ? { 'x-order-access': o.access } : {}) }, body: o.body ?? {}, query: {} }, r);
  return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  process.env.PIN_PEPPER = 'pepper-ci'; delete process.env.ORDER_ACCESS_SECRET; process.env.APP_URL = 'https://pago.meteorito.app';
  const sent: Mail[] = []; __setMailerForTests(async (m) => { sent.push(m); return { ok: true, status: 201 }; }, true);
  const guestA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;

  // ---- Validación y textos ----
  t.check('teléfono: +506 por defecto, 8 dígitos; otros países E.164', normalizePhone('+506', '8888 7777') === '+50688887777' && normalizePhone('506', '2222-3333') === '+50622223333'
    && normalizePhone('+506', '1234567') === null && normalizePhone('+506', '98887777') === null && normalizePhone('+1', '415 555 2671') === '+14155552671'
    && normalizePhone('+52', '55 1234 5678') === '+525512345678' && normalizePhone('+0', '88887777') === null && normalizePhone('+506', '+506 8888 7777') === '+50688887777');
  t.check('correo validado y en minúsculas', normalizeEmail(' Ana@Correo.CR ') === 'ana@correo.cr' && normalizeEmail('ana@') === null && normalizeEmail('a b@c.co') === null);
  t.check('enmascarado (comprador): sin el número ni el correo completos', maskPhone('+50688887777') === '+506 •••• 7777' && maskEmail('ana@correo.cr') === 'a••@correo.cr');
  t.check('aviso de beta del servidor = BETA_NOTICE', BETA_NOTICE_TEXT === BETA_NOTICE);
  const kinds = ['acceso', 'pagado', 'enviado', 'por_liberar', 'liberado', 'disputa', 'resuelto'] as const;
  const notices = kinds.map((k) => buildNotice(k, { slug: 'abc123', brand: 'Apple', model: 'iPhone 13' }, 'https://pago.meteorito.app/p/abc123?acceso=x', BETA_NOTICE_TEXT));
  t.check('cada aviso trae las tres vías (link con acceso, WhatsApp, cuenta) y el aviso de beta',
    notices.every((n) => n.text.includes('?acceso=x') && /Por WhatsApp/.test(n.text) && /Crear cuenta/.test(n.text) && n.text.includes(BETA_NOTICE) && n.html.includes('Abrir mi compra')));
  t.check('WhatsApp: link de acceso y cuenta en el mismo mensaje', notices.every((n) => n.whatsapp.includes('?acceso=x') && /crear una cuenta/.test(n.whatsapp)));
  const visible = [CONTACT_CONSENT_TEXT, ...notices.flatMap((n) => [n.subject, n.text.replace(BETA_NOTICE, ''), n.whatsapp])].join('\n');
  t.check('copy sin palabras vetadas ni emojis, con tuteo', !BANNED.test(visible) && !/\p{Extended_Pictographic}/u.test(visible) && !/\b(vos|podés|tenés|querés)\b/i.test(visible));
  t.check('wa.me con el texto listo', waLink('+50688887777', 'Hola qué tal') === 'https://wa.me/50688887777?text=Hola%20qu%C3%A9%20tal');

  // ---- Tokens ----
  const link = signAccess('link', 'abc123', guestA);
  t.check('link firmado: válido, de su tipo, ligado a slug + comprador', verifyAccess(link, 'link')?.s === 'abc123' && verifyAccess(link, 'link')?.b === guestA && verifyAccess(link, 'grant') === null);
  const [v, body, sig] = link.split('.');
  const forged = `${v}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), s: 'zzz999' })).toString('base64url')}.${sig}`;
  t.check('link alterado o con otra llave: rechazado', verifyAccess(forged, 'link') === null && (() => { process.env.ORDER_ACCESS_SECRET = 'otra'; const r = verifyAccess(link, 'link'); delete process.env.ORDER_ACCESS_SECRET; return r === null; })());
  t.check('link vencido (7 días): rechazado', verifyAccess(signAccess('link', 'abc123', guestA, Date.now() - 8 * 86_400_000), 'link') === null
    && verifyAccess(signAccess('link', 'abc123', guestA, Date.now() - 6 * 86_400_000), 'link') !== null);
  t.check('mismo hash de PIN que escrow.ts', pinHashOf('o1', '123456') === pinHash('o1', '123456'));

  // ---- Sin la migración 028 ----
  const noMig = fakeDb(); const missing = { code: 'PGRST205', message: "Could not find the table 'public.buyer_contacts' in the schema cache" };
  const origFrom = noMig.from; (noMig as any).from = (tb: string) => (/^buyer_/.test(tb) ? new Proxy({}, { get: (_, k) => (k === 'then' ? (ok: any) => ok({ data: null, error: missing }) : () => (noMig as any).from(tb)) }) : origFrom(tb));
  __setDbForTests(noMig as any);
  const order0 = { id: 'o0', slug: 'abc123', status: 'fondeado', buyer_user_id: guestA, seller_user_id: 'seller1', brand: 'Apple', model: 'iPhone 13', price_crc: 100000 };
  noMig.tables.orders.push({ ...order0 });
  let r = await call({ guest: KEY_A, body: { action: 'buyer_contact_get', slug: 'abc123' } });
  t.check('sin 028: available:false (la tarjeta no aparece)', r.code === 200 && r.body.available === false, JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'email', email: 'ana@correo.cr', consent: true, consent_version: CONTACT_CONSENT_VERSION } });
  t.check('sin 028: guardar -> 503 contact_unavailable', r.code === 503 && r.body.code === 'contact_unavailable');
  r = await call({ guest: KEY_B, body: { action: 'buyer_access_redeem', slug: 'abc123', token: signAccess('link', 'abc123', guestA) } });
  const grant0 = r.body.grant;
  t.check('sin 028: el link de acceso SÍ funciona (otro dispositivo)', r.code === 200 && verifyAccess(grant0, 'grant')?.s === 'abc123');
  r = await call({ guest: KEY_B, access: grant0, body: { action: 'seller_contact', slug: 'abc123' } });
  t.check('sin 028: con el permiso, el otro dispositivo actúa como comprador de ESE pedido', r.code === 200, JSON.stringify(r.body));
  let threw = false; try { await advance('o0', 'fondeado', { status: 'enviado' }); } catch { threw = true; }
  t.check('sin 028: cambiar de estado sigue funcionando (avisos best-effort)', !threw && noMig.tables.orders[0].status === 'enviado');

  // ---- Con 028 ----
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.buyer_contacts = []; db.tables.buyer_links = []; db.tables.buyer_notifications = [];
  db.tables.orders.push({ ...order0 }, { id: 'o2', slug: 'xyz789', status: 'fondeado', buyer_user_id: guestA, seller_user_id: 'seller1', brand: '', model: 'Bici', price_crc: 50000 });
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_get', slug: 'abc123' } });
  t.check('con 028: available:true sin contactos', r.code === 200 && r.body.available === true && r.body.contacts.length === 0);
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'whatsapp', cc: '+506', phone: '8888 7777' } });
  t.check('sin casilla marcada: 400 consent_required', r.code === 400 && r.body.code === 'consent_required');
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'whatsapp', cc: '+506', phone: '8888 7777', consent: true, consent_version: 'viejo' } });
  t.check('versión de texto vieja: 409 consent_outdated', r.code === 409 && r.body.code === 'consent_outdated');
  r = await call({ guest: KEY_B, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'whatsapp', cc: '+506', phone: '8888 7777', consent: true, consent_version: CONTACT_CONSENT_VERSION } });
  t.check('otro dispositivo sin acceso: 403', r.code === 403);
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'whatsapp', cc: '+506', phone: '1234', consent: true, consent_version: CONTACT_CONSENT_VERSION } });
  t.check('número inválido: 400 bad_phone', r.code === 400 && r.body.code === 'bad_phone');
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'whatsapp', cc: '+506', phone: '8888 7777', consent: true, consent_version: CONTACT_CONSENT_VERSION } });
  const wa = db.tables.buyer_contacts.find((c) => c.channel === 'whatsapp');
  t.check('WhatsApp guardado en E.164 con consentimiento y versión; respuesta enmascarada', r.code === 200 && r.body.contact.masked === '+506 •••• 7777'
    && wa?.phone_e164 === '+50688887777' && wa?.consent_text === CONTACT_CONSENT_TEXT && wa?.consent_text_version === CONTACT_CONSENT_VERSION && !!wa?.consent_at && !JSON.stringify(r.body).includes('88887777'));
  sent.length = 0;
  r = await call({ guest: KEY_A, body: { action: 'buyer_contact_save', slug: 'abc123', channel: 'email', email: 'Ana@Correo.cr', consent: true, consent_version: CONTACT_CONSENT_VERSION } });
  t.check('correo guardado -> se envía el link de acceso al instante', r.code === 200 && r.body.emailed === true && sent.length === 1 && sent[0].to === 'ana@correo.cr' && /\/p\/abc123\?acceso=v1\./.test(sent[0].text));
  const mailed = sent[0].text.match(/\?acceso=(v1\.[\w.-]+)/)![1];
  t.check('el link del correo abre la compra (link firmado de 7 días)', verifyAccess(mailed, 'link')?.s === 'abc123');

  // Privacidad: el vendedor nunca ve teléfono ni correo.
  const sellerTok = await token({ sub: 'seller1' });
  r = await call({ tok: sellerTok, body: { action: 'buyer_contact_get', slug: 'abc123' } });
  t.check('vendedor: 403 al pedir los contactos del comprador', r.code === 403);
  r = await call({ tok: sellerTok, body: { action: 'admin_contacts', slug: 'abc123' } });
  t.check('vendedor (no admin): 403 en admin_contacts', r.code === 403 && r.body.code === 'not_admin');
  const src = ['api/_lib/feed.ts', 'api/_lib/purchases.ts', 'api/_lib/chat.ts', 'api/_lib/push.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
  t.check('ninguna respuesta al vendedor lee buyer_contacts', !/buyer_contacts/.test(src));
  process.env.ADMIN_EMAILS = 'team@ci.test';
  r = await call({ tok: await token({ sub: 'team' }), body: { action: 'admin_contacts', slug: 'abc123' } });
  t.check('equipo (ADMIN_EMAILS): contactos + wa.me listo con el link de acceso', r.code === 200 && r.body.contacts.some((c: any) => c.channel === 'whatsapp' && /^https:\/\/wa\.me\/50688887777\?text=/.test(c.wa_link) && decodeURIComponent(c.wa_link).includes('?acceso=v1.')));

  // Redeem en otro dispositivo (KEY_B) y PIN nuevo
  r = await call({ guest: KEY_B, body: { action: 'buyer_access_redeem', slug: 'xyz789', token: mailed } });
  t.check('link de otra compra: 403 access_invalid', r.code === 403 && r.body.code === 'access_invalid');
  r = await call({ guest: KEY_B, body: { action: 'buyer_access_redeem', slug: 'abc123', token: mailed } });
  const grant = r.body.grant;
  t.check('otro dispositivo: el link deja un permiso de 120 días', r.code === 200 && (verifyAccess(grant, 'grant')!.e * 1000 - Date.now()) > 100 * 86_400_000);
  r = await call({ guest: KEY_B, access: grant, body: { action: 'buyer_contact_get', slug: 'xyz789' } });
  t.check('el permiso NO sirve para otra compra del mismo comprador', r.code === 403);
  r = await call({ guest: KEY_B, access: grant, body: { action: 'buyer_orders' } });
  t.check('el permiso no abre Mis compras completo del comprador original', r.code === 200 && r.body.orders.length === 0);
  const before = db.tables.orders[0].delivery_pin_hash;
  r = await call({ guest: KEY_B, access: grant, body: { action: 'buyer_pin_reissue', slug: 'abc123' } });
  t.check('código de entrega nuevo en el dispositivo recuperado (el anterior deja de servir)', r.code === 200 && /^\d{6}$/.test(r.body.pin)
    && db.tables.orders[0].delivery_pin_hash === pinHash('o0', r.body.pin) && db.tables.orders[0].delivery_pin_hash !== before && db.tables.order_events.some((e) => e.kind === 'pin_reissued'));
  sent.length = 0;
  r = await call({ guest: KEY_B, body: { action: 'buyer_access_request', slug: 'abc123', email: 'nadie@correo.cr' } });
  const r2 = await call({ guest: KEY_B, body: { action: 'buyer_access_request', slug: 'abc123', email: 'ana@correo.cr' } });
  t.check('pedir link en otro dispositivo: misma respuesta siempre; solo se envía al correo guardado (y respeta 10 min)',
    r.code === 200 && r2.code === 200 && JSON.stringify(r.body) === JSON.stringify(r2.body) && sent.length === 0 /* acceso ya enviado en estos 10 min */);

  // Cuenta: vincular la llave con la cuenta
  const acct = await token({ sub: 'acct1' });
  r = await call({ guest: KEY_A, tok: acct, body: { action: 'buyer_link_account', slug: 'abc123', consent: true, consent_version: CONTACT_CONSENT_VERSION } });
  t.check('crear cuenta: vincula la llave de este dispositivo y guarda el canal cuenta', r.code === 200 && r.body.linked === true
    && db.tables.buyer_links.some((l) => l.guest_sub === guestA && l.account_sub === 'acct1') && db.tables.buyer_contacts.some((c) => c.channel === 'account' && c.account_sub === 'acct1'));
  r = await call({ tok: acct, body: { action: 'buyer_orders' } });
  t.check('la cuenta (en cualquier teléfono) ve las compras del invitado', r.code === 200 && r.body.orders.map((o: any) => o.slug).sort().join() === 'abc123,xyz789');
  r = await call({ guest: KEY_A, body: { action: 'buyer_orders' } });
  t.check('y el dispositivo las sigue viendo con su llave', r.code === 200 && r.body.orders.length === 2);
  const who = await requireBuyerIdentity({ headers: { authorization: `Bearer ${acct}` }, body: {} });
  t.check('requireBuyerIdentity: la cuenta actúa como el invitado vinculado', who.ids.includes(guestA) && who.ids.includes('acct1'));
  r = await call({ tok: acct, body: { action: 'buyer_link_account' } });
  t.check('vincular sin llave de invitado: linked:false (nada que unir)', r.code === 200 && r.body.linked === false);

  // ---- Avisos ----
  sent.length = 0; db.tables.buyer_notifications = [];
  await advance('o0', 'fondeado', { status: 'enviado' });
  const kindsSent = () => db.tables.buyer_notifications.map((n) => `${n.channel}:${n.kind}:${n.status}`).sort();
  t.check('enviado: correo + cuenta por correo, WhatsApp queda para el equipo', sent.length === 2 && sent.every((m) => /va en camino/.test(m.subject))
    && kindsSent().join() === 'account:enviado:sent,email:enviado:sent,whatsapp:enviado:pending_manual', kindsSent().join());
  db.tables.orders[0].status = 'fondeado';
  await advance('o0', 'fondeado', { status: 'enviado' });
  t.check('mismo estado dos veces: no se repite', sent.length === 2);
  db.tables.orders[0].auto_release_at = new Date(Date.now() + 3 * 3600_000).toISOString();
  await notifyDueSoon(db as any); await notifyDueSoon(db as any);
  t.check('por liberar (<24 h): una vez por canal aunque el cron corra seguido', sent.filter((m) => /menos de 24 h/.test(m.subject)).length === 2);
  db.tables.orders[1].status = 'enviado'; db.tables.orders[1].auto_release_at = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await notifyDueSoon(db as any);
  t.check('sin contactos o plazo lejano: nada', sent.filter((m) => /menos de 24 h/.test(m.subject)).length === 2);
  db.tables.orders[0].status = 'enviado';
  await advance('o0', 'enviado', { status: 'en_disputa' });
  t.check('disputa: avisa', sent.some((m) => /Recibimos tu reporte/.test(m.subject)));
  db.tables.orders[0].status = 'entregado';
  await advance('o0', 'entregado', { status: 'liberado' });
  t.check('liberado: avisa', sent.some((m) => /Compra completada/.test(m.subject)));
  // Tope diario
  const now = Date.now(); const o = { ...db.tables.orders[0] };
  for (let i = 0; i < NOTICE_DAILY_CAP + 3; i++) await sendNotice(db as any, o, 'acceso', { only: 'email', now: now + i * (ACCESS_RESEND_MIN + 1) * 60_000 });
  t.check(`tope: máx. ${NOTICE_DAILY_CAP} avisos por canal en 24 h`, db.tables.buyer_notifications.filter((n) => n.channel === 'email').length <= NOTICE_DAILY_CAP);
  // Proveedor apagado
  __setMailerForTests(async (m) => { sent.push(m); return { ok: true, status: 201 }; }, false); sent.length = 0;
  db.tables.orders[0].status = 'liberado';
  await advance('o0', 'liberado', { status: 'resuelto' });
  t.check('sin proveedor de correo (flag apagado): no envía, queda registrado como skipped', sent.length === 0 && db.tables.buyer_notifications.some((n) => n.kind === 'resuelto' && n.status === 'skipped'));
  __setMailerForTests(null);

  // ---- UI y legal ----
  const card = readFileSync('components/ContactCard.tsx', 'utf8'); const page = readFileSync('app/p/[slug].tsx', 'utf8'); const legal = readFileSync('lib/legal.ts', 'utf8');
  t.check("tarjeta: título y las tres opciones", card.includes("'Recibe avisos de tu compra'") && /'WhatsApp'/.test(card) && /'Correo'/.test(card) && /'Crear cuenta'/.test(card));
  t.check('tarjeta: +506 por defecto, inputs de 16 px, casilla de consentimiento y "Ahora no"', card.includes('DEFAULT_COUNTRY_CODE') && /fontSize: 16/.test(card) && /accessibilityRole="checkbox"/.test(card) && /label="Ahora no"/.test(card));
  t.check('tarjeta: sin navegación (no router) y login sobre la misma URL', !/router\./.test(card) && /auth\.openLogin\(\)/.test(card) && /markLinkPending/.test(card));
  t.check('página: el token ?acceso= se quita de la URL tras usarlo', /setParams\(\{ acceso: undefined \}/.test(page));
  t.check('privacidad: línea nueva marcada REVISIÓN LEGAL (Neo)', /REVISIÓN LEGAL \(Neo\): línea NUEVA de avisos al comprador/.test(legal) && /No se los mostramos al vendedor/.test(legal));
  const sql = readFileSync('supabase/migrations/028_guest_contact.sql', 'utf8');
  t.check('028 idempotente y sin grants públicos', /create table if not exists public\.buyer_contacts/.test(sql) && /create table if not exists public\.buyer_links/.test(sql)
    && /create table if not exists public\.buyer_notifications/.test(sql) && /revoke all on public\.buyer_contacts from anon, authenticated/.test(sql) && !/create table (?!if not exists)/.test(sql)
    && createHash('sha256').update(sql).digest('hex').length === 64);
}
