// Ajustes globales de la app (migración 032, tabla app_settings: solo el servidor la lee y la escribe).
// demo_data_enabled: ¿se muestran los datos de EJEMPLO (productos, tiendas /t/<ejemplo>, ventas y tiendas sugeridas)?
//  - Apagado (default y estado normal): la app muestra SOLO usuarios, tiendas y publicaciones reales; el API no manda
//    ningún ejemplo y las tiendas de ejemplo responden 404.
//  - Encendido: los ejemplos se ven para todos.
//  - Lo cambia solo el admin maestro (api/escrow/dispute.ts, action admin_demo_data; 404 para el resto) y queda en
//    admin_audit (kind demo_toggle). Caché corta en memoria (DEMO_CACHE_MS) para no leer la base en cada pedido.
//  - Sin la migración o ante un error de la base: apagado. FEED_DEMO_PRODUCTS=0 (entorno) lo apaga siempre.
import { db } from './db';
import { HttpError } from './auth';
import { isMissingTable } from './push';
import { demoKilledByEnv } from './demoFlag';

export const DEMO_SETTING = 'demo_data_enabled';
export const DEMO_CACHE_MS = 30_000;
const ERROR_CACHE_MS = 5_000;
let cache: { v: boolean; until: number; client: unknown } | null = null;
/** Solo tests. */
export const __resetDemoDataCache = () => { cache = null; };

async function readSetting(): Promise<boolean> {
  const { data, error } = await db().from('app_settings').select('value').eq('key', DEMO_SETTING).maybeSingle();
  if (error) throw error;
  return (data as any)?.value === true;
}

/** ¿Se muestran los datos de ejemplo? (servidor). Caché ≤30 s; la invalida un cambio desde el admin. */
export async function demoDataOn(now = Date.now()): Promise<boolean> {
  if (demoKilledByEnv()) return false;
  const client = db();
  if (cache && cache.client === client && now < cache.until) return cache.v;
  let v = false; let ttl = DEMO_CACHE_MS;
  try { v = await readSetting(); }
  catch (e: any) { if (!isMissingTable(e)) { console.warn('[app_settings] lectura falló', e?.code ?? e?.message); ttl = ERROR_CACHE_MS; } }
  cache = { v, until: now + ttl, client };
  return v;
}

/** Admin: lee (sin `enabled`) o cambia el interruptor. Auditoría best-effort en admin_audit (kind demo_toggle). */
export async function adminDemoData(body: any, admin: { sub: string; email: string }) {
  const killed = demoKilledByEnv();
  if (body?.enabled === undefined) {
    let enabled = false; let available = true;
    try { enabled = await readSetting(); } catch (e: any) { if (isMissingTable(e)) available = false; else throw new HttpError(503, 'No pudimos leer el ajuste. Intenta de nuevo.'); }
    return { enabled, killed, available };
  }
  if (typeof body.enabled !== 'boolean') throw Object.assign(new HttpError(400, 'Valor inválido.'), { code: 'bad_value' });
  const enabled = body.enabled;
  let before: boolean | null = null;
  try { before = await readSetting(); } catch { /* sin fila */ }
  const { error } = await db().from('app_settings').upsert({ key: DEMO_SETTING, value: enabled, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    if (isMissingTable(error)) throw Object.assign(new HttpError(503, 'Falta la migración 032.'), { code: 'settings_unavailable' });
    throw new HttpError(503, 'No pudimos guardar el ajuste. Intenta de nuevo.');
  }
  cache = { v: enabled && !killed, until: Date.now() + DEMO_CACHE_MS, client: db() };
  const row = { kind: 'demo_toggle', admin_email: admin.email, target: DEMO_SETTING, detail: { enabled, before } };
  const { error: e2 } = await db().from('admin_audit').insert(row);
  if (e2) console.info('[admin-audit]', JSON.stringify(row), isMissingTable(e2) ? '(sin tabla 031)' : e2.code);
  return { enabled, killed, available: true };
}
