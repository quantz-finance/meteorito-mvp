// Límites de riesgo (punto 9): tope por pedido, tope por persona en 24 h, velocity por hora y señales
// (cuenta nueva con monto alto, monto atípico, ráfaga). Configurable en app_flags (027) y, por encima, con env.
// Sin 050 rigen los defaults de este archivo. El bloqueo queda en app_flags (clave rb_<hash>, sin IP en claro).
// La velocity reusa public.rate_limit_hit (037, api/_lib/rateLimit.ts). Si esa función no está, se cuentan
// filas de orders / invitations. A diferencia del límite por IP (fail-open), un bloqueo o un tope vencido
// rechaza la operación (fail-closed) con un mensaje genérico: el cliente no ve umbrales ni motivos.
import { HttpError } from './auth';
import { db, logEvent } from './db';
import { clientIp } from './fbimport';
import { missingColumn } from './listings';
import { isMissingTable } from './push';
import { rateKey } from './rateLimit';

export const RISK_DENIED = 'No pudimos completar esto. Intenta más tarde.';
/** Misma N por IP que por persona, multiplicada: una IP compartida no choca con el tope de una sola persona. */
export const RISK_IP_FACTOR = 4;
const CHECK_MS = 1500;

/** Defaults y semilla de la migración 050 (mismo objeto). Montos en colones. */
export const DEFAULT_RISK = {
  enabled: true,
  max_order_crc: 5_000_000,
  max_daily_crc: 15_000_000,
  orders_per_hour: 20,
  pays_per_hour: 30,
  new_account_hours: 48,
  new_account_max_crc: 1_500_000,
  atypical_crc: 2_000_000,
  burst_count: 8,
  burst_window_sec: 600,
  block_hours: 24,
};
export type RiskConfig = { -readonly [K in keyof typeof DEFAULT_RISK]: (typeof DEFAULT_RISK)[K] extends boolean ? boolean : (typeof DEFAULT_RISK)[K] };

const ENV_KEYS: Record<keyof Omit<RiskConfig, 'enabled'>, string> = {
  max_order_crc: 'RISK_MAX_ORDER_CRC',
  max_daily_crc: 'RISK_MAX_DAILY_CRC',
  orders_per_hour: 'RISK_ORDERS_PER_HOUR',
  pays_per_hour: 'RISK_PAYS_PER_HOUR',
  new_account_hours: 'RISK_NEW_ACCOUNT_HOURS',
  new_account_max_crc: 'RISK_NEW_ACCOUNT_MAX_CRC',
  atypical_crc: 'RISK_ATYPICAL_CRC',
  burst_count: 'RISK_BURST_COUNT',
  burst_window_sec: 'RISK_BURST_WINDOW_SEC',
  block_hours: 'RISK_BLOCK_HOURS',
};
const RANGES: Record<keyof typeof ENV_KEYS, [number, number]> = {
  max_order_crc: [1_000, 50_000_000],
  max_daily_crc: [1_000, 500_000_000],
  orders_per_hour: [1, 1_000],
  pays_per_hour: [1, 1_000],
  new_account_hours: [1, 24 * 30],
  new_account_max_crc: [1_000, 50_000_000],
  atypical_crc: [1_000, 50_000_000],
  burst_count: [2, 1_000],
  burst_window_sec: [30, 86_400],
  block_hours: [1, 24 * 30],
};

export interface RiskInput {
  req: any;
  /** order = publicar link o invitación; pay = empezar o confirmar un pago. */
  action: 'order' | 'pay';
  amountCrc: number;
  /** sub de Cavos o guest:<hash>. Nunca la llave de invitado ni una IP. */
  actor: string;
  orderId?: string | null;
  /** false = revalida topes y bloqueo sin sumar velocity (consultas que se repiten: card_confirm, crypto_status). */
  count?: boolean;
}

const denied = (): never => { throw Object.assign(new HttpError(403, RISK_DENIED), { code: 'unavailable' }); };
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();
const ipSubject = (ip: string) => `ip:${ip}`;

/** Clave de app_flags para un bloqueo. HMAC, cabe en el check de 027 (2–60) y no lleva la IP. */
export function blockKey(subject: string): string {
  return 'rb_' + rateKey('risk.block', subject).slice(0, 40);
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}
function applyEnv(cfg: RiskConfig): RiskConfig {
  const out = { ...cfg };
  (Object.keys(ENV_KEYS) as (keyof typeof ENV_KEYS)[]).forEach((k) => {
    const n = intIn(process.env[ENV_KEYS[k]], RANGES[k][0], RANGES[k][1]);
    if (n !== undefined) (out as any)[k] = n;
  });
  return out;
}
function configFrom(value: unknown): RiskConfig {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const cfg: RiskConfig = { ...DEFAULT_RISK, enabled: src.enabled === false ? false : DEFAULT_RISK.enabled };
  (Object.keys(ENV_KEYS) as (keyof typeof ENV_KEYS)[]).forEach((k) => {
    const n = intIn(src[k], RANGES[k][0], RANGES[k][1]);
    if (n !== undefined) (cfg as any)[k] = n;
  });
  return applyEnv(cfg);
}

