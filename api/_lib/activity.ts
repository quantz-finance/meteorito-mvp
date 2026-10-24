// Última conexión del vendedor (estilo P2P), SOLO con consentimiento (Ley 8968, art. 5).
// - Datos: seller_profiles.last_seen_at + show_last_seen (021) y last_seen_consents (023: un registro por cada cambio,
//   con usuario, valor, fecha y versión del texto que vio).
// - Se muestra solo si show_last_seen = true Y el último registro de consentimiento dice true. Sin 023 (o ante cualquier
//   error) nadie consiente: no se guarda ni se muestra nada, y la app funciona igual.
// - Sin consentimiento no se guarda la hora (touchSeen no escribe) y al apagarlo se borra.
// - Al público solo le llega un rango grueso, por un endpoint sin caché (?activity=); el feed y el perfil cacheados no
//   la llevan, así que apagarlo se nota de inmediato. La hora exacta nunca sale del servidor.
import { db } from './db';
import { missingColumn } from './listings';

export const SEEN_THROTTLE_MS = 5 * 60_000;
/** Versión del texto de consentimiento (invitación en Vender + Mi cuenta). Cambiar si cambia el texto.
 *  v1-2026-10-24: "quienes te compran"; v2-2026-10-24: "quienes ven tu tienda en Meteorito" (legal). */
export const LAST_SEEN_TEXT_VERSION = 'v2-2026-10-24';
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

export type Activity = { k: 'online' } | { k: 'min'; n: number } | { k: 'h'; n: number } | { k: 'yesterday' } | { k: 'days'; n: number };

/** Rango público: <5 min En línea; <1 h minutos (de 5 en 5); <24 h horas; <48 h ayer; hasta 7 días; después, nada. */
export function activityOf(lastSeen: unknown, show: boolean, now = Date.now()): Activity | null {
  if (!show || typeof lastSeen !== 'string') return null;
  const t = Date.parse(lastSeen);
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, now - t);
  if (ms < 5 * MIN) return { k: 'online' };
  if (ms < H) return { k: 'min', n: Math.floor(ms / MIN / 5) * 5 };
  if (ms < D) return { k: 'h', n: Math.floor(ms / H) };
  if (ms < 2 * D) return { k: 'yesterday' };
  const days = Math.floor(ms / D);
  return days <= 7 ? { k: 'days', n: days } : null;
}

const missingTable = (e: any) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /last_seen_consents/.test(String(e.message ?? '')) && /does not exist|schema cache/i.test(String(e.message ?? '')));

/** Último consentimiento de cada usuario. Sin 023 o con error: mapa vacío (= nadie consiente). */
async function consentsOf(subs: string[]): Promise<{ ok: boolean; latest: Map<string, boolean> }> {
  const latest = new Map<string, boolean>();
  if (!subs.length) return { ok: true, latest };
  try {
    const { data, error } = await db().from('last_seen_consents').select('user_id, value, created_at').in('user_id', subs).order('created_at', { ascending: false });
    if (error) { if (!missingTable(error)) console.warn('[consent]', error.message ?? error); return { ok: false, latest }; }
    for (const r of (data ?? []) as { user_id: string; value: boolean }[]) if (!latest.has(r.user_id)) latest.set(r.user_id, r.value === true);
    return { ok: true, latest };
  } catch (e) { console.warn('[consent]', (e as Error).message); return { ok: false, latest }; }
}

/** Estado del dueño: show = la muestra de verdad (interruptor y consentimiento); decided = ya eligió alguna vez. */
export async function lastSeenStateOf(sub: string): Promise<{ show: boolean; decided: boolean; available: boolean }> {
  const c = await consentsOf([sub]);
  if (!c.ok) return { show: false, decided: false, available: false };
  const consent = c.latest.get(sub);
  if (consent !== true) return { show: false, decided: consent !== undefined, available: true };
  try {
    const { data, error } = await db().from('seller_profiles').select('show_last_seen').eq('sub', sub).maybeSingle();
    return { show: !error && (data as any)?.show_last_seen === true, decided: true, available: !error };
  } catch { return { show: false, decided: true, available: false }; }
}

