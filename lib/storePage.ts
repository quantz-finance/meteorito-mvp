// Una sola página de tienda: /t/<usuario> es el perfil público y también "Mi tienda" del vendedor.
// Lógica pura (testeada en t66): quién es dueño y cómo se comparte el link.

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

/** Dueño = sesión iniciada Y su tienda es la de la URL. Invitados y otras cuentas siempre ven la vista pública. */
export function isOwnerView(auth: { isAuthenticated: boolean }, mySlug: string | null | undefined, routeSlug: string | null | undefined): boolean {
  const mine = norm(mySlug);
  return !!auth.isAuthenticated && !!mine && mine === norm(routeSlug);
}

/** URL canónica de la tienda (Mi tienda y el perfil público son la misma). */
export const myStoreHref = (slug: string) => `/t/${norm(slug)}`;

export type ShareMethod = 'web_share' | 'copy' | 'cancelled';
type Nav = { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> } | undefined;

/** navigator.share si existe; si no existe o falla (salvo que la persona cancele), copia el link. */
export async function shareLink(d: { url: string; title: string; text: string }, nav: Nav, copy: (s: string) => Promise<void>): Promise<ShareMethod> {
  if (nav?.share) {
    try { await nav.share({ title: d.title, text: d.text, url: d.url }); return 'web_share'; }
    catch (e) { if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'; }
  }
  try { await copy(d.url); } catch { /* sin portapapeles */ }
  return 'copy';
}
