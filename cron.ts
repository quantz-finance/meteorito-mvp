// GET /api/escrow/cron  (Vercel Cron: Authorization: Bearer CRON_SECRET)
// Libera pedidos 'enviado' cuyo plazo de 24h venció sin disputa (reason=timeout). Reintenta 'entregado' sin liberar.
import { db, json, fail } from '../_lib/db';
import { env } from '../_lib/env';
import { approveAndRelease } from '../_lib/escrow';

export default async function handler(req: any, res: any) {
  try {
    if (req.headers.authorization !== `Bearer ${env.cronSecret()}`) return json(res, 401, { error: 'unauthorized' });
    const now = new Date().toISOString();
    const { data } = await db().from('orders').select('*')
      .or(`and(status.eq.enviado,auto_release_at.lte.${now}),status.eq.entregado`).limit(20);
    const out: any[] = [];
    for (const o of data ?? []) {
      try { out.push({ slug: o.slug, ...(await approveAndRelease(o, 'timeout')) }); }
      catch (e: any) { out.push({ slug: o.slug, error: e.message }); }
    }
    return json(res, 200, { processed: out });
  } catch (e) { return fail(res, e); }
}
