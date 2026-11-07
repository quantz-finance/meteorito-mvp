// (116) Privacidad del vendedor sin cuenta (revisión de Harvey sobre #155):
//  - Migración 039 en Postgres (PGlite): consentimiento aparte e inmutable; retención seller_guest_purge (90 días después de
//    cerrar la venta o del último código; nunca con una venta abierta o un reclamo sin resolver; a pedido con p_guest).
//  - Aviso de privacidad /legal/vendedor (responsable, dirección/contacto, finalidades, obligatorio, proveedores, derechos,
//    retención), casilla NO marcada que exige el botón del código y el link al aviso ANTES del botón.
//  - Excepción visible (serviceProvider backend, wallet de la plataforma, cobro simulado) en el flujo y en los legales.
//  - Copy sin palabras prohibidas.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { MIGRATIONS_DIR, STUBS, migrationOrder } from './t115-vendedor-sin-cuenta-sql.test';
import { BANNED_COPY } from '../../lib/copy';
import { CONTACT_EMAIL, CONTROLLER_ADDRESS, CONTROLLER_NAME, LEGAL } from '../../lib/legal';
import { SELLER_GUEST_CONSENT_TEXT, SELLER_GUEST_CUSTODY, SELLER_GUEST_EXCEPTION, SELLER_GUEST_PAYOUT, SELLER_GUEST_RETENTION_DAYS, SELLER_GUEST_VERIFY, SELLER_GUEST_RECEIPT } from '../../api/_lib/sellerGuestText';

const G = (c: string) => 'G' + c.repeat(55);
const H = (c: string) => c.repeat(64);
const EXTRA_BANNED = /proteg|antiestafa|100\s*%/i;