/** Marca actividad del usuario de la sesión, solo si consintió. true = escribió. Nunca lanza. */
export async function touchSeen(sub: string, now = Date.now()): Promise<boolean> {
  if (!(await lastSeenStateOf(sub)).show) return false; // sin consentimiento no se guarda nada
  const at = new Date(now).toISOString(), cutoff = new Date(now - SEEN_THROTTLE_MS).toISOString();
  try {
    // Condicional en la base: dos UPDATE atómicos (anterior al corte, o nunca visto). Concurrencia: a lo sumo uno escribe.
    for (const cond of [(q: any) => q.lt('last_seen_at', cutoff), (q: any) => q.is('last_seen_at', null)]) {
      const { data, error } = await cond(db().from('seller_profiles').update({ last_seen_at: at }).eq('sub', sub).eq('show_last_seen', true)).select('sub');
      if (error) { if (!missingColumn(error)) console.warn('[seen]', error.message ?? error); return false; }
      if (data?.length) return true;
    }
  } catch (e) { console.warn('[seen]', (e as Error).message); }
  return false;
}

export class LastSeenUnavailable extends Error { constructor() { super('last_seen_unavailable'); } }

/**
 * El dueño enciende o apaga. Registra el consentimiento solo si el valor cambia.
 * Apagar: primero se apaga y se borra la hora (efecto inmediato, sin rastro), después se registra.
 * Encender: primero se registra (sin registro no se enciende); sin 023/021 -> LastSeenUnavailable.
 */
export async function setLastSeen(sub: string, value: boolean, now = Date.now()): Promise<{ show: boolean; recorded: boolean }> {
  const cur = await lastSeenStateOf(sub);
  const record = async () => {
    const { error } = await db().from('last_seen_consents').insert({ user_id: sub, value, text_version: LAST_SEEN_TEXT_VERSION, created_at: new Date(now).toISOString() });
    return error;
  };
  if (!value) {
    const { error } = await db().from('seller_profiles').update({ show_last_seen: false, last_seen_at: null }).eq('sub', sub);
    if (error && !missingColumn(error)) throw error;
    if (!cur.show) return { show: false, recorded: false }; // ya estaba apagado: nada que registrar
    const e = await record();
    if (e) console.warn('[consent] no se registró el retiro', e.message ?? e); // igual queda apagado
    return { show: false, recorded: !e };
  }
  if (cur.show) return { show: true, recorded: false };
  if (!cur.available) throw new LastSeenUnavailable();
  const e = await record();
  if (e) { if (missingTable(e)) throw new LastSeenUnavailable(); throw e; }
  const { error } = await db().from('seller_profiles').update({ show_last_seen: true, last_seen_at: new Date(now).toISOString() }).eq('sub', sub);
  if (error) {
    await db().from('last_seen_consents').insert({ user_id: sub, value: false, text_version: LAST_SEEN_TEXT_VERSION, created_at: new Date(now + 1).toISOString() }); // deshace
    if (missingColumn(error)) throw new LastSeenUnavailable();
    throw error;
  }
  return { show: true, recorded: true };
}

/** Rango público de varios perfiles (máx. 60). Solo los que consintieron; los demás no aparecen. Nunca lanza. */
export async function activityBySlug(slugs: string[], now = Date.now()): Promise<Record<string, Activity>> {
  const out: Record<string, Activity> = {};
  if (!slugs.length) return out;
  try {
    const { data, error } = await db().from('seller_profiles').select('sub, store_slug, last_seen_at, show_last_seen').in('store_slug', slugs.slice(0, 60)).eq('show_last_seen', true);
    if (error || !data?.length) return out;
    const c = await consentsOf((data as any[]).map((r) => r.sub));
    if (!c.ok) return out;
    for (const r of data as any[]) {
      if (r.show_last_seen !== true || c.latest.get(r.sub) !== true) continue;
      const a = activityOf(r.last_seen_at, true, now);
      if (a) out[r.store_slug] = a;
    }
  } catch (e) { console.warn('[activity]', (e as Error).message); }
  return out;
}
