// Proceso hijo de t22: corre con EXPO_PUBLIC_DEMO_MODE=1 y un fetch que EXPLOTA ante cualquier llamada de red.
// Recorre el flujo completo usando las mismas funciones que usa la UI (api, getPublicOrder, ...). Imprime JSON.
import Module from 'node:module';
// El polyfill de URL de RN no carga en Node; no aporta nada a este test.
const origLoad = (Module as any)._load;
(Module as any)._load = function (req: string, ...rest: any[]) { return req === 'react-native-url-polyfill/auto' ? {} : origLoad.call(this, req, ...rest); };
const calls: string[] = [];
(globalThis as any).fetch = async (u: any) => { calls.push(String(u)); throw new Error('RED PROHIBIDA EN DEMO: ' + u); };
const out: Record<string, unknown> = {};
(async () => {
  const demo = await import('../../lib/demo');
  const { api } = await import('../../lib/api');
  const { createOrder, getPublicOrder, getSellerOrders } = await import('../../lib/orders');
  const { fetchBalances } = await import('../../lib/horizon');
  const { ensureWalletReady } = await import('../../lib/wallet');
  const { supabase, supabaseConfigured } = await import('../../lib/supabase');
  const { LEGAL } = await import('../../lib/legal');
  out.enabled = demo.DEMO_ENABLED; out.supabaseConfigured = supabaseConfigured;
  const mk = (role: 'seller' | 'buyer') => { demo.setDemoRole(role); return { address: role === 'seller' ? demo.DEMO_SELLER.address : demo.DEMO_BUYER.address, getAuthToken: () => 'demo-token', signMessage: async () => ({ publicKey: 'x', signature: 'y' }) } as any; };
  const seller = mk('seller');
  await ensureWalletReady(seller);
  const slug = await createOrder(seller, { category: 'celular', brand: 'Apple', model: 'iPhone 13', condition: 'Como nuevo', price_crc: 255000, description: '', identifier: '356938035643809', photos: [], checks: [] });
  out.slug = slug;
  out.afterCreate = (await getPublicOrder(slug))?.status;
  const buyer = mk('buyer');
  const start = await api(buyer, '/api/escrow/pay', { slug, step: 'start' });
  out.amount = start.amountUsdc;
  const funded = await api(buyer, '/api/escrow/pay', { slug, step: 'confirm_sinpe' });
  out.pinLen = String(funded.pin).length;
  const pubFunded: any = await getPublicOrder(slug);
  out.pinLeak = 'pin' in pubFunded; out.status2 = pubFunded.status; out.fundedTxLen = String(pubFunded.funded_tx).length; out.contractLen = String(pubFunded.contract_id).length;
  mk('seller'); // el vendedor marca enviado
  await api(seller, '/api/escrow/ship', { slug, evidence: { note: 'x' } });
  out.status3 = (await getPublicOrder(slug) as any).status;
  try { await api(seller, '/api/escrow/confirm', { slug, reason: 'pin', pin: '000000' }); out.badPin = 'accepted'; } catch (e: any) { out.badPin = e.code; }
  await api(seller, '/api/escrow/confirm', { slug, reason: 'pin', pin: funded.pin });
  const rel: any = await getPublicOrder(slug); out.status4 = rel.status; out.releasedTxLen = String(rel.released_tx).length;
  out.balance = (await fetchBalances(seller.address)).usdc;
  out.sellerOrders = (await getSellerOrders(seller)).length;
  // Disputa en otro pedido
  const s2 = await demo.demoSeed('enviado'); mk('buyer');
  await api(buyer, '/api/escrow/dispute', { slug: s2, reason: 'no_llego', description: null, evidence: [] });
  out.status5 = (await getPublicOrder(s2) as any).status;
  try { await supabase(); out.supabase = 'ok'; } catch { out.supabase = 'blocked'; }
  out.legalArbiter = JSON.stringify(LEGAL).includes('árbitro');
  out.fetchCalls = calls;
  console.log('RESULT ' + JSON.stringify(out));
})().catch((e) => { console.log('RESULT ' + JSON.stringify({ crash: String(e?.stack ?? e).slice(0, 600), calls })); });
