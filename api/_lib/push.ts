// Web Push (VAPID) a las dos partes de un pedido cuando cambia de estado. Best-effort: nunca rompe la operación real.
// Sin VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT, o sin la tabla push_subscriptions (migración 011), no hace nada.
import { db } from './db';

export interface PushOrder { slug: string; status: string; seller_user_id?: string | null; buyer_user_id?: string | null; brand?: string | null; model?: string | null }
export interface PushMsg { to: string; role: 'seller' | 'buyer'; title: string; body: string; url: string; tag: string }
export interface PushSub { endpoint: string; user_id: string; p256dh: string; auth: string }

const itemName = (o: PushOrder) => (`${o.brand ?? ''} ${o.model ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 40)) || 'tu artículo';

/** Textos por estado y por parte (tuteo, cortos). Pura: se prueba sin red. */
export function pushMessages(o: PushOrder): PushMsg[] {
  const it = itemName(o);
  const T: Record<string, { seller?: [string, string]; buyer?: [string, string] }> = {
    fondeado: { seller: ['¡Te pagaron!', `El dinero de ${it} está en custodia. Envíalo y toca "Ya lo envié".`], buyer: ['Pago recibido', `Tu pago de ${it} quedó en custodia. Te avisamos cuando el vendedor lo envíe.`] },
    enviado: { buyer: ['¡Va en camino!', `${it} ya fue enviado. Abre el pedido para ver tu código de entrega y dáselo al vendedor cuando lo recibas.`] },
    entregado: { seller: ['Entregado', `El comprador recibió ${it}. El pago se libera en breve.`] },
    liberado: { seller: ['¡Pago liberado!', `El dinero de ${it} ya es tuyo.`], buyer: ['Compra completada', `Gracias por comprar ${it}. Cuéntanos cómo te fue.`] },
    en_disputa: { seller: ['Disputa abierta', `El comprador reportó un problema con ${it}. Revisa el pedido.`], buyer: ['Disputa abierta', `Recibimos tu reporte de ${it}. Te avisamos cuando se resuelva.`] },
    resuelto: { seller: ['Disputa resuelta', `Ya hay una resolución para ${it}. Revisa el pedido.`], buyer: ['Disputa resuelta', `Ya hay una resolución para ${it}. Revisa el pedido.`] },
  };
  const t = T[o.status];
  if (!t) return [];
  const out: PushMsg[] = [];
  const url = `/p/${o.slug}`;
  if (t.seller && o.seller_user_id) out.push({ to: o.seller_user_id, role: 'seller', title: t.seller[0], body: t.seller[1], url, tag: `${o.slug}:${o.status}` });
  if (t.buyer && o.buyer_user_id && o.buyer_user_id !== o.seller_user_id) out.push({ to: o.buyer_user_id, role: 'buyer', title: t.buyer[0], body: t.buyer[1], url, tag: `${o.slug}:${o.status}` });
  return out;
}

export const vapid = () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY, subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
};

/** Envío real con web-push (se carga solo cuando hay algo que enviar). Devuelve el status HTTP del push service. */
export type Sender = (sub: PushSub, payload: string) => Promise<number>;
const webPushSender: Sender = async (sub, payload) => {
  const v = vapid()!;
  const wp: any = await import('web-push');
  const lib = wp.default ?? wp;
  try {
    const r = await lib.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
      { vapidDetails: v, TTL: 60 * 60 * 24, urgency: 'high', timeout: 4000 });
    return r?.statusCode ?? 201;
  } catch (e: any) { return e?.statusCode ?? 0; }
};

export interface PushDeps {
  send?: Sender;
  load?: (ids: string[]) => Promise<PushSub[]>;
  drop?: (endpoints: string[]) => Promise<void>;
  enabled?: () => boolean;
}
const isMissingTable = (e: any) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(String(e.message ?? '')));
const loadSubs = async (ids: string[]) => {
  const { data, error } = await db().from('push_subscriptions').select('endpoint, user_id, p256dh, auth').in('user_id', ids);
  if (error) { if (!isMissingTable(error)) console.warn('[push] lectura falló', error.message); return []; }
  return (data ?? []) as PushSub[];
};
const dropSubs = async (endpoints: string[]) => { await db().from('push_subscriptions').delete().in('endpoint', endpoints); };

/** Avisa a vendedor y comprador del nuevo estado. Nunca lanza; tarda como mucho ~5 s. Devuelve cuántos envíos salieron bien. */
export async function notifyOrder(o: PushOrder, deps: PushDeps = {}): Promise<number> {
  try {
    if (!(deps.enabled ?? (() => !!vapid()))()) return 0;
    const msgs = pushMessages(o);
    if (!msgs.length) return 0;
    const subs = await (deps.load ?? loadSubs)([...new Set(msgs.map((m) => m.to))]);
    if (!subs.length) return 0;
    const send = deps.send ?? webPushSender;
    const gone: string[] = [];
    let ok = 0;
    const jobs = subs.flatMap((s) => msgs.filter((m) => m.to === s.user_id).map(async (m) => {
      const code = await send(s, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }));
      if (code === 404 || code === 410) gone.push(s.endpoint); else if (code >= 200 && code < 300) ok++;
    }));
    await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 5000))]);
    if (gone.length) await (deps.drop ?? dropSubs)([...new Set(gone)]).catch(() => {});
    return ok;
  } catch (e: any) { console.warn('[push] no se envió', e?.message); return 0; }
}

/** Guarda una suscripción para cada identidad de la petición (vendedor y/o comprador). */
export function parseSubscription(v: any): { endpoint: string; p256dh: string; auth: string } | null {
  const endpoint = typeof v?.endpoint === 'string' ? v.endpoint : '';
  const p256dh = v?.keys?.p256dh, auth = v?.keys?.auth;
  if (!/^https:\/\/[^\s]{10,800}$/.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint, p256dh, auth };
}
export async function saveSubscription(ids: string[], sub: { endpoint: string; p256dh: string; auth: string }, userAgent?: string) {
  const rows = ids.map((user_id) => ({ ...sub, user_id, user_agent: (userAgent ?? '').slice(0, 200) || null, last_ok_at: new Date().toISOString() }));
  const { error } = await db().from('push_subscriptions').upsert(rows, { onConflict: 'endpoint,user_id' });
  if (error) throw error;
}
export async function deleteSubscription(ids: string[], endpoint: string) {
  const { error } = await db().from('push_subscriptions').delete().eq('endpoint', endpoint).in('user_id', ids);
  if (error) throw error;
}
export { isMissingTable };
