// Re-link sub -> wallet. Solo si TODAS:
//  (1) Horizon responde 404 explícito para la wallet anterior (timeout/5xx/otro error -> no se reemplaza);
//  (2) no hay pedidos/links activos apuntando a la wallet anterior (409 wallet_has_active_items; los links nunca
//      fondeados se pueden cancelar con step 'cancel_listing');
//  (3) token FRESCO + nonce de servidor de un uso, firmado por la wallet NUEVA sobre relinkMessage;
//  (4) auditoría en wallet_relinks (migración 008).
import { db, advance, logEvent } from './db';
import { CavosUser, HttpError, consumeSignedNonce, sessionRef, boundWalletOf, rebindWallet } from './auth';
import { horizonAccountMissing } from './wallet';
import * as tw from './tw';

export const relinkMessage = (sub: string, nonce: string) => `meteorito:relink:${sessionRef(sub)}:${nonce}`;
const FINAL = new Set(['liberado', 'resuelto', 'cancelado']);
const fresh = (user: CavosUser) => { if (user.renewed) throw Object.assign(new HttpError(401, 'Vuelve a iniciar sesión para continuar.'), { code: 'fresh_login_required' }); };

export async function activeItemsFor(address: string): Promise<{ slug: string; status: string; role: 'seller' | 'buyer' }[]> {
  const out: { slug: string; status: string; role: 'seller' | 'buyer' }[] = [];
  for (const role of ['seller', 'buyer'] as const) {
    const { data, error } = await db().from('orders').select('slug,status').eq(`${role}_address`, address);
    if (error) throw new HttpError(503, 'No pudimos verificar tus pedidos. Intenta de nuevo.');
    for (const o of data ?? []) if (!FINAL.has(o.status)) out.push({ slug: o.slug, status: o.status, role });
  }
  return out;
}

export async function relinkWallet(user: CavosUser, proof: any): Promise<{ relinked: true; from: string; to: string }> {
  fresh(user);
  const to = await consumeSignedNonce(user, proof, relinkMessage(user.sub, String(proof?.nonce ?? '')), 'relink');
  const from = await boundWalletOf(user.sub);
  if (!from) throw Object.assign(new HttpError(409, 'No hay billetera anterior para reemplazar.'), { code: 'relink_not_needed' });
  if (from === to) throw Object.assign(new HttpError(409, 'Esta billetera ya está ligada a tu cuenta.'), { code: 'relink_not_needed' });
  if (!(await horizonAccountMissing(from))) {
    console.warn('[relink] rechazado: wallet anterior existe o Horizon no confirmó 404', JSON.stringify({ from: from.slice(0, 6) }));
    throw Object.assign(new HttpError(409, 'No podemos cambiar la billetera de tu cuenta en este momento.'), { code: 'old_wallet_not_confirmed_missing' });
  }
  const items = await activeItemsFor(from);
  if (items.length) {
    console.warn('[relink] rechazado: items activos', JSON.stringify(items));
    throw Object.assign(new HttpError(409, 'Antes de cambiar de billetera debes cancelar tus links o pedidos activos.'), { code: 'wallet_has_active_items', missing: items.map((i) => `${i.slug}:${i.status}:${i.role}`) });
  }
  const { error } = await db().from('wallet_relinks').insert({ sub: user.sub, old_wallet: from, new_wallet: to });
  if (error) throw new HttpError(503, 'No pudimos cambiar la billetera. Intenta de nuevo.'); // sin auditoría no hay re-link
  await rebindWallet(user.sub, to);
  console.warn('[relink] ok', JSON.stringify({ from: from.slice(0, 6), to: to.slice(0, 6) }));
  return { relinked: true, from, to };
}

/** Cancela un link propio NUNCA fondeado: 'creado' sin escrow, o 'escrow_creado' sin funded_tx, sin intento de ramp y saldo on-chain 0. */
export async function cancelUnfundedListing(user: CavosUser, slug: unknown) {
  fresh(user);
  if (typeof slug !== 'string' || !/^[a-z0-9]{6}$/.test(slug)) throw new HttpError(400, 'slug inválido');
  const { data: o } = await db().from('orders').select('*').eq('slug', slug).maybeSingle();
  if (!o) throw new HttpError(404, 'link no encontrado');
  if (o.seller_user_id !== user.sub) throw new HttpError(403, 'Solo el vendedor puede cancelar este link.');
  const no = () => Object.assign(new HttpError(409, 'Este pedido ya recibió un pago y no se puede cancelar aquí. Escríbenos a team@meteorito.app.'), { code: 'not_cancellable' });
  if (o.status === 'creado' && !o.contract_id) { /* ok */ }
  else if (o.status === 'escrow_creado' && !o.funded_tx) {
    const { data: ramp } = await db().from('ramp_mock_payments').select('order_id').eq('order_id', o.id);
    if ((ramp ?? []).length) throw no();
    const bal = await tw.getBalance(o.contract_id); // falla cerrado si no se puede leer
    if (bal > 0) throw no();
  } else throw no();
  await advance(o.id, o.status, { status: 'cancelado' });
  await logEvent(o.id, 'listing_cancelled', { reason: 'unfunded_by_seller' });
  return { cancelled: true, slug };
}
