// Cifrado de PII en reposo (Snowden punto 2, fases A–C). SOLO servidor: nunca importar desde app/ ni lib/.
// AES-256-GCM (node:crypto). La llave AES sale de HKDF-SHA256 de la llave maestra, propósito "enc":
//   salt = utf8("meteorito:pii:v1"), info = utf8("enc"), L = 32.
// Blob: pii:v1:<kid>:<base64url(nonce12 ‖ tag16 ‖ ciphertext)>
// AAD:  meteorito:pii:v1|<tabla>.<columna>|<clave de fila>
//   buyer_contacts:  clave = order_id|channel
//   seller_profiles: clave = sub
// Env (sin fallback a PIN_PEPPER ni a ningún otro secreto):
//   PII_ENC_KEYS=kid:base64,kid2:base64   (cada llave maestra = 32 bytes)
//   PII_ENC_ACTIVE_KID=<kid>              (solo este cifra; todos descifran)
// Fail-closed fuera de Production: VERCEL_ENV distinto de "production" (preview, development,
// ausente, cualquier otro) NO lee PII_ENC_*. Escribir tira 503 pii_unavailable; leer devuelve null
// (no el texto en claro). Preview comparte la base de Production: no debe tener estas llaves.
// Con política activa, leer prefiere *_enc y, si no hay, el texto en claro.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { HttpError } from './auth';

export const PII_PREFIX = 'pii:v1';
export const PII_AAD_PREFIX = 'meteorito:pii:v1';
/** Mismo patrón que el check de la migración 051. */
export const PII_BLOB_RE = /^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,700}$/;
const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const HKDF_SALT = Buffer.from('meteorito:pii:v1', 'utf8');
const HKDF_INFO = Buffer.from('enc', 'utf8');
const MAX_PLAIN = 2000;

export type PiiTable = 'buyer_contacts' | 'seller_profiles';
export type PiiColumn = 'phone_e164' | 'email' | 'contact_phone';

export const piiAad = (table: PiiTable, column: PiiColumn, rowKey: string) => `${PII_AAD_PREFIX}|${table}.${column}|${rowKey}`;
export const buyerContactKey = (orderId: string, channel: string) => `${orderId}|${channel}`;

export function piiUnavailable(): HttpError {
  return Object.assign(new HttpError(503, 'Por ahora no podemos guardar ese dato. Intenta más tarde.'), { code: 'pii_unavailable' });
}

export interface KeyRing { active: string; keys: Map<string, Buffer> }

function decodeMaster(b64: string): Buffer | null {
  const s = b64.trim();
  if (!s || /[^A-Za-z0-9+/=_-]/.test(s)) return null;
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buf.length === 32 ? buf : null;
}

/**
 * null = política apagada. Solo VERCEL_ENV=production carga llaves.
 * Preview, development y cualquier otro valor salen antes de leer PII_ENC_*.
 * No usa PIN_PEPPER ni ningún otro secreto.
 */
export function loadKeyRing(env: NodeJS.ProcessEnv = process.env): KeyRing | null {
  if (env.VERCEL_ENV !== 'production') return null;
  const raw = env.PII_ENC_KEYS?.trim();
  const active = env.PII_ENC_ACTIVE_KID?.trim();
  if (!raw || !active || !KID_RE.test(active)) return null;
  const keys = new Map<string, Buffer>();
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i <= 0) return null;
    const kid = t.slice(0, i);
    if (!KID_RE.test(kid) || keys.has(kid)) return null;
    const master = decodeMaster(t.slice(i + 1));
    if (!master) return null;
    keys.set(kid, master);
  }
  if (!keys.has(active)) return null;
  return { active, keys };
}

function aesKey(master: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO, 32));
}

/** null si la política está apagada o el texto no se puede cifrar. No lanza. */
export function sealPii(plaintext: string, aad: string, ring: KeyRing | null = loadKeyRing()): string | null {
  if (!ring || typeof plaintext !== 'string' || plaintext.length === 0 || plaintext.length > MAX_PLAIN) return null;
  const master = ring.keys.get(ring.active);
  if (!master) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(master), nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PII_PREFIX}:${ring.active}:${Buffer.concat([nonce, tag, ct]).toString('base64url')}`;
}

/** null si no se puede descifrar (llave, AAD, tag o formato). No lanza. */
export function openPii(blob: string, aad: string, ring: KeyRing | null = loadKeyRing()): string | null {
  const m = typeof blob === 'string' ? /^pii:v1:([A-Za-z0-9_-]{1,32}):([A-Za-z0-9_-]{38,700})$/.exec(blob) : null;
  if (!ring || !m) return null;
  const master = ring.keys.get(m[1]);
  if (!master) return null;
  const raw = Buffer.from(m[2], 'base64url');
  if (raw.length < 28) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey(master), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch { return null; }
}

/**
 * Escritura: null en claro → null cifrado. Sin política activa lanza pii_unavailable (no escribe el texto).
 * El llamador guarda el texto en claro Y este blob (dual-write) hasta la migración 052.
 */
export function requireSeal(plaintext: string | null, table: PiiTable, column: PiiColumn, rowKey: string): string | null {
  const ring = loadKeyRing();
  if (!ring) throw piiUnavailable();
  if (plaintext == null || plaintext === '') return null;
  const sealed = sealPii(plaintext, piiAad(table, column, rowKey), ring);
  if (!sealed) throw piiUnavailable();
  return sealed;
}

/**
 * Lectura. Con política activa: prefiere *_enc; si el blob no abre, null (no cae al claro).
 * Si no hay blob, usa el claro y deja pii_read_plain (sin el valor). Sin política: null.
 */
export function readPii(opts: { table: PiiTable; column: PiiColumn; rowKey: string; enc: unknown; plain: unknown }): string | null {
  const enc = typeof opts.enc === 'string' && opts.enc ? opts.enc : null;
  const plain = typeof opts.plain === 'string' && opts.plain ? opts.plain : null;
  const where = `${opts.table}.${opts.column}`;
  const ring = loadKeyRing();
  if (!ring) {
    if (enc || plain) console.warn('[pii] pii_read_unavailable', where);
    return null;
  }
  if (enc) {
    const v = openPii(enc, piiAad(opts.table, opts.column, opts.rowKey), ring);
    if (v == null) console.warn('[pii] pii_read_fail', where);
    return v;
  }
  if (plain) {
    console.warn('[pii] pii_read_plain', where);
    return plain;
  }
  return null;
}
