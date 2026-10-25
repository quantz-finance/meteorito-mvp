// Admin: borrar las redes de un vendedor cuando alguien las reporta (031). Solo el admin (requireAdmin en
// api/escrow/dispute.ts). Auditoría en admin_audit (031) con QUÉ redes se borraron, nunca los links.
import { db } from './db';
import { HttpError } from './auth';
import { isMissingTable } from './push';
import { missingColumn } from './listings';
import { storeDbErr, normalizeStoreSlug, validStoreSlug } from './store';
import { cleanSocials } from './socials';

export async function adminClearSocials(rawSlug: unknown, admin: { sub: string; email: string }) {
  const slug = normalizeStoreSlug(rawSlug);
  if (!validStoreSlug(slug)) throw new HttpError(400, 'Usuario inválido.');
  const { data, error } = await db().from('seller_profiles').select('sub, socials').eq('store_slug', slug).maybeSingle();
  if (error && missingColumn(error)) return { cleared: 0 }; // sin 031 no hay redes
  if (error) storeDbErr(error);
  if (!data) throw new HttpError(404, 'Este perfil no existe.');
  const networks = Object.keys(cleanSocials((data as any).socials));
  const { error: e2 } = await db().from('seller_profiles').update({ socials: null }).eq('sub', (data as any).sub);
  if (e2) storeDbErr(e2);
  const row = { kind: 'store_socials_cleared', admin_email: admin.email, target: slug, detail: { networks } };
  const { error: e3 } = await db().from('admin_audit').insert(row);
  if (e3) console.info('[admin-audit]', JSON.stringify(row), isMissingTable(e3) ? '(sin tabla 031)' : e3.code); // sin links
  return { cleared: networks.length };
}
