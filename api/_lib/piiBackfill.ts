// Backfill de PII (fase C). Corre dentro de Vercel (api/store, action admin_pii_backfill): ahí están
// las variables Sensitive. Idempotente: cifra donde hay claro y *_enc es null, verifica el descifrado
// en memoria y solo entonces escribe. También pone orders.seller_email en null.
// La respuesta y los logs son conteos. Nunca teléfono, correo ni llaves.
// Dry-run por defecto. --apply solo después de que Vitalik aplicó la migración 051.
import { HttpError } from './auth';
import { buyerContactKey, loadKeyRing, openPii, piiAad, piiUnavailable, sealPii } from './pii';

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

export async function runBackfill(db: BackfillDb, opts: { apply: boolean; log: (line: string) => void; batch?: number }): Promise<{ code: number; counts: BackfillCounts }> {
  const counts = empty();
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

export function supabaseBackfill(client: { from(table: string): any }): BackfillDb {
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
      const ids = (sel.data ?? []).map((r: { id?: string }) => String(r.id ?? ''));
      if (!ids.length) return 0;
      const upd = await client.from('orders').update({ seller_email: null }).in('id', ids).select('id');
      if (upd.error) throw dbError(upd.error);
      return upd.data?.length ?? 0;
    },
  };
}

export interface BackfillReport extends BackfillCounts { dryRun: boolean }

/** Acción de admin. apply=false no escribe. La respuesta son conteos, nunca el dato. */
export async function adminPiiBackfill(client: { from(table: string): any }, apply: boolean): Promise<BackfillReport> {
  if (apply && !loadKeyRing()) throw piiUnavailable();
  try {
    const r = await runBackfill(supabaseBackfill(client), { apply, log: () => {} });
    return { dryRun: !apply, ...r.counts };
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    if (code === '42703' || code === 'PGRST204') {
      throw Object.assign(new HttpError(503, 'Falta la migración 051. Hay que avisarle a quien aplica las migraciones.'), { code: 'pii_backfill_unavailable' });
    }
    throw e;
  }
}
