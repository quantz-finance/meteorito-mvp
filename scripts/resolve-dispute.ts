// Resolución manual de disputas (testnet). Misma lógica que el panel admin (api/_lib/disputeResolve.ts): reparto on-chain,
// pedido/disputa actualizados, push a las dos partes y auditoría (source 'script').
// Uso: DISPUTE_RESOLVER_SECRET=S... npx tsx scripts/resolve-dispute.ts <slug> <buyerPct 0..100> ["nota"]
//   (más las env del backend: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TW_API_KEY)
import { orderBySlug } from '../api/_lib/db';
import { resolveFromScript } from '../api/_lib/disputeResolve';

const [slug, pct, note] = process.argv.slice(2);
const secret = process.env.DISPUTE_RESOLVER_SECRET;
if (!slug || pct === undefined || !secret) { console.error('uso: DISPUTE_RESOLVER_SECRET=... tsx scripts/resolve-dispute.ts <slug> <buyerPct> ["nota"]'); process.exit(1); }
const n = Number(pct);
if (!Number.isInteger(n) || n < 0 || n > 100) { console.error('buyerPct debe ser un entero 0..100'); process.exit(1); }
(async () => {
  const order = await orderBySlug(slug);
  console.log(JSON.stringify(await resolveFromScript(order, secret, n, note), null, 2));
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
