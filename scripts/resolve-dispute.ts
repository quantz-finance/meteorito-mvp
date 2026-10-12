// Resolución manual de disputas (testnet). El secreto del dispute resolver NUNCA va a Vercel.
// Uso: DISPUTE_RESOLVER_SECRET=S... npx tsx scripts/resolve-dispute.ts <slug> <buyerPct 0..100>
//   (más las env del backend: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TW_API_KEY)
import { orderBySlug } from '../api/_lib/db';
import { resolveOrderDispute } from '../api/_lib/escrow';

const [slug, pct] = process.argv.slice(2);
const secret = process.env.DISPUTE_RESOLVER_SECRET;
if (!slug || pct === undefined || !secret) { console.error('uso: DISPUTE_RESOLVER_SECRET=... tsx scripts/resolve-dispute.ts <slug> <buyerPct>'); process.exit(1); }
(async () => {
  const order = await orderBySlug(slug);
  console.log(JSON.stringify(await resolveOrderDispute(order, secret, Number(pct)), null, 2));
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
