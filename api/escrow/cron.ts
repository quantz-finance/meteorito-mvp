// /api/escrow/cron
//  - Batch (pg_cron cada 5 min, Authorization: Bearer CRON_SECRET): libera pedidos 'enviado' (o 'fondeado' cara a cara) con plazo vencido
//    (reason=timeout) y reintenta 'entregado' sin liberar.
//  - Respaldo sin auth: GET ?slug=xxxxxx (la página pública lo llama al cargar). Solo procesa ESE pedido y solo si ya venció.
// Plazo real = releaseDueAt (nunca antes de shipped_at + 7 días): si auto_release_at quedó corto (env viejo de 10 min),
// se corrige en la fila y no se libera. Disputa y PIN bloqueado congelan la liberación (approveAndRelease).
// Disputas: con el flag disputes_auto_resolve encendido (apagado por defecto) resuelve las que una regla decide (api/_lib/disputeAdmin.ts).
// Idempotente: lock por fila (release_lock_until) + updates condicionados al status. Verificación on-chain en approveAndRelease.
import { db, json, fail, logEvent } from '../_lib/db';
import { env, releaseDueAt, releaseBlockedUntil } from '../_lib/env';
import { isFaceToFace } from '../_lib/agreement';
import { missingColumn } from '../_lib/listings';
import { approveAndRelease } from '../_lib/escrow';
import { notifyDueSoon } from '../_lib/buyerContact';
import { autoResolvePass } from '../_lib/disputeAdmin';

async function claim(id: string): Promise<boolean> {
  const now = new Date();
  const { data } = await db().from('orders').update({ release_lock_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq('id', id).or(`release_lock_until.is.null,release_lock_until.lt.${now.toISOString()}`).select('id');
  return !!data?.length;
}

async function processOrder(o: any) {
  if (o.status === 'enviado' || (o.status === 'fondeado' && isFaceToFace(o))) {
    const due = releaseDueAt(o);
    if (Date.parse(due) > Date.now() && due !== o.auto_release_at) { // plazo viejo/corto: se corrige y se espera
      await db().from('orders').update({ auto_release_at: due }).eq('id', o.id).eq('status', o.status);
      await logEvent(o.id, 'auto_release_extended', { from: o.auto_release_at ?? null, to: due });
    }
    // Extensión pendiente: congela hasta la respuesta o 24 h (no se guarda en auto_release_at).
    const until = releaseBlockedUntil(o);
    if (Date.parse(until) > Date.now()) return { slug: o.slug, due: false, dueAt: until };
  } else if (o.status !== 'entregado') return { slug: o.slug, skipped: o.status };
  if (!(await claim(o.id))) return { slug: o.slug, skipped: 'locked' };
  try { return { slug: o.slug, ...(await approveAndRelease(o, 'timeout')) }; }
  catch (e: any) { return { slug: o.slug, error: e.message }; }
  finally { await db().from('orders').update({ release_lock_until: null }).eq('id', o.id); }
}

export default async function handler(req: any, res: any) {
  try {
    const now = new Date().toISOString();
    const slug = req.query?.slug;
    if (typeof slug === 'string') {
      if (!/^[a-z0-9]{6}$/.test(slug)) return json(res, 400, { error: 'slug inválido' });
      const { data: o } = await db().from('orders').select('*').eq('slug', slug).in('status', ['enviado', 'fondeado']).lte('auto_release_at', now).maybeSingle();
      return json(res, 200, o ? await processOrder(o) : { slug, due: false });
    }
    if (req.headers.authorization !== `Bearer ${env.cronSecret()}`) return json(res, 401, { error: 'unauthorized' });
    const base = `and(status.eq.enviado,auto_release_at.lte.${now}),and(status.eq.entregado,released_tx.is.null)`;
    // Cara a cara vence desde el pago (sigue en 'fondeado'). Sin la migración 017 no hay delivery_mode: solo lo de antes.
    let { data, error } = await db().from('orders').select('*').or(`${base},and(status.eq.fondeado,delivery_mode.eq.cara_a_cara,auto_release_at.lte.${now})`).limit(20);
    if (error && missingColumn(error)) ({ data, error } = await db().from('orders').select('*').or(base).limit(20));
    if (error) throw error;
    const out = [];
    for (const o of data ?? []) out.push(await processOrder(o));
    // Avisos "el pago se libera en menos de 24 h" a compradores con contacto (028). Best-effort, deduplicado.
    const dueSoon = await notifyDueSoon(db());
    // Disputas: auto-resolución por reglas SOLO con el flag disputes_auto_resolve (apagado por defecto). Nunca tumba el cron.
    const disputes = await autoResolvePass().catch((e: any) => ({ skipped: 'error', resolved: [], errors: [String(e?.message ?? e).slice(0, 120)] }));
    return json(res, 200, { processed: out, disputes, due_soon_notices: dueSoon });
  } catch (e) { return fail(res, e); }
}
