// Límites de riesgo (punto 9): tope por pedido, gasto del comprador en 24 h, velocity por hora y señales
// (cuenta nueva con monto alto, monto atípico, ráfaga). Configurable en app_flags (027) y, por encima, con env.
// Sin 050 rigen los defaults de este archivo. Un bloqueo de persona queda en app_flags (clave rb_<hash>).
// La velocity reusa public.rate_limit_hit (037). Si esa función no está, se cuentan filas.
// Publicar (action order) es fail-closed si la base falla. Pagar es fail-open: un timeout no puede dejar
// el dinero a medias. El cliente solo ve un 403 genérico, sin umbrales ni motivos.
import { HttpError } from './auth';
import { db, logEvent } from './db';
import { clientIp } from './fbimport';
import { missingColumn } from './listings';
import { isMissingTable } from './push';
import { rateKey } from './rateLimit';

export const RISK_DENIED = 'No pudimos completar esto. Intenta más tarde.';
/** Misma N por IP que por persona, multiplicada: una IP compartida (CGNAT, Wi-Fi) no choca con el tope de una sola persona. */
export const RISK_IP_FACTOR = 4;
const CHECK_MS = 1500;
/** Gasto del comprador: fondeado o con el pago en curso. Un start abandonado ('creado') no entra. */
const SPEND_STATUSES = ['escrow_creado', 'fondeado', 'enviado', 'entregado', 'liberado', 'en_disputa', 'resuelto'];

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
  /** order = publicar link o invitación; pay = empezar un pago (no liquidar ni sondear). */
  action: 'order' | 'pay';
  amountCrc: number;
  /** sub de Cavos o guest:<hash>. Nunca la llave de invitado ni una IP. */
  actor: string;
  orderId?: string | null;
  /** false = revalida topes y bloqueo sin sumar velocity (reabrir un escrow que ya existe). */
  count?: boolean;
}

const denied = (): never => { throw Object.assign(new HttpError(403, RISK_DENIED), { code: 'unavailable' }); };
const dayAgoMs = () => Date.now() - 86_400_000;
const dayAgo = () => new Date(dayAgoMs()).toISOString();

/** Clave de app_flags para un bloqueo de persona. HMAC, cabe en el check de 027 (2–60). Nunca una IP. */
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

type Row = { id?: string; price_crc?: number; created_at?: string; status?: string; funded_at?: string | null; funded_tx?: string | null; contract_id?: string | null };
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
function expiredBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const until = (value as any).until;
  if (until == null) return false;
  const t = Date.parse(String(until));
  return Number.isFinite(t) && t <= Date.now();
}

async function record(kind: 'risk_limit' | 'risk_velocity' | 'risk_signal' | 'risk_block', orderId: string | null | undefined, detail: Record<string, unknown>) {
  console.warn('[risk]', JSON.stringify({ kind, ...detail }));
  if (orderId) await logEvent(orderId, kind, detail);
}

/** Bloqueo de persona. Con tope de tiempo: un upsert colgado no puede frenar el request. Nunca guarda una IP. */
async function blockFor(subjects: string[], reason: string, hours: number) {
  const until = new Date(Date.now() + hours * 3_600_000).toISOString();
  for (const subject of subjects) {
    if (!subject || subject.startsWith('ip:')) continue;
    try {
      const { error } = await timed(Promise.resolve(db().from('app_flags').upsert(
        { key: blockKey(subject), value: { until, reason }, updated_at: new Date().toISOString(), updated_by: 'risk' },
        { onConflict: 'key' },
      )));
      if (error && !isMissingTable(error)) console.warn('[risk] bloqueo no guardado', error.code ?? 'db');
    } catch (e: any) { console.warn('[risk] bloqueo no guardado', e?.code ?? 'timeout'); }
  }
}