async function timed<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'risk_timeout' })), CHECK_MS); })]);
  } finally { if (timer) clearTimeout(timer); }
}

type Row = { id?: string; price_crc?: number; created_at?: string };
async function rowsSince(table: string, column: string, actor: string, since: string): Promise<Row[]> {
  const { data, error } = await timed(Promise.resolve(db().from(table).select('id, price_crc, created_at').eq(column, actor).gte('created_at', since).limit(400)));
  if (error) {
    if (isMissingTable(error) || missingColumn(error)) return [];
    throw Object.assign(new Error('rows'), { code: error.code ?? 'db' });
  }
  return (data ?? []) as Row[];
}

/** 'allow' | 'deny' si 037 respondió; 'down' si no hay función (se cuenta por filas). */
async function persistentHit(scope: string, subject: string, max: number, windowSec: number): Promise<'allow' | 'deny' | 'down'> {
  const client = db();
  if (typeof client.rpc !== 'function') return 'down';
  let r: any;
  try {
    r = await timed(Promise.resolve(client.rpc('rate_limit_hit', { p_key: rateKey(scope, subject), p_max: max, p_window_seconds: windowSec })));
  } catch (e: any) {
    if (e?.code === 'risk_timeout') throw e;
    return 'down';
  }
  if (r?.error) {
    const code = String(r.error.code ?? '');
    const msg = String(r.error.message ?? '');
    if (code === '42883' || code === 'PGRST202' || /rate_limit_hit|does not exist|schema cache/i.test(msg)) return 'down';
    throw Object.assign(new Error('rpc'), { code: code || 'rpc' });
  }
  const row = Array.isArray(r?.data) ? r.data[0] : r?.data;
  return row && row.allowed === false ? 'deny' : 'allow';
}

function subjectsOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? (value as any).subjects : null;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => typeof s === 'string' && s.length >= 1 && s.length <= 200);
}
function stillBlocked(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const until = (value as any).until;
  if (until == null) return true;
  const t = Date.parse(String(until));
  return Number.isFinite(t) && t > Date.now();
}

async function record(kind: 'risk_limit' | 'risk_velocity' | 'risk_signal' | 'risk_block', orderId: string | null | undefined, detail: Record<string, unknown>) {
  console.warn('[risk]', JSON.stringify({ kind, ...detail }));
  if (orderId) await logEvent(orderId, kind, detail);
}

async function blockFor(subjects: string[], reason: string, hours: number) {
  const until = new Date(Date.now() + hours * 3_600_000).toISOString();
  for (const subject of subjects) {
    const { error } = await db().from('app_flags').upsert(
      { key: blockKey(subject), value: { until, reason }, updated_at: new Date().toISOString(), updated_by: 'risk' },
      { onConflict: 'key' },
    );
    if (error && !isMissingTable(error)) console.warn('[risk] bloqueo no guardado', error.code ?? 'db');
  }
}

async function accountIsNew(actor: string, orderId: string | null, hours: number): Promise<boolean> {
  if (!actor.startsWith('guest:')) {
    const { data, error } = await timed(Promise.resolve(db().from('user_wallets').select('created_at').eq('sub', actor).maybeSingle()));
    if (error) {
      if (isMissingTable(error) || missingColumn(error)) return false;
      throw Object.assign(new Error('wallet'), { code: error.code ?? 'db' });
    }
    if (!data) return true;
    const t = Date.parse(data.created_at ?? '');
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < hours * 3_600_000;
  }
  const { data, error } = await timed(Promise.resolve(db().from('orders').select('id').eq('buyer_user_id', actor).limit(5)));
  if (error) {
    if (isMissingTable(error) || missingColumn(error)) return false;
    throw Object.assign(new Error('orders'), { code: error.code ?? 'db' });
  }
  return ((data ?? []) as { id?: string }[]).every((r) => !r.id || r.id === orderId);
}

interface Hit { at: number; price: number; id: string }
function hitsOf(rows: Row[], exclude: string | null): Hit[] {
  return rows.flatMap((r) => {
    const at = Date.parse(r.created_at ?? '');
    if (!Number.isFinite(at) || (exclude && r.id === exclude)) return [];
    return [{ at, price: Math.round(Number(r.price_crc)) || 0, id: r.id ?? '' }];
  });
}

