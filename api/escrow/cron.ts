// /api/escrow/cron
//  - Batch (pg_cron cada 5 min, Authorization: Bearer CRON_SECRET): libera pedidos 'enviado' con plazo vencido
//    (reason=timeout) y reintenta 'entregado' sin liberar.
//  - Respaldo sin auth: GET ?slug=xxxxxx (la página pública lo llama al cargar). Solo procesa ESE pedido y solo si ya venció.
// Idempotente: lock por fila (release_lock_until) + updates condicionados al status. Verificación on-chain en approveAndRelease.
import { db, json, fail } from '../_lib/db';
import { env } from '../_lib/env';
import { approveAndRelease } from '../_lib/escrow';

async function claim(id: string): Promise<boolean> {
  const now = new Date();
  const { data } = await db().from('orders').update({ release_lock_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq('id', id).or(`release_lock_until.is.null,release_lock_until.lt.${now.toISOString()}`).select('id');
  return !!data?.length;
}

async function processOrder(o: any) {
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
      const { data: o } = await db().from('orders').select('*').eq('slug', slug).eq('status', 'enviado').lte('auto_release_at', now).maybeSingle();
      return json(res, 200, o ? await processOrder(o) : { slug, due: false });
    }
    if (req.headers.authorization !== `Bearer ${env.cronSecret()}`) return json(res, 401, { error: 'unauthorized' });
    const { data } = await db().from('orders').select('*')
      .or(`and(status.eq.enviado,auto_release_at.lte.${now}),and(status.eq.entregado,released_tx.is.null)`).limit(20);
    const out = [];
    for (const o of data ?? []) out.push(await processOrder(o));
    return json(res, 200, { processed: out });
  } catch (e) { return fail(res, e); }
}
