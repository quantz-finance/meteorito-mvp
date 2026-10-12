// POST /api/wallet/activate { step: 'status'|'prepare'|'submit', proof, signedXdr? }  (Bearer JWT Cavos)
// Deja la wallet Cavos del vendedor lista para recibir USDC (cuenta + trustline) con reservas patrocinadas por la platform.
// prepare: devuelve XDR sin firmar (o ready). submit: valida forma exacta + firma del vendedor, firma la platform y envía.
import { json, fail } from '../_lib/db';
import { requireCavosUser, requireAddressProof, HttpError } from '../_lib/auth';
import { walletState, buildActivationTx, validateActivationTx, signAndSubmitActivation } from '../_lib/wallet';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    await requireCavosUser(req);
    const { step, proof, signedXdr } = req.body ?? {};
    const address = await requireAddressProof(proof, 'wallet', 'activate');
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
  } catch (e) { return fail(res, e); }
}
