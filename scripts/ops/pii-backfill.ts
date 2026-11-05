// Backfill de PII (fase C). Idempotente: cifra donde hay claro y *_enc es null, verifica el descifrado
// en memoria y solo entonces escribe el blob. También pone orders.seller_email en null.
// Imprime conteos. Nunca imprime teléfono, correo ni llaves.
//
// Por defecto dry-run (no escribe). --apply escribe.
// Solo corre con VERCEL_ENV=production. Preview y cualquier otro entorno no cargan PII_ENC_*.
// Correr --apply solo después de que Vitalik aplicó la migración 051 y las llaves están en Production.
//
//   npx tsx scripts/ops/pii-backfill.ts
//   npx tsx scripts/ops/pii-backfill.ts --self-test
//   npx tsx scripts/ops/pii-backfill.ts --apply
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buyerContactKey, loadKeyRing, openPii, piiAad, sealPii } from '../../api/_lib/pii';

const BATCH = 100;
const MAX_BATCHES = 10000;

export interface ContactRow {
  id: string; order_id: string; channel: string;
  phone_e164: string | null; email: string | null;
  phone_e164_enc: string | null; email_enc: string | null;
}
export interface PhoneRow { sub: string; contact_phone: string | null; contact_phone_enc: string | null }

export type Work =
  | { status: 'skip' }
  | { status: 'unavailable' }
  | { status: 'fail' }
  | { status: 'ready'; patch: Record<string, string> };

function take(plain: string | null, enc: string | null, aad: string, field: string, patch: Record<string, string>): 'skip' | 'ready' | 'fail' | 'unavailable' {
  if (!plain || enc) return 'skip';
  const sealed = sealPii(plain, aad);
  if (!sealed) return loadKeyRing() ? 'fail' : 'unavailable';
  if (openPii(sealed, aad) !== plain) return 'fail';
  patch[field] = sealed;
  return 'ready';
}

export function contactWork(row: ContactRow): Work {
  const key = buyerContactKey(row.order_id, row.channel);
  const patch: Record<string, string> = {};
  const a = take(row.phone_e164, row.phone_e164_enc, piiAad('buyer_contacts', 'phone_e164', key), 'phone_e164_enc', patch);
  const b = take(row.email, row.email_enc, piiAad('buyer_contacts', 'email', key), 'email_enc', patch);
  if (a === 'fail' || b === 'fail') return { status: 'fail' };
  if (a === 'unavailable' || b === 'unavailable') return { status: 'unavailable' };
  if (!Object.keys(patch).length) return { status: 'skip' };
  return { status: 'ready', patch };
}

export function phoneWork(row: PhoneRow): Work {
  const patch: Record<string, string> = {};
  const a = take(row.contact_phone, row.contact_phone_enc, piiAad('seller_profiles', 'contact_phone', row.sub), 'contact_phone_enc', patch);
  if (a === 'fail' || a === 'unavailable' || a === 'skip') return { status: a };
  return { status: 'ready', patch };
}

export interface BackfillDb {
  /** Página ordenada por id, solo ids mayores que afterId. Cada fila se visita una vez. */
  pendingContacts(limit: number, afterId: string | null): Promise<ContactRow[]>;
  writeContact(id: string, patch: Record<string, string>): Promise<'ok' | 'miss'>;
  pendingPhones(limit: number, afterSub: string | null): Promise<PhoneRow[]>;
  writePhone(sub: string, enc: string): Promise<'ok' | 'miss'>;
  countSellerEmails(): Promise<number>;
  nullSellerEmails(limit: number): Promise<number>;
}

export interface BackfillCounts {
  contactsReady: number; contactsSkipped: number; contactsFailed: number; contactsWrote: number;
  phonesReady: number; phonesSkipped: number; phonesFailed: number; phonesWrote: number;
  sellerEmails: number; sellerEmailsNulled: number;
}

const empty = (): BackfillCounts => ({
  contactsReady: 0, contactsSkipped: 0, contactsFailed: 0, contactsWrote: 0,
  phonesReady: 0, phonesSkipped: 0, phonesFailed: 0, phonesWrote: 0,
  sellerEmails: 0, sellerEmailsNulled: 0,
});