async function run(p: RiskInput): Promise<void> {
  if (process.env.RISK_LIMITS_DISABLED === '1') return;
  const actor = typeof p.actor === 'string' ? p.actor : '';
  const amount = Math.round(Number(p.amountCrc));
  if (!actor || actor.length > 200 || !Number.isFinite(amount) || amount < 0) return denied();
  const ip = clientIp(p.req);
  const ipSub = ip ? ipSubject(ip) : null;
  const keys = ['risk_limits', 'risk_blocks', blockKey(actor), ...(ipSub ? [blockKey(ipSub)] : [])];
  const { data, error } = await timed(Promise.resolve(db().from('app_flags').select('key, value').in('key', keys)));
  if (error) {
    if (!isMissingTable(error)) throw Object.assign(new Error('flags'), { code: error.code ?? 'db' });
  }
  const flags: Record<string, unknown> = {};
  if (!error) for (const row of data ?? []) flags[row.key] = row.value;
  const cfg = configFrom(flags.risk_limits);
  if (!cfg.enabled) return;
  const orderId = p.orderId ?? null;
  const base = { action: p.action, amount_crc: amount };
  if (subjectsOf(flags.risk_blocks).includes(actor) || stillBlocked(flags[blockKey(actor)]) || (ipSub && stillBlocked(flags[blockKey(ipSub)]))) {
    await record('risk_block', orderId, { ...base, reason: 'blocked' });
    return denied();
  }
  if (amount > cfg.max_order_crc) {
    await record('risk_limit', orderId, { ...base, reason: 'order_amount' });
    await blockFor([actor], 'order_amount', cfg.block_hours);
    return denied();
  }
  const since = dayAgo();
  const column = p.action === 'order' ? 'seller_user_id' : 'buyer_user_id';
  const [mine, invites] = await Promise.all([
    rowsSince('orders', column, actor, since),
    rowsSince('invitations', 'buyer_user_id', actor, since),
  ]);
  const activity = [...hitsOf(mine, orderId), ...hitsOf(invites, null)];
  if (activity.length >= 400) {
    await record('risk_limit', orderId, { ...base, reason: 'daily_amount' });
    await blockFor([actor], 'daily_amount', cfg.block_hours);
    return denied();
  }
  const daily = activity.reduce((s, h) => s + h.price, 0);
  if (daily + amount > cfg.max_daily_crc) {
    await record('risk_limit', orderId, { ...base, reason: 'daily_amount' });
    await blockFor([actor], 'daily_amount', cfg.block_hours);
    return denied();
  }
  const count = p.count !== false;
  const perHour = p.action === 'order' ? cfg.orders_per_hour : cfg.pays_per_hour;
  const hourCut = Date.now() - 3_600_000;
  const burstCut = Date.now() - cfg.burst_window_sec * 1000;
  const inHour = activity.filter((h) => h.at >= hourCut).length;
  const inBurst = activity.filter((h) => h.at >= burstCut).length;
  if (count) {
    const scope = p.action === 'order' ? 'risk.order' : 'risk.pay';
    const [actorHour, actorBurst, ipHour, ipBurst] = await Promise.all([
      persistentHit(scope, actor, perHour, 3600),
      persistentHit(`${scope}.burst`, actor, cfg.burst_count, cfg.burst_window_sec),
      ipSub ? persistentHit(`${scope}.ip`, ip!, perHour * RISK_IP_FACTOR, 3600) : Promise.resolve('down' as const),
      ipSub ? persistentHit(`${scope}.ip.burst`, ip!, cfg.burst_count * RISK_IP_FACTOR, cfg.burst_window_sec) : Promise.resolve('down' as const),
    ]);
    const hourDeny = actorHour === 'deny' || ipHour === 'deny' || (actorHour === 'down' && inHour + 1 > perHour);
    const burstDeny = actorBurst === 'deny' || ipBurst === 'deny' || (actorBurst === 'down' && inBurst + 1 > cfg.burst_count);
    if (hourDeny || burstDeny) {
      const reason = burstDeny && !hourDeny ? 'burst' : 'velocity';
      const ipHit = ipHour === 'deny' || ipBurst === 'deny';
      const who = ipHit && actorHour !== 'deny' && actorBurst !== 'deny' ? 'ip' : actor.startsWith('guest:') ? 'guest' : 'user';
      await record('risk_velocity', orderId, { ...base, reason, who });
      await blockFor([actor, ...(ipHit && ipSub ? [ipSub] : [])], reason, cfg.block_hours);
      return denied();
    }
  }
  const signals: string[] = [];
  let score = 0;
  if (await accountIsNew(actor, orderId, cfg.new_account_hours) && amount > cfg.new_account_max_crc) { signals.push('new_account'); score += 3; }
  if (amount >= cfg.atypical_crc) { signals.push('atypical'); score += 2; }
  if (score >= 3) {
    await record('risk_signal', orderId, { ...base, reason: signals[0], signals, score });
    await blockFor([actor], signals[0], cfg.block_hours);
    return denied();
  }
  if (signals.length) await record('risk_signal', orderId, { ...base, reason: signals[0], signals, score, decision: 'allow' });
}

/** Rechaza (403 genérico) si la persona, el invitado o su IP están bloqueados o se pasan de un tope. */
export async function assertRisk(p: RiskInput): Promise<void> {
  try { await run(p); }
  catch (e: any) {
    if (e instanceof HttpError) throw e;
    console.warn('[risk] fail-closed', e?.code ?? 'error');
    denied();
  }
}
