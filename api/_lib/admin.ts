// Rol admin (panel de disputas). Server-only: la lista vive en el servidor (ADMIN_EMAILS) y se compara con el correo del
// token Cavos YA VERIFICADO (firma/iss/aud en requireCavosUser). Nunca se confía en nada que mande el cliente.
// ADMIN_EMAILS: correos separados por coma. Sin la variable, el default es el usuario maestro (Bobby Alien).
// Quien no es admin recibe 404 (no se revela que el panel existe); sin sesión, 401 como el resto del API.
import { HttpError, requireCavosUser, type CavosUser } from './auth';

export const DEFAULT_ADMIN_EMAILS = ['bobbyaliensshop@gmail.com'];
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  const src: string[] = raw == null || raw.trim() === '' ? DEFAULT_ADMIN_EMAILS : raw.split(',');
  const list = src.map((x: string) => x.trim().toLowerCase()).filter((x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  return [...new Set(list)];
}
/** ¿Este usuario (token ya verificado) es admin? Un token que dice email_verified=false nunca lo es. */
export function isAdminUser(u: Pick<CavosUser, 'email' | 'emailVerified'> | null | undefined): boolean {
  if (!u || typeof u.email !== 'string' || u.emailVerified === false) return false;
  return adminEmails().includes(u.email.trim().toLowerCase());
}
export const notFound = () => Object.assign(new HttpError(404, 'No encontramos esta página.'), { code: 'not_found' });

export interface AdminUser { sub: string; email: string }
/** 401 sin sesión (como todo el API), 404 si la sesión no es de un admin. */
export async function requireAdmin(req: any): Promise<AdminUser> {
  const u = await requireCavosUser(req);
  if (!isAdminUser(u)) { console.warn('[admin] acceso rechazado', JSON.stringify({ sub: u.sub.slice(0, 6) })); throw notFound(); }
  return { sub: u.sub, email: u.email!.trim().toLowerCase() };
}
