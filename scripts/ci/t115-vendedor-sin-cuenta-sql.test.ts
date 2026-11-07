// (115) Migración 038 en Postgres real (PGlite, en memoria, sin red): RPC seller_guest_accept / seller_guest_recover.
// Un pedido por invitación, intentos guardados aunque el código falle, vencido/reusado, acuerdo cambiado, aceptación
// inmutable, vendedor y destino de cobro inmutables, constraint guest, recuperar revoca la sesión anterior.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';

const DIR = join(__dirname, '../../supabase/migrations');
export const STUBS = `create role anon; create role authenticated; create role service_role;
create schema if not exists storage; create schema if not exists cron; create schema if not exists auth; create schema if not exists extensions;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz);
create table cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(a text, b text, c text) returns bigint language sql as 'select 1::bigint';
create function cron.unschedule(a text) returns boolean language sql as 'select true';
create function cron.unschedule(a bigint) returns boolean language sql as 'select true';
create function auth.uid() returns uuid language sql as 'select null::uuid';
create function auth.role() returns text language sql as 'select null::text';
create function auth.jwt() returns jsonb language sql as 'select null::jsonb';`;
const G = (c: string) => 'G' + c.repeat(55);
const H = (c: string) => c.repeat(64);

/** Orden de producción: 050/051 se aplicaron antes que 038 y 039 (vendedor sin cuenta), que van al final. */
const late = (f: string) => (f.startsWith('038') || f.startsWith('039') ? 1 : 0);
export const migrationOrder = () => readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort((a, b) => late(a) - late(b) || a.localeCompare(b));
export const MIGRATIONS_DIR = DIR;