async function drainContacts(db: BackfillDb, apply: boolean, batch: number, counts: BackfillCounts): Promise<void> {
  let after: string | null = null;
  for (let n = 0; n < MAX_BATCHES; n++) {
    const rows = await db.pendingContacts(batch, after);
    if (!rows.length) return;
    for (const row of rows) {
      const w = contactWork(row);
      if (w.status === 'skip') { counts.contactsSkipped++; continue; }
      if (w.status === 'unavailable') return;
      if (w.status === 'fail') { counts.contactsFailed++; continue; }
      counts.contactsReady++;
      if (!apply) continue;
      const r = await db.writeContact(row.id, w.patch);
      if (r === 'ok') counts.contactsWrote++; else counts.contactsSkipped++;
    }
    after = rows[rows.length - 1].id;
  }
}

async function drainPhones(db: BackfillDb, apply: boolean, batch: number, counts: BackfillCounts): Promise<void> {
  let after: string | null = null;
  for (let n = 0; n < MAX_BATCHES; n++) {
    const rows = await db.pendingPhones(batch, after);
    if (!rows.length) return;
    for (const row of rows) {
      const w = phoneWork(row);
      if (w.status === 'skip') { counts.phonesSkipped++; continue; }
      if (w.status === 'unavailable') return;
      if (w.status === 'fail') { counts.phonesFailed++; continue; }
      counts.phonesReady++;
      if (!apply) continue;
      const enc = w.patch.contact_phone_enc;
      if (!enc) { counts.phonesFailed++; continue; }
      const r = await db.writePhone(row.sub, enc);
      if (r === 'ok') counts.phonesWrote++; else counts.phonesSkipped++;
    }
    after = rows[rows.length - 1].sub;
  }
}

const NON_PROD = 'pii_unavailable: cifrado solo con VERCEL_ENV=production. Preview y cualquier otro entorno no cargan PII_ENC_* (la base de Preview es la de Production).';

export async function runBackfill(db: BackfillDb, opts: { apply: boolean; log: (line: string) => void; batch?: number }): Promise<{ code: number; counts: BackfillCounts }> {
  const counts = empty();
  if (process.env.VERCEL_ENV !== 'production') {
    opts.log(NON_PROD);
    return { code: 1, counts };
  }
  const ring = loadKeyRing();
  if (!ring) {
    opts.log(opts.apply ? 'pii_unavailable: sin llave activa, no se escribe' : 'dry-run keys=unavailable (no se cifra ni se escribe)');
    if (opts.apply) return { code: 1, counts };
  }
  const batch = opts.batch ?? BATCH;
  if (ring) {
    await drainContacts(db, opts.apply, batch, counts);
    await drainPhones(db, opts.apply, batch, counts);
  }
  counts.sellerEmails = await db.countSellerEmails();
  if (opts.apply && ring) {
    for (let n = 0; n < MAX_BATCHES; n++) {
      const k = await db.nullSellerEmails(batch);
      counts.sellerEmailsNulled += k;
      if (k === 0) break;
    }
  }
  const mode = opts.apply ? 'apply' : 'dry-run';
  opts.log(`${mode} buyer_contacts ready=${counts.contactsReady} wrote=${counts.contactsWrote} skipped=${counts.contactsSkipped} failed=${counts.contactsFailed}`);
  opts.log(`${mode} seller_profiles ready=${counts.phonesReady} wrote=${counts.phonesWrote} skipped=${counts.phonesSkipped} failed=${counts.phonesFailed}`);
  opts.log(`${mode} orders.seller_email pending=${counts.sellerEmails} nulled=${counts.sellerEmailsNulled}`);
  const failed = counts.contactsFailed + counts.phonesFailed;
  return { code: failed ? 1 : 0, counts };
}

function dbError(error: { code?: string } | null): Error {
  return new Error(String(error?.code ?? 'db'));
}