export async function run(t: T) {
  // ---------- Textos ----------
  t.check('casilla: texto exacto pedido', SELLER_GUEST_CONSENT_TEXT === 'Autorizo el tratamiento de mi correo para verificar acceso y registrar mi aceptación, según el aviso de privacidad. No incluye publicidad.');
  t.check('excepción: texto exacto pedido', SELLER_GUEST_EXCEPTION === 'En esta prueba, Meteorito opera el rol serviceProvider mediante su backend. Al liberarse, los tokens de prueba llegan a una wallet de la plataforma, no a la del vendedor. El cobro es simulado: no hay transferencia bancaria ni dinero real.');
  const ui = readFileSync('components/SellerGuestAccept.tsx', 'utf8');
  const statusTexts = (ui.match(/const STATUS_TEXT[\s\S]*?\n};/) ?? [''])[0];
  const notice = JSON.stringify(LEGAL.vendedor);
  const newCopy = [SELLER_GUEST_CUSTODY, SELLER_GUEST_PAYOUT, SELLER_GUEST_VERIFY, SELLER_GUEST_RECEIPT, statusTexts, notice];
  const bad = newCopy.filter((x) => BANNED_COPY.test(x) || EXTRA_BANNED.test(x.replace(/Protección de (la Persona|Datos)/g, '')));
  t.check('copy nuevo sin seguro/garantía/verificado/proteg*/empresa/fintech/banco/billetera/antiestafa/100%', bad.length === 0, bad.map((b) => b.slice(0, 80)).join(' | '));

  // ---------- Aviso de privacidad del vendedor sin cuenta ----------
  const v = LEGAL.vendedor; const all = v.sections.map((s) => s.h + ': ' + s.p.join(' ')).join('\n');
  const has = (h: RegExp) => v.sections.some((s) => h.test(s.h));
  t.check('aviso: responsable real (el de la política) + contacto existente', all.includes(CONTROLLER_NAME) && LEGAL.privacidad.sections[0].p[0].includes(CONTROLLER_NAME) && all.includes(CONTACT_EMAIL));
  t.check('aviso: dirección física = marcador pendiente visible (no inventada)', /^\[PENDIENTE: /.test(CONTROLLER_ADDRESS) && all.includes(CONTROLLER_ADDRESS));
  t.check('aviso: finalidades OTP, acceso, recuperación y registro de la aceptación; sin publicidad', /código de un solo uso \(OTP\)/.test(all) && /darte acceso/.test(all) && /recuperar ese acceso/.test(all) && /constancia de que aceptaste/.test(all) && /no los usamos para publicidad/.test(all));
  t.check('aviso: obligatorio para este camino', has(/necesario/i) && /no puedes aceptar sin cuenta/.test(all));
  t.check('aviso: proveedores y transferencias (Brevo, Supabase, Vercel; fuera de Costa Rica)', /Brevo/.test(all) && /Supabase/.test(all) && /Vercel/.test(all) && /fuera de Costa Rica/.test(all));
  t.check('aviso: derechos ARCO y revocar', /ARCO/.test(all) && /revocar/.test(all));
  t.check('aviso: sin eliminación automática; a pedido o manual, con constancias', /No eliminamos tus datos de forma automática ni agendada/.test(all) && /a pedido o por un administrador de forma manual/.test(all) && all.includes('Eliminamos el correo almacenado y sustituimos su identificador de búsqueda; conservamos las constancias indicadas.') && !/ya no se puede ligar/.test(all) && SELLER_GUEST_RETENTION_DAYS === 90);
  t.check('aviso: sin el marco Cavos/comprador', !/Cavos/.test(notice) && !/comprador/.test(notice));
  t.check('aviso con versión y fecha', !!v.version && !!v.updated);
  t.check('ruta /legal/vendedor', /doc === 'vendedor'/.test(readFileSync('app/legal/[doc].tsx', 'utf8')));

  // ---------- Excepción en legales y en el flujo ----------
  const inDoc = (d: 'privacidad' | 'terminos' | 'vendedor') => LEGAL[d].sections.some((s) => s.p.some((p) => p.includes(SELLER_GUEST_EXCEPTION)));
  t.check('excepción en privacidad, términos y aviso del vendedor', inDoc('privacidad') && inDoc('terminos') && inDoc('vendedor'));
  t.check('se mantiene la custodia hasta la liberación (términos + aviso)', LEGAL.terminos.sections.some((s) => s.p.some((p) => p.includes(SELLER_GUEST_CUSTODY))) && notice.includes(SELLER_GUEST_CUSTODY) && /no en una cuenta de Meteorito/.test(SELLER_GUEST_CUSTODY));
  t.check('flujo: la excepción se ve en "Dónde cobras" y en el panel de la venta', (ui.match(/<ExceptionBox \/>/g) ?? []).length >= 2 && /testID="seller-guest-exception"/.test(ui));

  // ---------- Casilla + link antes del botón ----------
  const form = ui.slice(ui.indexOf('testID="seller-guest-email"'), ui.indexOf('testID="seller-guest-send"'));
  t.check('link al aviso y casilla ANTES de "Enviarme el código"', form.includes('<PrivacyConsent') && /testID="seller-guest-privacy-link"/.test(ui) && ui.indexOf('function PrivacyConsent') < ui.indexOf('testID="seller-guest-send"'));
  t.check('casilla NO marcada de antemano y el botón la exige (aceptar y recuperar)', (ui.match(/const \[consent, setConsent\] = useState\(false\)/g) ?? []).length === 2
    && /testID="seller-guest-send"[^\n]*disabled=\{!consent \|\|/.test(ui) && /testID="seller-guest-recover-send"[^\n]*disabled=\{!consent \|\|/.test(ui) && /accessibilityRole="checkbox"/.test(ui));
  const lib = readFileSync('lib/sellerGuest.ts', 'utf8');
  t.check('el cliente manda consent + versión en pedir código y recuperar', (lib.match(/\.\.\.consent \}/g) ?? []).length === 2);
  const doc = readFileSync('docs/vendedor-sin-cuenta.md', 'utf8');
  t.check('docs: consentimiento, retención y excepción', doc.includes(SELLER_GUEST_EXCEPTION) && /seller_guest_purge/.test(doc) && /seller_guest_consents/.test(doc));

  // ---------- Migración 039 (PGlite) ----------
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(STUBS);
  let ok039 = false;
  for (const f of migrationOrder()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    try { await db.exec(sql); if (f.startsWith('039')) ok039 = true; } catch (e: any) { if (f.startsWith('039') || f.startsWith('038')) t.check(`${f} aplica: ${e.message}`, false); }
  }
  t.check('039 aplica después de 038 (e idempotente)', ok039 && await db.exec(readFileSync(join(MIGRATIONS_DIR, '039_seller_guest_privacy.sql'), 'utf8')).then(() => true, () => false));
  const q = async (sql: string, p: any[] = []) => (await db.query<any>(sql, p)).rows;
  const one = async (sql: string, p: any[] = []) => (await q(sql, p))[0];
  const fails = async (sql: string, p: any[] = []) => db.query(sql, p).then(() => false, () => true);
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  t.check('arreglo 038: guardar el correo cifrado (pii:v1) funciona; formato malo o demasiado largo se rechaza',
    !(await fails(`insert into seller_guests (contact_hmac, contact_enc) values ($1, $2)`, [H('0'), 'pii:v1:ci:' + 'A'.repeat(60)]))
      && await fails(`insert into seller_guests (contact_hmac, contact_enc) values ($1, $2)`, [H('7'), 'correo@ejemplo.com'])
      && await fails(`insert into seller_guests (contact_hmac, contact_enc) values ($1, $2)`, [H('8'), 'pii:v1:ci:' + 'A'.repeat(800)]));
  const codes = ['inva0001', 'invb0001', 'invc0001', 'invd0001', 'inve0001', 'invf0001'];
  for (const c of codes) await q(`insert into invitations (code, buyer_user_id, category, brand, model, price_crc, photos) values ($1, 'guest:b', 'otro', 'Trek', 'Bici', 1000, '{}')`, [c]);
  const guest = async (c: string) => (await one(`insert into seller_guests (contact_hmac, contact_enc, created_at) values ($1, $2, $3) returning id`, [H(c), 'pii:v1:ci:' + 'A'.repeat(40), ago(300)])).id;
  const gA = await guest('a'), gB = await guest('b'), gC = await guest('c'), gD = await guest('d'), gE = await guest('e'), gF = await guest('f');
  const chal = async (inv: string, g: string, when: string) => (await one(`insert into seller_otp_challenges (invite_code, guest_id, otp_hash, expires_at, created_at) values ($1, $2, $3, $4, $4) returning id`, [inv, g, H('1'), when])).id;
  const consent = async (inv: string, g: string) => (await one(`insert into seller_guest_consents (guest_id, invite_code, purpose, consent_version, notice_version, consent_text_sha256) values ($1, $2, 'accept', 'vendedor-correo-v1', 'aviso-vendedor-2026-11-07', $3) returning id`, [g, inv, H('c')])).id;
  let n = 0;
  const sale = async (inv: string, g: string, status: string, closedDaysAgo: number) => {
    const slug = 'sg' + String(++n).padStart(4, '0');
    const created = ago(closedDaysAgo + 5);
    const o = (await one(`insert into orders (slug, seller_address, seller_user_id, seller_auth_kind, seller_guest_id, category, brand, model, condition, price_crc, payout_method, payout_address, created_at)
      values ($1, $2, $3, 'guest', $4, 'otro', 'Trek', 'Bici', '', 1000, 'iban', $5, $6) returning id`, [slug, G('S'), `seller_guest:${g}`, g, G('P'), created])).id;
    await q(`update orders set status = $1, released_at = case when $1 = 'liberado' then $2::timestamptz else null end where id = $3`, [status, ago(closedDaysAgo), o]).catch(async () => {
      // Guardas de estado: forzamos el estado final sin triggers de negocio (solo para la prueba de retención).
      await db.exec(`set session_replication_role = replica`); await q(`update orders set status = $1, released_at = $2 where id = $3`, [status, ago(closedDaysAgo), o]); await db.exec(`set session_replication_role = origin`);
    });
    const c = await chal(inv, g, ago(closedDaysAgo + 5));
    await q(`insert into seller_acceptances (invite_code, order_id, guest_id, challenge_id, terms_version, agreement_hash, payout_snapshot, accepted_at) values ($1, $2, $3, $4, 3, $5, '{}'::jsonb, $6)`, [inv, o, g, c, 'sha256:' + H('9'), created]);
    await q(`insert into seller_guest_sessions (token_hash, guest_id, order_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [H(String(n)), g, o]);
    await q(`insert into order_events (order_id, kind, detail, created_at) values ($1, 'test_closed', '{}'::jsonb, $2)`, [o, ago(closedDaysAgo)]);
    return { o, c };
  };
  const sA = await sale('inva0001', gA, 'liberado', 100);     // cerrada hace 100 días -> se disocia
  await sale('invb0001', gB, 'liberado', 10);                 // cerrada hace 10 días -> se queda
  const sC = await sale('invc0001', gC, 'liberado', 100);     // reclamo abierto -> se queda
  await q(`insert into order_claims (order_id, slug, seller_user_id, buyer_sub, reason, description, counts_at) values ($1, 'x', 'y', 'z', 'otro', 'd', now())`, [sC.o]).catch((e) => t.check(`reclamo de prueba: ${e.message}`, false));
  const unusedA = await chal('inva0001', gA, ago(120));       // código sin usar viejo de A
  const cnA = await consent('inva0001', gA);
  await chal('invd0001', gD, ago(100));                       // nunca aceptó, último código hace 100 días -> se disocia
  await chal('inve0001', gE, ago(5));                         // nunca aceptó, código reciente -> se queda
  await sale('invf0001', gF, 'fondeado', 200);                // venta abierta (aunque vieja) -> nunca

  const r = (await one(`select seller_guest_purge(90) as r`)).r;
  const row = async (g: string) => one(`select contact_hmac, contact_enc, erased_at from seller_guests where id = $1`, [g]);
  const A = await row(gA), B = await row(gB), C = await row(gC), D = await row(gD), E = await row(gE), F = await row(gF);
  t.check('purga: disocia A (cerrada hace 100 d) y D (sin aceptar, último código hace 100 d)', r.erased === 2 && !!A.erased_at && A.contact_enc === null && A.contact_hmac !== H('a') && /^[a-f0-9]{64}$/.test(A.contact_hmac) && !!D.erased_at && D.contact_enc === null, JSON.stringify(r));
  t.check('purga: una identidad recién creada (aún sin código) no se toca', !(await one(`select erased_at from seller_guests where contact_hmac = $1`, [H('0')])).erased_at);
  t.check('purga: NO toca cerrada hace 10 d, reclamo abierto, código reciente ni venta abierta', [B, C, E, F].every((x) => !x.erased_at && x.contact_enc !== null));
  t.check('purga: borra sesiones y códigos sin usar; conserva el código que respalda la aceptación', (await one(`select count(*)::int n from seller_guest_sessions where guest_id = $1`, [gA])).n === 0
    && !(await one(`select 1 x from seller_otp_challenges where id = $1`, [unusedA])) && !!(await one(`select 1 x from seller_otp_challenges where id = $1`, [sA.c])));
  const acc = await one(`select * from seller_acceptances where guest_id = $1`, [gA]);
  t.check('después: aceptación y consentimiento quedan (solo hashes, versiones, fechas)', !!acc && /^sha256:/.test(acc.agreement_hash) && !!(await one(`select 1 x from seller_guest_consents where id = $1`, [cnA])));
  t.check('ya no se puede encontrar por el correo (HMAC viejo)', !(await one(`select 1 x from seller_guests where contact_hmac = $1`, [H('a')])));
  t.check('purga idempotente (segunda corrida no disocia nada)', (await one(`select seller_guest_purge(90) as r`)).r.erased === 0);
  t.check('a pedido: venta abierta -> blocked, no se disocia', (await one(`select seller_guest_purge(0, $1) as r`, [gF])).r.blocked === 1 && !(await row(gF)).erased_at);
  t.check('a pedido: venta cerrada hace 10 d -> se disocia antes de plazo', (await one(`select seller_guest_purge(0, $1) as r`, [gB])).r.erased === 1 && !!(await row(gB)).erased_at);
  t.check('consentimiento inmutable', await fails(`update seller_guest_consents set consent_version = 'x'`) && await fails(`delete from seller_guest_consents`));
  t.check('consentimiento: falla sin versión o con hash inválido', await fails(`insert into seller_guest_consents (guest_id, invite_code, purpose, consent_version, notice_version, consent_text_sha256) values ($1, 'inva0001', 'accept', '', 'v', $2)`, [gA, H('c')])
    && await fails(`insert into seller_guest_consents (guest_id, invite_code, purpose, consent_version, notice_version, consent_text_sha256) values ($1, 'inva0001', 'accept', 'v', 'v', 'xyz')`, [gA]));
  t.check('anon no ejecuta la purga; RLS encendido en consentimientos', (await one(`select has_function_privilege('anon', 'public.seller_guest_purge(integer, uuid)', 'execute') as x`)).x === false
    && (await one(`select relrowsecurity x from pg_class where relname = 'seller_guest_consents'`)).x === true);
  const noSchedule = readFileSync(join(MIGRATIONS_DIR, '040_sin_borrado_agendado.sql'), 'utf8');
  await db.exec('drop schema cron cascade'); // quitar solo el stub del motor de prueba
  await db.exec(noSchedule); // sin pg_cron instalado: no falla
  await db.exec(`create schema cron;
    create table cron.job (jobid bigint primary key, jobname text);
    create function cron.unschedule(bigint) returns boolean language sql as 'delete from cron.job where jobid = $1 returning true';
    insert into cron.job values
      (1, 'meteorito_seller_guest_retention'), (2, 'meteorito-chat-retention'),
      (3, 'meteorito_buyer_contacts_retention'), (4, 'release-24h'),
      (5, 'session-nonces-gc'), (6, 'rate-limits-gc'), (7, 'meteorito_seller_guest_retention');`);
  await db.exec(noSchedule);
  await db.exec(noSchedule); // idempotente, incluso si había nombres duplicados
  const remaining = (await q(`select jobname from cron.job order by jobid`)).map((r: any) => r.jobname);
  t.check('040: elimina solo las tres tareas de retención, idempotente; conserva tareas técnicas y pagos',
    JSON.stringify(remaining) === JSON.stringify(['release-24h', 'session-nonces-gc', 'rate-limits-gc']));
  t.check('040: sin schedule ni borrado de tablas/funciones', !/cron\.schedule\s*\(|drop\s+(?:table|function)|delete\s+from/i.test(noSchedule));
  await db.close();
}