export async function run(t: T) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(STUBS);
  // Supabase: 004 usa pg_cron/pg_net (no hay aquí). Lo demás se aplica en orden; 038 al final (como en producción).
  const files = migrationOrder();
  let m038 = false;
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    try { await db.exec(sql); if (f.startsWith('038')) m038 = true; }
    catch (e: any) { if (f.startsWith('038')) t.check(`038 aplica: ${e.message}`, false); }
  }
  t.check('038 aplica sobre el esquema completo (y es idempotente)', m038 && await db.exec(readFileSync(join(DIR, '038_seller_guest.sql'), 'utf8')).then(() => true, () => false));

  const q = async (sql: string, p: any[] = []) => (await db.query<any>(sql, p)).rows;
  const one = async (sql: string, p: any[] = []) => (await q(sql, p))[0];
  await q(`insert into invitations (code, buyer_user_id, category, brand, model, price_crc, photos) values ('inv00001', 'guest:b', 'otro', 'Trek', 'Bici', 120000, '{}'), ('inv00002', 'guest:b', 'otro', 'Ikea', 'Silla', 5000, '{}')`);
  const g1 = (await one(`insert into seller_guests (contact_hmac) values ($1) returning id`, [H('a')])).id;
  const g2 = (await one(`insert into seller_guests (contact_hmac) values ($1) returning id`, [H('b')])).id;
  const chal = async (inv: string, g: string, opts: { purpose?: string; exp?: string; otp?: string; ah?: string; mode?: string } = {}) =>
    (await one(`insert into seller_otp_challenges (invite_code, guest_id, purpose, otp_hash, agreement_hash, delivery_mode, expires_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [inv, g, opts.purpose ?? 'accept', opts.otp ?? H('1'), opts.purpose === 'recover' ? null : (opts.ah ?? 'sha256:' + H('9')), opts.purpose === 'recover' ? null : (opts.mode ?? 'envio'), opts.exp ?? new Date(Date.now() + 600_000).toISOString()])).id;
  const order = (price = 120000, mode = 'envio') => JSON.stringify({ seller_address: G('S'), price_crc: price, delivery_mode: mode, protection_minutes: mode === 'envio' ? 10080 : 1440 });
  const payout = JSON.stringify({ method: 'iban', simulated: true, receiver: G('P'), iban: 'CR00000000000000000000' });
  const accept = async (ch: string, o: { otp?: string; ah?: string; price?: number; mode?: string; sess?: string } = {}) =>
    (await one(`select seller_guest_accept($1, $2, $3, $4::jsonb, $5::jsonb, 3, $6, now() + interval '60 days') as r`, [ch, o.otp ?? H('1'), o.ah ?? 'sha256:' + H('9'), order(o.price, o.mode), payout, o.sess ?? H('e')])).r;

  // Código equivocado: suma el intento y queda guardado.
  const c1 = await chal('inv00001', g1);
  let r = await accept(c1, { otp: H('2') });
  const att = await one(`select attempts from seller_otp_challenges where id = $1`, [c1]);
  t.check('código equivocado -> bad_code y el intento queda guardado', r.ok === false && r.error === 'bad_code' && att.attempts === 1 && r.attempts_left === 4, JSON.stringify(r));
  for (let i = 0; i < 4; i++) await accept(c1, { otp: H('2') });
  r = await accept(c1);
  t.check('5 intentos -> too_many_attempts aunque luego sea el correcto', r.error === 'too_many_attempts');
  const cExp = await chal('inv00001', g1, { exp: new Date(Date.now() - 1000).toISOString() });
  t.check('vencido -> challenge_expired', (await accept(cExp)).error === 'challenge_expired');
  const cAg = await chal('inv00001', g1);
  t.check('hash del acuerdo distinto -> agreement_changed (y consume el código)', (await accept(cAg, { ah: 'sha256:' + H('8') })).error === 'agreement_changed' && (await accept(cAg)).error === 'challenge_used');
  const cMode = await chal('inv00001', g1);
  t.check('entrega distinta a la del código -> agreement_changed', (await accept(cMode, { mode: 'cara_a_cara' })).error === 'agreement_changed');
  const cPrice = await chal('inv00001', g1);
  t.check('precio distinto al de la invitación -> agreement_changed', (await accept(cPrice, { price: 1 })).error === 'agreement_changed');
  t.check('nada de lo anterior creó pedidos', (await one(`select count(*)::int n from orders`)).n === 0);

  // Aceptación correcta.
  const cOk = await chal('inv00001', g1), cOther = await chal('inv00001', g2);
  r = await accept(cOk);
  const o = await one(`select * from orders where slug = $1`, [r.slug]);
  t.check('acepta: pedido guest con principal no-Cavos, iban/platform, creado', r.ok === true && o.seller_auth_kind === 'guest' && o.seller_user_id === `seller_guest:${g1}` && o.payout_method === 'iban' && o.payout_address === G('P') && o.status === 'creado' && o.rules_version === 3, JSON.stringify(r));
  const inv = await one(`select * from invitations where code = 'inv00001'`);
  t.check('invitación aceptada y ligada al pedido', inv.status === 'aceptada' && inv.order_slug === r.slug);
  t.check('reusar el código -> challenge_used', (await accept(cOk)).error === 'challenge_used');
  const r2 = await accept(cOther, { sess: H('f') });
  t.check('otro vendedor con su propio código válido -> invite_not_open; sigue habiendo UN pedido', r2.error === 'invite_not_open' && (await one(`select count(*)::int n from orders`)).n === 1);
  t.check('una sesión activa, con hash', (await one(`select count(*)::int n from seller_guest_sessions where order_id = $1 and revoked_at is null`, [o.id])).n === 1);
  t.check('evento seller_guest_accepted con el hash del acuerdo', (await one(`select detail from order_events where order_id = $1 and kind = 'seller_guest_accepted'`, [o.id]))?.detail?.agreement_hash === 'sha256:' + H('9'));

  // Inmutables.
  const fails = async (sql: string, p: any[] = []) => db.query(sql, p).then(() => false, () => true);
  t.check('seller_acceptances no se puede modificar', await fails(`update seller_acceptances set agreement_hash = $1`, ['sha256:' + H('7')]));
  t.check('seller_acceptances no se puede borrar', await fails(`delete from seller_acceptances`));
  t.check('destino de cobro del pedido sin cuenta inmutable', await fails(`update orders set payout_address = $1 where id = $2`, [G('X'), o.id]));
  t.check('vendedor del pedido inmutable (guest -> cavos)', await fails(`update orders set seller_auth_kind = 'cavos', seller_guest_id = null where id = $1`, [o.id]));
  t.check('pedido guest sin destino iban -> constraint', await fails(`insert into orders (slug, seller_address, seller_user_id, seller_auth_kind, seller_guest_id, category, brand, model, condition, price_crc) values ('zzzzzz', $1, $2, 'guest', $3, 'otro', '', 'x', '', 1000)`, [G('S'), `seller_guest:${g1}`, g1]));
  t.check('pedido guest con seller_user_id que no es el suyo -> constraint', await fails(`insert into orders (slug, seller_address, seller_user_id, seller_auth_kind, seller_guest_id, category, brand, model, condition, price_crc, payout_method, payout_address) values ('zzzzzy', $1, 'cavos-sub', 'guest', $2, 'otro', '', 'x', '', 1000, 'iban', $1)`, [G('S'), g1]));
  t.check('pedidos de siempre (cavos) siguen funcionando', !(await fails(`insert into orders (slug, seller_address, seller_user_id, category, brand, model, condition, price_crc) values ('cavos1', $1, 'sub-1', 'otro', '', 'x', '', 1000)`, [G('C')])));
  t.check('los estados del pedido avanzan normal', !(await fails(`update orders set status = 'escrow_creado', contract_id = 'C' || repeat('A', 55), amount_usdc = 1, buyer_user_id = 'guest:b', buyer_address = '${G('P')}', sp_mode = 'backend' where id = $1`, [o.id])));

  // Recuperar: solo el mismo vendedor; revoca la sesión anterior.
  const rcOther = await chal('inv00001', g2, { purpose: 'recover' });
  const rr0 = (await one(`select seller_guest_recover($1, $2, $3, now() + interval '60 days') as r`, [rcOther, H('1'), H('c')])).r;
  t.check('recuperar con otra identidad -> challenge_invalid', rr0.error === 'challenge_invalid');
  const rc = await chal('inv00001', g1, { purpose: 'recover' });
  t.check('un código de aceptar no sirve para recuperar (y al revés)', (await one(`select seller_guest_recover($1, $2, $3, now() + interval '60 days') as r`, [cOther, H('1'), H('d')])).r.error === 'challenge_invalid' && (await accept(rc)).error === 'challenge_invalid');
  const rr = (await one(`select seller_guest_recover($1, $2, $3, now() + interval '60 days') as r`, [rc, H('1'), H('d')])).r;
  const ses = await q(`select token_hash, revoked_at from seller_guest_sessions where order_id = $1 order by created_at`, [o.id]);
  t.check('recuperar: sesión nueva y la anterior revocada', rr.ok === true && ses.length === 2 && ses.filter((s: any) => !s.revoked_at).length === 1 && ses.find((s: any) => !s.revoked_at).token_hash === H('d'), JSON.stringify(ses));
  t.check('anon no puede ejecutar los RPC', (await one(`select has_function_privilege('anon', 'public.seller_guest_accept(uuid, text, text, jsonb, jsonb, integer, text, timestamptz, integer)', 'execute') as x`)).x === false);
  await db.close();
}