/** Borra rb_* vencidos (lote corto). Best-effort: si falla, el chequeo sigue. */
async function sweepExpired() {
  try {
    const { data, error } = await timed(Promise.resolve(db().from('app_flags').select('key, value').ilike('key', 'rb_%').limit(40)));
    if (error || !data?.length) return;
    const dead = (data as { key?: string; value?: unknown }[]).filter((r) => r.key && expiredBlock(r.value)).map((r) => r.key as string);
    if (!dead.length) return;
    await timed(Promise.resolve(db().from('app_flags').delete().in('key', dead)));
  } catch { /* la fila vencida deja de contar igual: stillBlocked mira until */ }
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

/** Momento del pago: funded_at, si no el evento funded / escrow_deployed. Sin eso, un escrow en curso usa created_at. */
function payMoment(row: Row, eventAt: number | null): number | null {
  const funded = Date.parse(row.funded_at ?? '');
  if (Number.isFinite(funded)) return funded;
  if (eventAt != null) return eventAt;
  if (row.status === 'escrow_creado' && row.contract_id) {
    const t = Date.parse(row.created_at ?? '');
    if (Number.isFinite(t)) return t;
  }
  return null;
}

async function eventMoments(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const { data, error } = await timed(Promise.resolve(db().from('order_events').select('order_id, kind, created_at').in('order_id', ids).in('kind', ['funded', 'escrow_deployed']).limit(800)));
  if (error) {
    if (isMissingTable(error) || missingColumn(error)) return map;
    throw Object.assign(new Error('events'), { code: error.code ?? 'db' });
  }
  const best = new Map<string, { at: number; rank: number }>();
  for (const e of (data ?? []) as { order_id?: string; kind?: string; created_at?: string }[]) {
    const at = Date.parse(e.created_at ?? '');
    if (!e.order_id || !Number.isFinite(at)) continue;
    const rank = e.kind === 'funded' ? 2 : 1;
    const prev = best.get(e.order_id);
    if (!prev || rank > prev.rank || (rank === prev.rank && at > prev.at)) best.set(e.order_id, { at, rank });
  }
  for (const [id, v] of best) map.set(id, v.at);
  return map;
}

/** Gasto del comprador en 24 h: solo fondeado o en curso, por el momento del pago. Sin invitaciones ni starts abandonados. */
async function buyerSpend(actor: string, exclude: string | null): Promise<{ hits: Hit[]; capped: boolean }> {
  const full = 'id, price_crc, status, funded_at, funded_tx, contract_id, created_at';
  let r = await timed(Promise.resolve(db().from('orders').select(full).eq('buyer_user_id', actor).in('status', SPEND_STATUSES).limit(400)));
  if (r.error && missingColumn(r.error)) {
    r = await timed(Promise.resolve(db().from('orders').select('id, price_crc, status, created_at').eq('buyer_user_id', actor).in('status', SPEND_STATUSES).limit(400)));
  }
  if (r.error) {
    if (isMissingTable(r.error)) return { hits: [], capped: false };
    throw Object.assign(new Error('spend'), { code: r.error.code ?? 'db' });
  }
  const rows = (r.data ?? []) as Row[];
  const need = rows.filter((row) => row.id && row.id !== exclude && !row.funded_at).map((row) => row.id as string);
  const moments = await eventMoments(need);
  const since = dayAgoMs();
  const hits: Hit[] = [];
  for (const row of rows) {
    if (exclude && row.id === exclude) continue;
    const at = payMoment(row, row.id ? moments.get(row.id) ?? null : null);
    if (at == null || at < since) continue;
    hits.push({ at, price: Math.round(Number(row.price_crc)) || 0, id: row.id ?? '' });
  }
  return { hits, capped: rows.length >= 400 };
}

async function run(p: RiskInput): Promise<void> {
  if (process.env.RISK_LIMITS_DISABLED === '1') return;
  const actor = typeof p.actor === 'string' ? p.actor : '';
  const amount = Math.round(Number(p.amountCrc));
  if (!actor || actor.length > 200) return denied();
  // Un monto que no es número en un pago (pedido ya fondeado sin price_crc, p. ej.) no puede rechazar: el handler
  // ni siquiera debería llegar aquí. Si llega, se deja pasar y se anota.
  if (!Number.isFinite(amount) || amount < 0) {
    if (p.action === 'pay') { console.warn('[risk] fail-open', 'bad_amount'); return; }
    return denied();
  }
  await sweepExpired();
  const ip = clientIp(p.req);
  const keys = ['risk_limits', 'risk_blocks', blockKey(actor)];
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
  // Lista manual o rb_ de esta persona. Una IP no se bloquea (CGNAT / Wi-Fi compartido).
  if (subjectsOf(flags.risk_blocks).includes(actor) || stillBlocked(flags[blockKey(actor)])) {
    await record('risk_block', orderId, { ...base, reason: 'blocked' });
    return denied();
  }
  if (amount > cfg.max_order_crc) {
    await record('risk_limit', orderId, { ...base, reason: 'order_amount' });
    return denied(); // un solo intento sobre el tope: se rechaza, no se persiste
  }
  const since = dayAgo();
  let activity: Hit[];
  let capped = false;
  if (p.action === 'pay') {
    const spend = await buyerSpend(actor, orderId);
    activity = spend.hits; capped = spend.capped;
  } else {
    // Publicar: pedidos del vendedor. Invitación: filas del invitado. No se suman al gasto de un pago.
    const [mine, invites] = await Promise.all([
      rowsSince('orders', 'seller_user_id', actor, since),
      rowsSince('invitations', 'buyer_user_id', actor, since),
    ]);
    activity = [...hitsOf(mine, orderId), ...hitsOf(invites, null)];
    capped = activity.length >= 400;
  }
  const daily = activity.reduce((s, h) => s + h.price, 0);
  if (capped || daily + amount > cfg.max_daily_crc) {
    await record('risk_limit', orderId, { ...base, reason: 'daily_amount' });
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
      ip ? persistentHit(`${scope}.ip`, ip, perHour * RISK_IP_FACTOR, 3600) : Promise.resolve('down' as const),
      ip ? persistentHit(`${scope}.ip.burst`, ip, cfg.burst_count * RISK_IP_FACTOR, cfg.burst_window_sec) : Promise.resolve('down' as const),
    ]);
    const personHour = actorHour === 'deny' || (actorHour === 'down' && inHour + 1 > perHour);
    const personBurst = actorBurst === 'deny' || (actorBurst === 'down' && inBurst + 1 > cfg.burst_count);
    const ipDeny = ipHour === 'deny' || ipBurst === 'deny';
    if (personHour || personBurst || ipDeny) {
      const reason = personBurst ? 'burst' : 'velocity';
      const who = !personHour && !personBurst && ipDeny ? 'ip' : actor.startsWith('guest:') ? 'guest' : 'user';
      await record('risk_velocity', orderId, { ...base, reason, who });
      // La hora y la IP solo rechazan este intento (la ventana de 037 es el cooldown). La ráfaga sí bloquea a la persona.
      if (personBurst) await blockFor([actor], 'burst', cfg.block_hours);
      return denied();
    }
  }
  const signals: string[] = [];
  let score = 0;
  if (await accountIsNew(actor, orderId, cfg.new_account_hours) && amount > cfg.new_account_max_crc) { signals.push('new_account'); score += 3; }
  if (amount >= cfg.atypical_crc) { signals.push('atypical'); score += 2; }
  if (score >= 3) {
    // Señal de la persona, pero es un solo intento: se rechaza ese monto y no queda bloqueada 24 h.
    await record('risk_signal', orderId, { ...base, reason: signals[0], signals, score });
    return denied();
  }
  if (signals.length) await record('risk_signal', orderId, { ...base, reason: signals[0], signals, score, decision: 'allow' });
}

/**
 * Rechaza (403 genérico) si la persona o el invitado están bloqueados o se pasan de un tope.
 * En un pago, si la base no responde, se deja pasar y se anota: el dinero en curso no se traba.
 */
export async function assertRisk(p: RiskInput): Promise<void> {
  try { await run(p); }
  catch (e: any) {
    if (e instanceof HttpError) throw e;
    const open = p.action === 'pay';
    console.warn('[risk]', open ? 'fail-open' : 'fail-closed', e?.code ?? 'error');
    if (open) return;
    denied();
  }
}
