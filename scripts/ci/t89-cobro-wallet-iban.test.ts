// (89) Dónde cobra el vendedor (029): USDC a su wallet Stellar (valida G…, cuenta y trustline; sin trustline avisa y cae a la
// cuenta de Meteorito) o Cuenta IBAN (el escrow libera a 'platform' y queda en la cola manual del admin con "Marcar como
// pagado"). Sin la migración 029: todo como antes (choice:false, receiver = cuenta del vendedor). Unit: DB, Horizon y cadena falsas.
import { readFileSync } from 'node:fs';
import { Account, Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __setChainForTests, approveAndRelease } from '../../api/_lib/escrow';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { __resetPayoutChoiceCache, netUsdc, receiverFor, savePayoutRoute, sellerPayee } from '../../api/_lib/payoutChoice';
import { resolveOrderDispute } from '../../api/_lib/disputeResolve';
import { stellarAddressError } from '../../lib/payout';
import { payoutView } from '../../api/_lib/payout';
import store from '../../api/store/index';
import dispute from '../../api/escrow/dispute';

const MASTER = 'bobbyaliensshop@gmail.com';
const IBAN = 'CR05015202001026284066';
const ISSUER = process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
/** Sin 029: seller_payout existe (011) pero sin columnas nuevas; payout_queue no existe. */
function without029(db: any) {
  const from = db.from;
  db.from = (t: string) => {
    if (t !== 'payout_queue' && t !== 'seller_payout') return from(t);
    const q0 = from(t);
    const missing = t === 'payout_queue' ? { code: '42P01', message: 'relation "public.payout_queue" does not exist' } : { code: '42703', message: 'column seller_payout.payout_method does not exist' };
    let cols = '*'; let payload: any = null;
    const q: any = new Proxy(q0, { get: (o, k) => {
      if (k === 'select') return (c = '*') => { cols = c; o.select(c); return q; };
      if (k === 'upsert' || k === 'insert' || k === 'update') return (p: any, x?: any) => { payload = p; o[k](p, x); return q; };
      const bad = () => t === 'payout_queue' || /payout_method|stellar_address/.test(cols) || (payload && ('payout_method' in payload || 'stellar_address' in payload));
      if (k === 'then') return (ok: any, ko: any) => (bad() ? Promise.resolve({ data: null, error: missing }) : Promise.resolve(o)).then(ok, ko);
      if (k === 'maybeSingle' || k === 'single') return async () => (bad() ? { data: null, error: missing } : o[k]());
      const v = o[k]; return typeof v === 'function' ? (...a: any[]) => { v(...a); return q; } : v;
    } });
    return q;
  };
  return db;
}

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app';
  const platform = Keypair.random().publicKey(); const prevPlat = process.env.PLATFORM_PUBLIC; process.env.PLATFORM_PUBLIC = platform;
  const ready = Keypair.random().publicKey(), noTrust = Keypair.random().publicKey(), cavos = Keypair.random().publicKey(), ghost = Keypair.random().publicKey();
  const usdc = [{ asset_code: 'USDC', asset_issuer: ISSUER, balance: '0' }];
  const accounts: Record<string, any> = { [ready]: { balances: usdc }, [noTrust]: { balances: [] }, [cavos]: { balances: usdc }, [platform]: { balances: usdc } };
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => {
    if (!accounts[a]) throw Object.assign(new Error('not found'), { name: 'NotFoundError', response: { status: 404 } });
    return Object.assign(new Account(a, '1'), accounts[a]);
  } }) as any);
  const prevEnv = { a: process.env.APPROVER_SECRET, r: process.env.RELEASE_SIGNER_SECRET, adm: process.env.ADMIN_EMAILS };
  process.env.ADMIN_EMAILS = MASTER;
  process.env.APPROVER_SECRET ??= Keypair.random().secret(); process.env.RELEASE_SIGNER_SECRET ??= Keypair.random().secret(); // la cadena es falsa
  const seller = await token({ sub: 'seller-sub' });
  const call = async (h: any, tok: string, body: any) => { const r = res(); await h(req(tok, body), r); return r; };
  try {
    /* ---------- Validación ---------- */
    t.check('dirección: vacía, sin G, largo y caracteres -> mensajes cortos', !!stellarAddressError('') && /empieza con G/.test(stellarAddressError('XABC')!) && /faltan/.test(stellarAddressError('GABC')!) && stellarAddressError(ready) === null);
    t.check('vista: método wallet, IBAN opcional, sin IBAN completo', (() => { const v = payoutView({ payout_method: 'wallet', stellar_address: ready, iban: IBAN, holder_name: 'Ana' }); return v.method === 'wallet' && v.stellar_address === ready && v.iban_last4 === '4066' && !JSON.stringify(v).includes(IBAN); })());
    t.check('vista vieja (011, sin método) = iban', payoutView({ iban: IBAN, holder_name: 'Ana' }).method === 'iban');

    /* ---------- Con 029 ---------- */
    const db = fakeDb(); __setDbForTests(db as any); __resetPayoutChoiceCache();
    let r = await call(store, seller, { action: 'payout_get' });
    t.check('payout_get con 029: choice:true, sin cuenta', r.code === 200 && r.body.choice === true && r.body.payout === null, JSON.stringify(r.body));
    r = await call(store, seller, { action: 'payout_check', stellar_address: noTrust });
    t.check('payout_check: sin trustline USDC -> no_trustline', r.code === 200 && r.body.state === 'no_trustline');
    r = await call(store, seller, { action: 'payout_check', stellar_address: ghost });
    t.check('payout_check: cuenta inexistente -> no_account', r.body.state === 'no_account');
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: 'GBAD' });
    t.check('wallet inválida -> 400 bad_stellar_address', r.code === 400 && r.body.code === 'bad_stellar_address');
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: ready.slice(0, 55) + (ready.endsWith('A') ? 'B' : 'A') });
    t.check('checksum malo -> 400', r.code === 400);
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: ghost });
    t.check('wallet sin cuenta en Stellar -> 400 wallet_no_account (no se guarda)', r.code === 400 && r.body.code === 'wallet_no_account' && !(db.tables.seller_payout ?? []).length);
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: platform });
    t.check('la wallet de la plataforma no se acepta', r.code === 400);
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: noTrust.toLowerCase() });
    t.check('wallet sin trustline: se guarda y avisa (state no_trustline)', r.code === 200 && r.body.state === 'no_trustline' && r.body.payout.method === 'wallet' && db.tables.seller_payout[0].stellar_address === noTrust, JSON.stringify(r.body));
    const o = { id: 'o1', slug: 'cob001', seller_user_id: 'seller-sub', seller_address: cavos, amount_usdc: 2.006, price_crc: 1020 };
    let rc = await receiverFor(o);
    t.check('deploy con wallet sin trustline -> cae a la cuenta de Meteorito (la venta no se rompe)', rc.route === 'cavos' && rc.address === cavos && /no_trustline/.test(rc.note ?? ''));
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: ready });
    rc = await receiverFor(o);
    t.check('wallet lista -> receiver del escrow = wallet del vendedor', r.code === 200 && r.body.state === 'ready' && rc.route === 'wallet' && rc.address === ready);
    r = await call(store, seller, { action: 'payout_set', iban: IBAN, holder_name: 'Valeria Mora' });
    rc = await receiverFor(o);
    t.check('Cuenta IBAN -> receiver = wallet platform (pago manual) y se conserva la wallet guardada', r.code === 200 && r.body.payout.method === 'iban' && rc.route === 'iban' && rc.address === platform && db.tables.seller_payout[0].stellar_address === ready);
    accounts[platform] = { balances: [] };
    t.check('platform sin trustline -> cae a la cuenta de Meteorito', (await receiverFor(o)).route === 'cavos');
    accounts[platform] = { balances: usdc };
    t.check('sin elección -> cuenta de Meteorito (como siempre)', (await receiverFor({ ...o, seller_user_id: 'otro' })).address === cavos);
    t.check('deployFor usa receiverFor (receiver = payee.address)', /receiver: payee\.address/.test(readFileSync('api/_lib/escrow.ts', 'utf8')));

    // Release a 'platform' -> cola IBAN
    db.tables.orders.push({ ...o, status: 'fondeado', delivery_mode: 'cara_a_cara', contract_id: 'C' + 'A'.repeat(55), pin_attempts: 0 });
    await savePayoutRoute('o1', { route: 'iban', address: platform });
    const order = db.tables.orders[0];
    t.check('ruta guardada en el pedido + order_events', order.payout_method === 'iban' && order.payout_address === platform && db.tables.order_events.some((e: any) => e.kind === 'payout_route'));
    let approved = false;
    __setChainForTests({ releaseGuard: async () => ({ disputed: false, released: false, resolved: false, approved } as any), approveMilestone: async () => { approved = true; return { hash: 'a'.repeat(64) } as any; },
      getBalance: async () => 2.006, releaseFunds: async () => ({ hash: 'f'.repeat(64) } as any) });
    await approveAndRelease({ ...order }, 'buyer_confirm');
    const q = db.tables.payout_queue ?? [];
    t.check('liberado con Cuenta IBAN -> fila "pendiente" en la cola con IBAN, titular y monto neto', q.length === 1 && q[0].state === 'pendiente' && q[0].iban === IBAN && q[0].holder_name === 'Valeria Mora' && q[0].amount_usdc === netUsdc(2.006) && q[0].released_tx === 'f'.repeat(64), JSON.stringify(q[0]));

    // Admin
    const adminTok = await token({ sub: 'admin-sub', email: MASTER });
    r = await call(dispute, seller, { action: 'admin_payouts' });
    t.check('admin_payouts: no admin -> 404', r.code === 404, String(r.code));
    r = await call(dispute, adminTok, { action: 'admin_payouts' });
    t.check('admin_payouts: lista con estado, IBAN completo (solo admin) y producto', r.code === 200 && r.body.available && r.body.counts.pendiente === 1 && r.body.payouts[0].iban === IBAN, JSON.stringify(r.body).slice(0, 200));
    r = await call(dispute, adminTok, { action: 'admin_payout_paid', slug: 'cob001', note: '' });
    t.check('Marcar como pagado sin nota -> 400', r.code === 400 && r.body.code === 'note_required');
    r = await call(dispute, adminTok, { action: 'admin_payout_paid', slug: 'cob001', note: 'Transferencia 88412' });
    t.check('Marcar como pagado: estado pagado, quién, cuándo y nota + order_events', r.code === 200 && q[0].state === 'pagado' && q[0].paid_by === MASTER && q[0].note === 'Transferencia 88412' && db.tables.order_events.some((e: any) => e.kind === 'payout_paid'));
    r = await call(dispute, adminTok, { action: 'admin_payout_paid', slug: 'cob001', note: 'otra vez' });
    t.check('marcar dos veces: idempotente (already)', r.code === 200 && r.body.already === true && q[0].note === 'Transferencia 88412');

    // Disputa: la parte del vendedor va a payout_address y se encola
    const db2 = fakeDb(); __setDbForTests(db2 as any);
    db2.tables.seller_payout = [{ sub: 'seller-sub', payout_method: 'iban', iban: IBAN, holder_name: 'Valeria Mora' }];
    const od = { id: 'o2', slug: 'cob002', status: 'en_disputa', seller_user_id: 'seller-sub', seller_address: cavos, buyer_address: ready, buyer_user_id: 'buyer', amount_usdc: 2, price_crc: 1020, fx_crc_per_usdc: 510, contract_id: 'C' + 'B'.repeat(55), payout_method: 'iban', payout_address: platform };
    db2.tables.orders.push({ ...od }); db2.tables.disputes.push({ order_id: 'o2', state: 'open' });
    let dist: any[] = [];
    __setChainForTests({ releaseGuard: async () => ({ disputed: true } as any), getBalance: async () => 2, resolveDispute: async (_c: string, _s: string, d: any) => { dist = d; return { hash: 'e'.repeat(64) } as any; } });
    await resolveOrderDispute({ ...od }, 'S', 50);
    t.check('disputa 50/50: parte del vendedor a payout_address (platform), comprador a su dirección', dist.some((d) => d.address === platform) && dist.some((d) => d.address === ready) && !dist.some((d) => d.address === cavos), JSON.stringify(dist));
    t.check('disputa con Cuenta IBAN: la parte del vendedor queda en la cola', (db2.tables.payout_queue ?? []).length === 1 && db2.tables.payout_queue[0].amount_usdc === netUsdc(1));
    t.check('sellerPayee sin 029 = seller_address', sellerPayee({ seller_address: cavos }) === cavos);

    /* ---------- Sin 029 ---------- */
    const db3 = without029(fakeDb()); __setDbForTests(db3 as any); __resetPayoutChoiceCache();
    r = await call(store, seller, { action: 'payout_get' });
    t.check('sin 029: payout_get choice:false', r.code === 200 && r.body.choice === false, JSON.stringify(r.body));
    r = await call(store, seller, { action: 'payout_set', iban: IBAN, holder_name: 'Valeria Mora' });
    t.check('sin 029: guardar Cuenta IBAN sigue funcionando (como 011)', r.code === 200 && r.body.payout.iban_last4 === '4066' && db3.tables.seller_payout?.[0]?.iban === IBAN && !('payout_method' in db3.tables.seller_payout[0]), JSON.stringify(r.body));
    r = await call(store, seller, { action: 'payout_set', method: 'wallet', stellar_address: ready });
    t.check('sin 029: wallet -> 503 payout_unavailable', r.code === 503 && r.body.code === 'payout_unavailable');
    rc = await receiverFor(o);
    t.check('sin 029: receiver = cuenta de Meteorito', rc.route === 'cavos' && rc.address === cavos);
    r = await call(dispute, adminTok, { action: 'admin_payouts' });
    t.check('sin 029: admin_payouts available:false (sin error)', r.code === 200 && r.body.available === false);
    db3.tables.orders.push({ id: 'o3', slug: 'cob003', status: 'fondeado', delivery_mode: 'cara_a_cara', seller_user_id: 'seller-sub', seller_address: cavos, amount_usdc: 2, contract_id: 'C' + 'C'.repeat(55), pin_attempts: 0 });
    approved = false;
    __setChainForTests({ releaseGuard: async () => ({ disputed: false, released: false, resolved: false, approved } as any), approveMilestone: async () => { approved = true; return { hash: 'a'.repeat(64) } as any; },
      getBalance: async () => 2, releaseFunds: async () => ({ hash: '9'.repeat(64) } as any) });
    const rel = await approveAndRelease({ ...db3.tables.orders[0] }, 'buyer_confirm');
    t.check('sin 029: liberar funciona igual y no toca la cola', rel.releasedTx === '9'.repeat(64) && !db3.tables.payout_queue);

    /* ---------- Copy ---------- */
    const src = readFileSync('components/Payout.tsx', 'utf8') + readFileSync('app/admin/pagos.tsx', 'utf8');
    const seller_copy = readFileSync('components/Payout.tsx', 'utf8');
    t.check('copy del vendedor sin palabras prohibidas (seguro, garantía, verificado, empresa, fintech, banco, billetera, proteg*)', !/\b(segur[oa]|garant\w*|verificad[oa]|empresa|fintech|banco|billetera|proteg\w*)\b/i.test(seller_copy), seller_copy.match(/\b(segur[oa]|garant\w*|verificad[oa]|empresa|fintech|banco|billetera|proteg\w*)\b/i)?.[0]);
    t.check('no promete depósitos automáticos a la Cuenta IBAN', !/autom[áa]tic/i.test(seller_copy) && /a mano/.test(seller_copy));
    t.check('copy en tuteo (sin voseo)', !/\b(podés|tenés|querés|elegí|pegá|revisá|agregá|activala)\b/i.test(src));
    t.check('admin: "Pendiente pagar al banco" y "Marcar como pagado"', /Pendiente pagar al banco/.test(src) && /Marcar como pagado/.test(src));
  } finally {
    __setChainForTests(null); __setHorizonForTests(() => { throw new Error('reset'); });
    if (prevEnv.adm === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = prevEnv.adm;
    if (prevEnv.a === undefined) delete process.env.APPROVER_SECRET; if (prevEnv.r === undefined) delete process.env.RELEASE_SIGNER_SECRET;
    if (prevPlat === undefined) delete process.env.PLATFORM_PUBLIC; else process.env.PLATFORM_PUBLIC = prevPlat;
  }
}
