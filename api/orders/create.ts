// POST /api/orders/create  (Bearer JWT Cavos + proof{action:'create', ref:'new'})
// Reemplaza el insert directo desde el cliente. anon ya no inserta (migración 003).
import { randomBytes } from 'node:crypto';
import { trackServer } from '../_lib/analytics';
import { db, json, fail } from '../_lib/db';
import { requireCavosUser, requireAddressProof, HttpError, bindWalletIfFresh } from '../_lib/auth';
import { walletState } from '../_lib/wallet';
import { MAX_PHOTOS, publicPrefix } from '../_lib/photos';

const CATS = ['celular', 'consola', 'laptop', 'tablet', 'camara', 'otro'];
const slug = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; while (s.length < 6) { const b = randomBytes(1)[0]; if (b < 252) s += a[b % 36]; } return s; };
const str = (v: unknown, max: number, req = true) => {
  if (v == null || v === '') { if (req) throw new HttpError(400, 'faltan campos'); return null; }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'campo inválido'); return v.trim();
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const b = req.body ?? {};
    const seller = await requireAddressProof(b.proof, 'create', 'new');
    await bindWalletIfFresh(user, seller);
    if (!CATS.includes(b.category)) throw new HttpError(400, 'categoría inválida');
    const price = Number(b.price_crc);
    if (!Number.isInteger(price) || price < 1000 || price > 50_000_000) throw new HttpError(400, 'precio inválido');
    // Fotos obligatorias (1-4) y solo de la carpeta del vendedor (subidas por /api/photos/upload-url).
    const prefix = publicPrefix(user.sub);
    const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
    if (photos.length < 1) throw new HttpError(400, 'agregá al menos una foto');
    if (photos.length > MAX_PHOTOS || photos.some((u) => typeof u !== 'string' || !u.startsWith(prefix))) throw new HttpError(400, 'fotos inválidas');
    // El link no se publica si la wallet del vendedor no puede recibir USDC (activar con /api/wallet/activate).
    if ((await walletState(seller)) !== 'ready') throw Object.assign(new HttpError(409, 'Tu cuenta todavía no está activada para recibir pagos. Activala y volvé a publicar.'), { code: 'wallet_not_ready' });
    const row = {
      seller_address: seller, seller_user_id: user.sub, seller_email: user.email ?? null,
      category: b.category, brand: str(b.brand, 60), model: str(b.model, 80), condition: str(b.condition, 40),
      price_crc: price, description: str(b.description, 2000, false), identifier: str(b.identifier, 40, false),
      photos, checks: Array.isArray(b.checks) ? b.checks.slice(0, 20) : [], status: 'creado',
    };
    for (let i = 0; i < 5; i++) {
      const s = slug();
      const { error } = await db().from('orders').insert({ ...row, slug: s });
      if (!error) { await trackServer(`slug:${s}`, 'order_created', { category: row.category, price_crc: price }); return json(res, 200, { slug: s }); }
      if (error.code !== '23505') throw error;
    }
    throw new Error('no se pudo generar slug');
  } catch (e) { return fail(res, e); }
}
