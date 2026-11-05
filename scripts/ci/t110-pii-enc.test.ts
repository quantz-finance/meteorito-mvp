// (110) PII en reposo, fases A–C. Cifra teléfono y correo solo con VERCEL_ENV=production.
// Preview, development y VERCEL_ENV ausente fallan cerrado (pii_unavailable) aunque haya llaves.
// dual-write, deja de escribir orders.seller_email, y el gate de IBAN/SINPE/titular de ejemplo.
// El bundle del cliente no puede nombrar PII_ENC. Sin red.
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { CI_PII_KEY_B64, CI_PII_KID } from './setup';
import { installTestJwks, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { childRow } from '../../api/_lib/listings';
import {
  PII_BLOB_RE, buyerContactKey, loadKeyRing, openPii, piiAad, piiUnavailable, readPii, requireSeal, sealPii,
} from '../../api/_lib/pii';
import { HOLDER_PLACEHOLDER, IBAN_PLACEHOLDER, SINPE_PLACEHOLDER } from '../../api/_lib/payout';
import { CONTACT_CONSENT_VERSION } from '../../api/_lib/contactText';
import store from '../../api/store/index';
import { contactWork, phoneWork, runBackfill, type BackfillDb, type ContactRow, type PhoneRow } from '../ops/pii-backfill';
import { redact, runKeys } from '../ops/pii-enc-keys';

const root = new URL('../..', import.meta.url).pathname;
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const PHONE = '+50688881234';
const EMAIL = 'ana@correo.cr';

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

const ALLOW_VALUE = new Set([
  'IBAN_PLACEHOLDER', 'HOLDER_PLACEHOLDER', 'SINPE_PLACEHOLDER', 'null',
  "'CR00000000000000000000'", '"CR00000000000000000000"',
  "'Dato de ejemplo'", '"Dato de ejemplo"',
  "'00000000'", '"00000000"',
  "'Cuenta IBAN'",
]);

function payoutHits(file: string, src: string): string[] {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hits: string[] = [];
  const re = /(?<![A-Za-z0-9_])(iban|holder_name|sinpe_phone)\s*:\s*([^,;\n}]+)/g;
  for (const m of clean.matchAll(re)) {
    const key = m[1]; const value = m[2].trim();
    if (ALLOW_VALUE.has(value) || /^string(\s*\|\s*null)?$/.test(value) || /^string\)/.test(value) || /^o\(str\(\d+\)\)$/.test(value)) continue;
    if (file.endsWith('api/_lib/payoutChoice.ts') && (value === 'r.iban' || value === 'r.holder_name')) continue;
    if (file.endsWith('api/_lib/payout.ts') && value === 'row.holder_name ?? null') continue;
    hits.push(`${file}: ${key}: ${value}`);
  }
  const assign = /(?<![A-Za-z0-9_])\.(iban|holder_name|sinpe_phone)\s*=(?!=)\s*([^;\n]+)/g;
  for (const m of clean.matchAll(assign)) {
    const value = m[2].trim();
    if (value === 'IBAN_PLACEHOLDER' || value === 'HOLDER_PLACEHOLDER' || value === 'SINPE_PLACEHOLDER' || value === 'null') continue;
    hits.push(`${file}: .${m[1]} = ${value}`);
  }
  return hits;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function gateFiles(): string[] {
  const out: string[] = [];
  for (const top of ['api', 'app', 'lib', 'components', 'scripts']) {
    for (const p of walk(join(root, top))) {
      const rel = p.slice(root.length).replace(/^\//, '');
      if (rel.startsWith('scripts/ci/')) continue;
      out.push(rel);
    }
  }
  return out;
}

export async function run(t: T) {
  process.env.PII_ENC_KEYS = `${CI_PII_KID}:${CI_PII_KEY_B64}`;
  process.env.PII_ENC_ACTIVE_KID = CI_PII_KID;
  process.env.VERCEL_ENV = 'production';

  /* ---------- cripto ---------- */
  const ring = loadKeyRing();
  t.check('llave de CI carga y es de 32 bytes', !!ring && ring.active === 'ci' && ring.keys.get('ci')?.length === 32);
  const aad = piiAad('buyer_contacts', 'phone_e164', buyerContactKey('ord-1', 'whatsapp'));
  const blob = sealPii(PHONE, aad, ring)!;
  t.check('blob pii:v1 y el teléfono no aparece en el ciphertext', PII_BLOB_RE.test(blob) && blob.startsWith('pii:v1:ci:') && !blob.includes('88881234') && !blob.includes(PHONE));
  t.check('roundtrip', openPii(blob, aad, ring) === PHONE);
  t.check('AAD ata tabla, columna y fila', openPii(blob, piiAad('buyer_contacts', 'email', buyerContactKey('ord-1', 'whatsapp')), ring) === null
    && openPii(blob, piiAad('buyer_contacts', 'phone_e164', buyerContactKey('ord-2', 'whatsapp')), ring) === null);
  const tampered = blob.slice(0, -2) + (blob.endsWith('a') ? 'b' : 'a');
  t.check('tag alterado no abre', openPii(tampered, aad, ring) === null);
  const other = Buffer.alloc(32, 9).toString('base64');
  await withEnv({ PII_ENC_KEYS: `old:${other},ci:${CI_PII_KEY_B64}`, PII_ENC_ACTIVE_KID: 'old' }, async () => {
    const r2 = loadKeyRing()!;
    const b2 = sealPii(EMAIL, piiAad('buyer_contacts', 'email', 'ord-1|email'), r2)!;
    t.check('kid activo va en el blob; el kid anterior sigue abriendo', b2.startsWith('pii:v1:old:') && openPii(blob, aad, r2) === PHONE && openPii(b2, piiAad('buyer_contacts', 'email', 'ord-1|email'), r2) === EMAIL);
  });
  t.check('requireSeal sin política lanza 503 pii_unavailable', await withEnv({ PII_ENC_KEYS: undefined, PII_ENC_ACTIVE_KID: undefined }, async () => {
    let code = ''; let status = 0;
    try { requireSeal(PHONE, 'buyer_contacts', 'phone_e164', 'ord-1|whatsapp'); } catch (e) { code = (e as { code?: string }).code ?? ''; status = (e as { status?: number }).status ?? 0; }
    return code === 'pii_unavailable' && status === 503 && loadKeyRing() === null && sealPii(PHONE, aad) === null;
  }));
  t.check('fuera de Production no carga PII_ENC_*', await withEnv({ VERCEL_ENV: 'preview' }, async () => loadKeyRing() === null && sealPii(PHONE, aad) === null)
    && await withEnv({ VERCEL_ENV: 'development' }, async () => loadKeyRing() === null && openPii(blob, aad) === null)
    && await withEnv({ VERCEL_ENV: undefined }, async () => {
      if (loadKeyRing() !== null) return false;
      try { requireSeal(PHONE, 'buyer_contacts', 'phone_e164', 'ord-1|whatsapp'); return false; }
      catch (e) { return (e as { code?: string }).code === 'pii_unavailable'; }
    }));
  t.check('llave corta o kid desconocido no activan', await withEnv({ PII_ENC_KEYS: 'ci:' + Buffer.alloc(16, 1).toString('base64'), PII_ENC_ACTIVE_KID: 'ci' }, async () => loadKeyRing() === null)
    && await withEnv({ PII_ENC_ACTIVE_KID: 'no-esta' }, async () => loadKeyRing() === null));
  const piiSrc = read('api/_lib/pii.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  t.check('no cae a PIN_PEPPER ni a otros secretos', !/PIN_PEPPER|ORDER_ACCESS_SECRET|CAPTURE_SECRET|RATE_LIMIT_SALT|SUPABASE_/.test(piiSrc));
  const logs: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    t.check('leer prefiere el ciphertext', readPii({ table: 'buyer_contacts', column: 'phone_e164', rowKey: buyerContactKey('ord-1', 'whatsapp'), enc: blob, plain: '+50611111111' }) === PHONE);
    t.check('ciphertext de otra fila no cae al claro', readPii({ table: 'seller_profiles', column: 'contact_phone', rowKey: 'sub-1', enc: blob, plain: '+50611111111' }) === null);
    logs.length = 0;
    t.check('sin blob usa el claro y loguea pii_read_plain sin el valor', readPii({ table: 'seller_profiles', column: 'contact_phone', rowKey: 'sub-1', enc: null, plain: PHONE }) === PHONE
      && logs.some((l) => l.includes('pii_read_plain') && l.includes('seller_profiles.contact_phone')) && !logs.some((l) => l.includes(PHONE) || l.includes('88881234')));
    logs.length = 0;
    await withEnv({ PII_ENC_KEYS: undefined }, async () => {
      t.check('sin llave, leer devuelve null (ni el claro)', readPii({ table: 'buyer_contacts', column: 'email', rowKey: 'o|email', enc: blob, plain: EMAIL }) === null
        && logs.some((l) => l.includes('pii_read_unavailable')) && !logs.some((l) => l.includes(EMAIL) || l.includes(PHONE)));
    });
  } finally { console.warn = origWarn; }
  t.check('piiUnavailable es 503', piiUnavailable().status === 503 && (piiUnavailable() as { code?: string }).code === 'pii_unavailable');

  /* ---------- dual-write vendedor ---------- */
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria' }];
  const tok = await token({ sub: 'seller1' });
  const call = async (body: any, auth?: string) => {
    const r = res();
    await store({ method: 'POST', headers: auth ? { authorization: `Bearer ${auth}` } : {}, body, query: {} }, r);
    return r;
  };
  let r = await call({ action: 'update', contact_phone: '8888 1234' }, tok);
  const sp = db.tables.seller_profiles[0];
  t.check('dual-write del WhatsApp: claro + blob que abre al mismo número', r.code === 200 && r.body?.contact_phone === PHONE && sp.contact_phone === PHONE
    && openPii(sp.contact_phone_enc, piiAad('seller_profiles', 'contact_phone', 'seller1')) === PHONE && !String(sp.contact_phone_enc).includes('88881234'), `${r.code}`);
  sp.contact_phone = '+50611111111';
  r = await call({ action: 'me' }, tok);
  t.check('leer prefiere *_enc sobre un claro distinto', r.code === 200 && r.body?.contact_phone === PHONE && !JSON.stringify(r.body).includes('11111111'));
  const plain = sp.contact_phone_enc; sp.contact_phone_enc = null; sp.contact_phone = PHONE;
  const warn2: string[] = []; const w0 = console.warn; console.warn = (...a: unknown[]) => { warn2.push(a.map(String).join(' ')); };
  try {
    r = await call({ action: 'me' }, tok);
    t.check('sin *_enc cae al claro y loguea pii_read_plain sin dígitos', r.body?.contact_phone === PHONE && warn2.some((l) => l.includes('pii_read_plain')) && !warn2.some((l) => l.includes('88881234')));
  } finally { console.warn = w0; sp.contact_phone_enc = plain; }
  await withEnv({ PII_ENC_KEYS: undefined, PII_ENC_ACTIVE_KID: undefined }, async () => {
    const before = sp.contact_phone;
    r = await call({ action: 'update', contact_phone: '8888 0000' }, tok);
    t.check('sin llave: 503 pii_unavailable y no se reescribe el teléfono', r.code === 503 && r.body?.code === 'pii_unavailable' && sp.contact_phone === before, `${r.code} ${r.body?.code}`);
    r = await call({ action: 'me' }, tok);
    t.check('sin llave: el dueño no recibe el teléfono', r.code === 200 && r.body?.contact_phone === null && !JSON.stringify(r.body).includes('8888'));
  });
  for (const envName of ['preview', 'development', undefined] as const) {
    await withEnv({ VERCEL_ENV: envName }, async () => {
      const before = JSON.stringify(sp);
      r = await call({ action: 'update', contact_phone: '2222 3333' }, tok);
      t.check(`${envName ?? 'sin VERCEL_ENV'}: 503 y la fila no cambia`, r.code === 503 && r.body?.code === 'pii_unavailable' && JSON.stringify(sp) === before, `${r.code}`);
    });
  }

  /* ---------- dual-write comprador ---------- */
  const KEY = 'c'.repeat(64);
  const guest = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
  const order = { id: '11111111-1111-4111-8111-111111111111', slug: 'pii001', status: 'fondeado', buyer_user_id: guest, seller_user_id: 'seller1', brand: 'A', model: 'B', price_crc: 10000 };
  db.tables.orders = [order]; db.tables.buyer_contacts = []; db.tables.buyer_notifications = [];
  const save = async (body: any) => {
    const rr = res();
    await store({ method: 'POST', headers: { 'x-guest-key': KEY }, body, query: {} }, rr);
    return rr;
  };
  r = await save({ action: 'buyer_contact_save', slug: 'pii001', channel: 'whatsapp', cc: '+506', phone: '8888 1234', consent: true, consent_version: CONTACT_CONSENT_VERSION });
  const wa = db.tables.buyer_contacts.find((c) => c.channel === 'whatsapp');
  t.check('contacto WhatsApp: claro y ciphertext, respuesta enmascarada', r.code === 200 && r.body?.contact?.masked === '+506 •••• 1234' && wa?.phone_e164 === PHONE
    && openPii(wa?.phone_e164_enc, piiAad('buyer_contacts', 'phone_e164', buyerContactKey(order.id, 'whatsapp'))) === PHONE
    && !JSON.stringify(r.body).includes('88881234') && !String(wa?.phone_e164_enc).includes('88881234'), `${r.code}`);
  r = await save({ action: 'buyer_contact_save', slug: 'pii001', channel: 'email', email: 'Ana@Correo.cr', consent: true, consent_version: CONTACT_CONSENT_VERSION });
  const em = db.tables.buyer_contacts.find((c) => c.channel === 'email');
  t.check('contacto correo: claro y ciphertext', r.code === 200 && em?.email === EMAIL
    && openPii(em?.email_enc, piiAad('buyer_contacts', 'email', buyerContactKey(order.id, 'email'))) === EMAIL && !String(em?.email_enc).includes(EMAIL));
  em.email = 'otro@correo.cr';
  r = await save({ action: 'buyer_contact_get', slug: 'pii001' }); // get no es save; usa el mismo helper con action get
  r = await (async () => { const rr = res(); await store({ method: 'POST', headers: { 'x-guest-key': KEY }, body: { action: 'buyer_contact_get', slug: 'pii001' }, query: {} }, rr); return rr; })();
  t.check('get del comprador enmascara desde el ciphertext, no desde el claro alterado', r.code === 200 && r.body?.contacts?.some((c: any) => c.channel === 'email' && c.masked === 'a••@correo.cr')
    && !JSON.stringify(r.body).includes('otro@'));
  await withEnv({ PII_ENC_KEYS: undefined }, async () => {
    const n = db.tables.buyer_contacts.length;
    r = await save({ action: 'buyer_contact_save', slug: 'pii001', channel: 'whatsapp', cc: '+506', phone: '8888 9999', consent: true, consent_version: CONTACT_CONSENT_VERSION });
    t.check('guardar contacto sin llave: 503 y no hay fila nueva', r.code === 503 && r.body?.code === 'pii_unavailable' && db.tables.buyer_contacts.length === n && wa.phone_e164 === PHONE, `${r.code}`);
  });

  /* ---------- seller_email ya no se escribe ---------- */
  const createSrc = read('api/orders/create.ts');
  const listSrc = read('api/_lib/listings.ts');
  const copy = listSrc.match(/const COPY = \[([\s\S]*?)\]/)?.[1] ?? '';
  t.check('create no asigna seller_email', !/seller_email\s*:/.test(createSrc));
  t.check('el pedido hijo no copia seller_email', !/seller_email/.test(copy));
  const child = childRow({ slug: 'prod01', seller_address: 'G', seller_user_id: 's', seller_email: 'secreto@correo.com', price_crc: 25000 }, 'guest:Z', 'abc123');
  t.check('childRow omite seller_email aunque el padre lo tenga', !('seller_email' in child));
  const apiHits = walk(join(root, 'api')).filter((p) => /seller_email\s*:/.test(readFileSync(p, 'utf8')));
  t.check('ningún archivo de api asigna seller_email', apiHits.length === 0, apiHits.map((p) => p.slice(root.length)).join(' '));

  /* ---------- migración 051 ---------- */
  const sql = read('supabase/migrations/051_pii_enc.sql');
  const fmt = '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,700}$';
  t.check('051 aditiva: tres columnas, formato, canal en claro o cifrado, sin drop ni vistas', /phone_e164_enc/.test(sql) && /email_enc/.test(sql) && /contact_phone_enc/.test(sql)
    && sql.split(fmt).length === 4
    && /phone_e164 is not null or phone_e164_enc is not null/.test(sql)
    && /email is not null or email_enc is not null/.test(sql)
    && !/drop column|drop table|create or replace view|grant /i.test(sql));

  /* ---------- gate IBAN ---------- */
  const payoutSrc = read('api/_lib/payout.ts');
  const fn = payoutSrc.slice(payoutSrc.indexOf('export const placeholderPayoutRow'));
  t.check('placeholderPayoutRow solo recibe sub y at, y fuerza los tres placeholders',
    /placeholderPayoutRow = \(sub: string, at: string\)/.test(fn)
    && /iban: IBAN_PLACEHOLDER/.test(fn) && /holder_name: HOLDER_PLACEHOLDER/.test(fn) && /sinpe_phone: SINPE_PLACEHOLDER/.test(fn)
    && IBAN_PLACEHOLDER === 'CR00000000000000000000' && HOLDER_PLACEHOLDER === 'Dato de ejemplo' && SINPE_PLACEHOLDER === '00000000');
  const bad = payoutHits('api/store/index.ts', "db.from('seller_payout').upsert({ iban: body.iban, holder_name: 'Ana Mora', sinpe_phone: sinpe })");
  t.check('el gate detecta un write que no es placeholder', bad.length === 3, bad.join(' | '));
  const hits: string[] = [];
  for (const rel of gateFiles()) hits.push(...payoutHits(rel, read(rel)));
  t.check('ningún path de la app escribe iban/titular/sinpe que no sea el dato de ejemplo', hits.length === 0, hits.slice(0, 8).join(' | '));

  /* ---------- bundle ---------- */
  const clientHits: string[] = [];
  for (const top of ['app', 'components', 'lib']) {
    for (const p of walk(join(root, top))) {
      const src = readFileSync(p, 'utf8');
      if (src.includes('PII_ENC') || src.includes('_lib/pii')) clientHits.push(p.slice(root.length));
    }
  }
  t.check('app/components/lib no mencionan PII_ENC ni api/_lib/pii', clientHits.length === 0, clientHits.join(' '));
  const dist = join(root, 'dist');
  if (existsSync(join(dist, 'index.html'))) {
    const bundle: string[] = [];
    const walkDist = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walkDist(p);
        else if (/\.(js|html|map)$/.test(name) && readFileSync(p, 'utf8').includes('PII_ENC')) bundle.push(p.slice(dist.length));
      }
    };
    walkDist(dist);
    t.check('el bundle web no contiene PII_ENC', bundle.length === 0, bundle.slice(0, 5).join(' '));
  } else t.check(process.env.CI ? 'CI debe tener dist/ (expo export corre antes)' : 'sin dist/: el bundle se revisa en CI', !process.env.CI);

  /* ---------- backfill ---------- */
  const memPhone = '+50622223333';
  const memEmail = 'backfill@correo.cr';
  const contacts: ContactRow[] = [
    { id: 'b', order_id: 'o1', channel: 'email', phone_e164: null, email: memEmail, phone_e164_enc: null, email_enc: null },
    { id: 'a', order_id: 'o1', channel: 'whatsapp', phone_e164: memPhone, email: null, phone_e164_enc: null, email_enc: null },
    { id: 'c', order_id: 'o2', channel: 'whatsapp', phone_e164: memPhone, email: null, phone_e164_enc: 'ya', email_enc: null },
  ];
  const phones: PhoneRow[] = [
    { sub: 's1', contact_phone: memPhone, contact_phone_enc: null },
    { sub: 's2', contact_phone: null, contact_phone_enc: null },
  ];
  let emails = ['id-1', 'id-2'];
  const mem = (): BackfillDb => ({
    async pendingContacts(limit, afterId) {
      return contacts.filter((c) => (!afterId || c.id > afterId) && ((c.phone_e164 && !c.phone_e164_enc) || (c.email && !c.email_enc))).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, limit);
    },
    async writeContact(id, patch) {
      const row = contacts.find((c) => c.id === id);
      if (!row) return 'miss';
      if (patch.phone_e164_enc && row.phone_e164_enc) return 'miss';
      if (patch.email_enc && row.email_enc) return 'miss';
      Object.assign(row, patch);
      return 'ok';
    },
    async pendingPhones(limit, afterSub) {
      return phones.filter((p) => p.contact_phone && !p.contact_phone_enc && (!afterSub || p.sub > afterSub)).sort((a, b) => a.sub < b.sub ? -1 : 1).slice(0, limit);
    },
    async writePhone(sub, enc) {
      const row = phones.find((p) => p.sub === sub);
      if (!row || row.contact_phone_enc) return 'miss';
      row.contact_phone_enc = enc;
      return 'ok';
    },
    async countSellerEmails() { return emails.length; },
    async nullSellerEmails(limit) { const n = Math.min(limit, emails.length); emails = emails.slice(n); return n; },
  });
  const blog: string[] = [];
  const dry = await runBackfill(mem(), { apply: false, log: (l) => blog.push(l), batch: 1 });
  t.check('dry-run cuenta y no escribe', dry.code === 0 && dry.counts.contactsReady === 2 && dry.counts.phonesReady === 1 && dry.counts.sellerEmails === 2
    && dry.counts.contactsWrote === 0 && contacts[1].phone_e164_enc === null && emails.length === 2
    && !blog.join('\n').includes(memPhone) && !blog.join('\n').includes(memEmail), blog.join(' | '));
  blog.length = 0;
  const applied = await runBackfill(mem(), { apply: true, log: (l) => blog.push(l), batch: 1 });
  const opened = openPii(contacts.find((c) => c.id === 'a')!.phone_e164_enc!, piiAad('buyer_contacts', 'phone_e164', buyerContactKey('o1', 'whatsapp')));
  t.check('apply cifra, verifica y anula seller_email; el log solo trae conteos', applied.code === 0 && applied.counts.contactsWrote === 2 && applied.counts.phonesWrote === 1
    && opened === memPhone && openPii(phones[0].contact_phone_enc!, piiAad('seller_profiles', 'contact_phone', 's1')) === memPhone
    && emails.length === 0 && !blog.join('\n').includes(memPhone) && !blog.join('\n').includes(memEmail));
  const second = await runBackfill(mem(), { apply: true, log: () => {} });
  t.check('segunda corrida no reescribe', second.counts.contactsWrote === 0 && second.counts.phonesWrote === 0 && second.counts.contactsReady === 0);
  const skipped = contactWork({ id: 'c', order_id: 'o2', channel: 'whatsapp', phone_e164: memPhone, email: null, phone_e164_enc: 'ya', email_enc: null });
  t.check('fila que ya tiene blob se salta', skipped.status === 'skip');
  t.check('phoneWork de fila vacía se salta', phoneWork({ sub: 's2', contact_phone: null, contact_phone_enc: null }).status === 'skip');
  for (const envName of ['preview', 'development', undefined] as const) {
    await withEnv({ VERCEL_ENV: envName }, async () => {
      const p = await runBackfill(mem(), { apply: true, log: (l) => blog.push(l) });
      t.check(`backfill con ${envName ?? 'VERCEL_ENV ausente'} se niega`, p.code === 1 && blog.some((l) => l.includes('pii_unavailable') && l.includes('production')));
    });
  }
  blog.length = 0;
  await withEnv({ PII_ENC_KEYS: undefined, PII_ENC_ACTIVE_KID: undefined }, async () => {
    const p = await runBackfill(mem(), { apply: true, log: (l) => blog.push(l) });
    t.check('apply sin llave no escribe', p.code === 1 && blog.some((l) => l.includes('pii_unavailable')));
  });

  /* ---------- script de llaves ---------- */
  const keysSrc = read('scripts/ops/pii-enc-keys.ts');
  t.check('el script de llaves no toca el disco', !/node:fs|from 'fs'|writeFile|appendFile/.test(keysSrc));
  t.check('redact quita la llave', redact('valor ' + CI_PII_KEY_B64 + ' fin', [CI_PII_KEY_B64]) === 'valor [redacted] fin');
  const dryLogs: string[] = []; let fetches = 0;
  const dryCode = await runKeys([], { log: (l) => dryLogs.push(l), fetch: (async () => { fetches++; return new Response(''); }) as typeof fetch, env: {} });
  t.check('dry-run por defecto: no llama a Vercel, avisa de Rolando y veda Preview', dryCode === 0 && fetches === 0 && dryLogs.some((l) => /dry-run/.test(l)) && dryLogs.some((l) => /Rolando/.test(l)) && dryLogs.some((l) => /PII_ENC_\*/.test(l))
    && !dryLogs.some((l) => /[A-Za-z0-9+/]{40,}={0,2}/.test(l)));
  const refused: string[] = [];
  const fakeKey = randomBytes(32).toString('base64');
  const refuseCode = await runKeys(['--apply', '--target', 'production', fakeKey], { log: (l) => refused.push(l), fetch: (async () => { fetches++; return new Response(''); }) as typeof fetch, env: { VERCEL_TOKEN: 't'.repeat(20), VERCEL_PROJECT_ID: 'prj' } });
  t.check('no acepta material de llave por argumentos y no lo imprime', refuseCode === 1 && fetches === 0 && refused.some((l) => /no se acepta/.test(l)) && !refused.some((l) => l.includes(fakeKey)));
  const posted: { url: string; body: string; auth: string }[] = [];
  const vercelTok = 'vercel-token-ci-0123456789';
  const applyLogs: string[] = [];
  const applyCode = await runKeys(['--apply', '--target', 'production'], {
    log: (l) => applyLogs.push(l),
    env: { VERCEL_TOKEN: vercelTok, VERCEL_PROJECT_ID: 'prj_ci', VERCEL_ORG_ID: 'team_ci' },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? init.body : '';
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
      posted.push({ url, body, auth });
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ envs: [] }), { status: 200 });
      return new Response('', { status: 201 });
    }) as typeof fetch,
  });
  const keysBody = posted.find((p) => p.body.includes('PII_ENC_KEYS'));
  const parsed = keysBody ? JSON.parse(keysBody.body) as { type?: string; target?: string[]; value?: string } : null;
  const b64 = parsed?.value?.slice(parsed.value.indexOf(':') + 1) ?? '';
  const postedUrl = keysBody?.url ?? '';
  t.check('apply manda Sensitive a production y el log no trae la llave ni el token', applyCode === 0 && parsed?.type === 'sensitive' && parsed?.target?.[0] === 'production'
    && Buffer.from(b64, 'base64').length === 32 && postedUrl.includes('teamId=team_ci') && postedUrl.includes('decrypt=false')
    && !applyLogs.some((l) => l.includes(b64) || l.includes(vercelTok)) && applyLogs.some((l) => /el valor no se muestra/.test(l)), `${applyCode} ${applyLogs.join(' | ')}`);
  const beforePreview = fetches;
  const previewLogs: string[] = [];
  const previewCode = await runKeys(['--apply', '--target', 'preview'], {
    log: (l) => previewLogs.push(l),
    env: { VERCEL_TOKEN: vercelTok, VERCEL_PROJECT_ID: 'prj_ci' },
    fetch: (async () => { fetches++; return new Response('', { status: 500 }); }) as typeof fetch,
  });
  const devCode = await runKeys(['--apply', '--target', 'development'], {
    log: (l) => previewLogs.push(l),
    env: { VERCEL_TOKEN: vercelTok, VERCEL_PROJECT_ID: 'prj_ci' },
    fetch: (async () => { fetches++; return new Response('', { status: 500 }); }) as typeof fetch,
  });
  t.check('Preview y development no reciben PII_ENC_*: no se llama a Vercel', previewCode === 1 && devCode === 1 && fetches === beforePreview && previewLogs.some((l) => /PII_ENC_\*/.test(l)));
  const againLogs: string[] = [];
  const again = await runKeys(['--apply', '--target', 'production'], {
    log: (l) => againLogs.push(l),
    env: { VERCEL_TOKEN: vercelTok, VERCEL_PROJECT_ID: 'prj_ci' },
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ envs: [{ key: 'PII_ENC_KEYS', target: ['production'] }] }), { status: 200 });
      return new Response('', { status: 201 });
    }) as typeof fetch,
  });
  t.check('si la variable ya existe en production no se reemplaza', again === 1 && againLogs.some((l) => /ya existe/.test(l)) && !againLogs.some((l) => l.includes(b64)));
}
