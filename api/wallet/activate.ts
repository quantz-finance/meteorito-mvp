// POST /api/wallet/activate { step: 'nonce'|'bind'|'status'|'prepare'|'submit', proof, signedXdr? }  (Bearer JWT Cavos)
// Deja la wallet Cavos del vendedor lista para recibir USDC (cuenta + trustline) con reservas patrocinadas por la platform.
// prepare: devuelve XDR sin firmar (o ready). submit: valida forma exacta + firma del vendedor, firma la platform y envía.
import { json, fail } from '../_lib/db';
import { trackApiError } from '../_lib/analytics';
import { env } from '../_lib/env';
import { requireCavosUser, requireAddressProof, HttpError, issueSessionNonce, bindWalletIfFresh, requireBindProof } from '../_lib/auth';
import { relinkWallet, cancelUnfundedListing } from '../_lib/relink';
import { walletState, buildActivationTx, assertActivationConfig, validateActivationTx, signAndSubmitActivation } from '../_lib/wallet';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    // step 'nonce': nonce de un uso (5 min, del sub) para renovar un token vencido o para 'bind'; token fresco o vencido ≤ ventana (aquí para no sumar otra función en Vercel).
    if (req.body?.step === 'nonce') return json(res, 200, { nonce: await issueSessionNonce(req) });
    const user = await requireCavosUser(req);
    // step 'bind': solo con token FRESCO liga sub -> wallet si no hay binding (idempotente). Sin acción on-chain.
    if (req.body?.step === 'bind') {
      if (user.renewed) throw Object.assign(new HttpError(401, 'Tu sesión venció. Vuelve a cargar la página para continuar.'), { code: 'session_expired' });
      const r = await bindWalletIfFresh(user, await requireBindProof(user, req.body?.proof));
      return json(res, 200, { bound: r !== 'other_wallet', relinkRequired: r === 'other_wallet' });
    }
    if (req.body?.step === 'relink') return json(res, 200, await relinkWallet(user, req.body?.proof));
    if (req.body?.step === 'cancel_listing') return json(res, 200, await cancelUnfundedListing(user, req.body?.slug));
    env.network(); // STELLAR_NETWORK != testnet -> error (solo testnet)
    assertActivationConfig(); // error claro (con nombres de env) antes de tocar Horizon
    const { step, proof, signedXdr } = req.body ?? {};
    const address = await requireAddressProof(proof, 'wallet', 'activate');
    await bindWalletIfFresh(user, address); // liga sub -> wallet solo con token fresco
    const state = await walletState(address);
    if (state === 'ready') return json(res, 200, { ready: true });
    if (step === 'status') return json(res, 200, { ready: false, state });
    if (step === 'prepare') return json(res, 200, { ready: false, state, unsignedXdr: (await buildActivationTx(address, state)).toXDR() });
    if (step === 'submit') {
      if (typeof signedXdr !== 'string' || signedXdr.length > 10000) throw new HttpError(400, 'XDR inválido');
      const hash = await signAndSubmitActivation(validateActivationTx(signedXdr, address));
      return json(res, 200, { ready: (await walletState(address)) === 'ready', hash });
    }
    throw new HttpError(400, 'step inválido');
  } catch (e: any) { await trackApiError('activate', e, { step: typeof req.body?.step === 'string' ? req.body.step.slice(0, 16) : 'none' }); return fail(res, e); }
}