export function supabaseBackfill(client: SupabaseClient): BackfillDb {
  const cols = 'id, order_id, channel, phone_e164, email, phone_e164_enc, email_enc';
  return {
    async pendingContacts(limit, afterId) {
      const page = async (col: 'phone_e164' | 'email', enc: 'phone_e164_enc' | 'email_enc') => {
        let q = client.from('buyer_contacts').select(cols).not(col, 'is', null).is(enc, null).order('id').limit(limit);
        if (afterId) q = q.gt('id', afterId);
        const { data, error } = await q;
        if (error) throw dbError(error);
        return (data ?? []) as ContactRow[];
      };
      const byId = new Map<string, ContactRow>();
      for (const r of [...await page('phone_e164', 'phone_e164_enc'), ...await page('email', 'email_enc')]) byId.set(r.id, r);
      return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
    },
    async writeContact(id, patch) {
      let q = client.from('buyer_contacts').update(patch).eq('id', id);
      for (const col of Object.keys(patch)) q = q.is(col, null);
      const { data, error } = await q.select('id');
      if (error) throw dbError(error);
      return data?.length ? 'ok' : 'miss';
    },
    async pendingPhones(limit, afterSub) {
      let q = client.from('seller_profiles').select('sub, contact_phone, contact_phone_enc').not('contact_phone', 'is', null).is('contact_phone_enc', null).order('sub').limit(limit);
      if (afterSub) q = q.gt('sub', afterSub);
      const { data, error } = await q;
      if (error) throw dbError(error);
      return (data ?? []) as PhoneRow[];
    },
    async writePhone(sub, enc) {
      const { data, error } = await client.from('seller_profiles').update({ contact_phone_enc: enc }).eq('sub', sub).is('contact_phone_enc', null).select('sub');
      if (error) throw dbError(error);
      return data?.length ? 'ok' : 'miss';
    },
    async countSellerEmails() {
      const { count, error } = await client.from('orders').select('id', { count: 'exact', head: true }).not('seller_email', 'is', null);
      if (error) throw dbError(error);
      return count ?? 0;
    },
    async nullSellerEmails(limit) {
      const sel = await client.from('orders').select('id').not('seller_email', 'is', null).limit(limit);
      if (sel.error) throw dbError(sel.error);
      const ids = (sel.data ?? []).map((r) => r.id as string);
      if (!ids.length) return 0;
      const upd = await client.from('orders').update({ seller_email: null }).in('id', ids).select('id');
      if (upd.error) throw dbError(upd.error);
      return upd.data?.length ?? 0;
    },
  };
}

function selfTest(log: (s: string) => void): number {
  if (!loadKeyRing()) { log('self-test pii_unavailable'); return 1; }
  const phone = '+50600000000';
  const row: ContactRow = { id: 'x', order_id: '00000000-0000-4000-8000-000000000001', channel: 'whatsapp', phone_e164: phone, email: null, phone_e164_enc: null, email_enc: null };
  const w = contactWork(row);
  if (w.status !== 'ready' || !w.patch.phone_e164_enc) { log('self-test fail'); return 1; }
  const again = contactWork({ ...row, phone_e164_enc: w.patch.phone_e164_enc });
  if (again.status !== 'skip') { log('self-test not-idempotent'); return 1; }
  const line = 'self-test ok encrypted=1 skipped=1';
  log(line);
  return line.includes(phone) ? 1 : 0;
}

export async function main(argv: string[], log: (s: string) => void = (l) => console.log(l)): Promise<number> {
  const secret = process.env.PII_ENC_KEYS ?? '';
  const safe = (line: string) => log(secret.length >= 16 ? line.split(secret).join('[redacted]') : line);
  if (argv.some((a) => a !== '--apply' && a !== '--self-test' && a !== '--dry-run')) { safe('argumento no reconocido'); return 1; }
  if (process.env.VERCEL_ENV !== 'production') { safe(NON_PROD); return 1; }
  if (argv.includes('--self-test')) return selfTest(safe);
  const apply = argv.includes('--apply');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { safe('faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'); return 1; }
  const client = createClient(url, key, { auth: { persistSession: false } });
  try {
    const r = await runBackfill(supabaseBackfill(client), { apply, log: safe });
    return r.code;
  } catch (e) {
    const code = e instanceof Error ? e.message : 'db';
    if (code === '42703' || code === 'PGRST204') { safe('faltan columnas *_enc (migración 051). Avisar a Vitalik antes de apply_migration.'); return 1; }
    safe(`backfill error code=${/^[A-Za-z0-9]+$/.test(code) ? code : 'db'}`);
    return 1;
  }
}

function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(path.resolve(argv1)).href;
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
