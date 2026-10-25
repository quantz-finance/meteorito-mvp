// Redes del vendedor en su tienda (migración 031: seller_profiles.socials jsonb). Puro: lo usan el API, el demo y la app.
// Se guarda SOLO el link canónico https de cada red (usuario o link -> URL), nunca otro esquema ni otro dominio.
export const SOCIAL_KEYS = ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'website'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type Socials = Partial<Record<SocialKey, string>>;
export const SOCIAL_LABEL: Record<SocialKey, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', youtube: 'YouTube', website: 'Sitio web' };
export const SOCIAL_MAX = 200; // largo máximo de lo escrito y del link guardado

const HOSTS: Record<Exclude<SocialKey, 'website'>, string[]> = {
  instagram: ['instagram.com'], tiktok: ['tiktok.com'], facebook: ['facebook.com', 'fb.com'], x: ['x.com', 'twitter.com'], youtube: ['youtube.com'],
};
const HANDLE: Record<Exclude<SocialKey, 'website'>, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/, tiktok: /^[A-Za-z0-9._]{2,24}$/, facebook: /^[A-Za-z0-9.]{5,50}$/, x: /^[A-Za-z0-9_]{1,15}$/, youtube: /^[A-Za-z0-9._-]{3,30}$/,
};
const canon = (k: Exclude<SocialKey, 'website'>, h: string) =>
  k === 'instagram' ? `https://www.instagram.com/${h}` : k === 'tiktok' ? `https://www.tiktok.com/@${h}` : k === 'facebook' ? `https://www.facebook.com/${h}`
    : k === 'x' ? `https://x.com/${h}` : `https://www.youtube.com/@${h}`;
const RESERVED = /^(p|reel|reels|explore|stories|share|watch|intent|home|search|login|hashtag|i|groups|events)$/i;

/** Usuario o link -> link canónico https. '' -> null (quitar). 'invalid' si no es de esa red, no es https o es muy largo. */
export function normalizeSocial(key: SocialKey, raw: unknown): string | null | 'invalid' {
  if (raw == null) return null;
  if (typeof raw !== 'string') return 'invalid';
  const v = raw.trim();
  if (!v) return null;
  if (v.length > SOCIAL_MAX || /[\s<>"'`\\]/.test(v)) return 'invalid';
  const scheme = v.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  const looksUrl = !!scheme || v.includes('/') || (key === 'website' && v.includes('.'));
  if (scheme && (scheme !== 'https' || !v.toLowerCase().startsWith('https://'))) return 'invalid'; // javascript:, data:, http:, mailto:…
  if (key !== 'website' && !looksUrl) { // usuario suelto
    const h = v.replace(/^@/, '');
    return HANDLE[key].test(h) ? canon(key, h) : 'invalid';
  }
  let u: URL;
  try { u = new URL(scheme ? v : `https://${v}`); } catch { return 'invalid'; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return 'invalid';
  const host = u.hostname.toLowerCase();
  if (key === 'website') {
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || /(^|\.)localhost$/.test(host)) return 'invalid';
    const out = u.href;
    return out.length <= SOCIAL_MAX ? out : 'invalid';
  }
  const bare = host.replace(/^(www|m|mobile)\./, '');
  if (!HOSTS[key].includes(bare)) return 'invalid';
  const seg = u.pathname.split('/').filter(Boolean);
  if (key === 'facebook' && seg[0] === 'profile.php') { const id = u.searchParams.get('id') ?? ''; return /^\d{5,20}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : 'invalid'; }
  if (key === 'youtube' && ['channel', 'c', 'user'].includes(seg[0] ?? '')) {
    return seg[1] && /^[A-Za-z0-9._-]{2,60}$/.test(seg[1]) ? `https://www.youtube.com/${seg[0]}/${seg[1]}` : 'invalid';
  }
  let h = seg[0] ?? '';
  if (key === 'tiktok' || key === 'youtube') { if (!h.startsWith('@')) return 'invalid'; h = h.slice(1); }
  if (!h || RESERVED.test(h) || !HANDLE[key].test(h)) return 'invalid';
  return canon(key, h);
}

/** Objeto { instagram?, tiktok?, … } -> redes canónicas (solo las que tienen valor) o la primera red inválida. */
export function normalizeSocials(input: unknown): { socials: Socials } | { bad: SocialKey | 'shape' } {
  if (input == null) return { socials: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { bad: 'shape' };
  const socials: Socials = {};
  for (const k of Object.keys(input as object)) if (!(SOCIAL_KEYS as readonly string[]).includes(k)) return { bad: 'shape' };
  for (const k of SOCIAL_KEYS) {
    const r = normalizeSocial(k, (input as any)[k]);
    if (r === 'invalid') return { bad: k };
    if (r) socials[k] = r;
  }
  return { socials };
}
/** Lo guardado (o lo que venga del API) ya limpio: descarta todo lo que no pase la validación. Nunca rompe. */
export function cleanSocials(v: unknown): Socials {
  const out: Socials = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const k of SOCIAL_KEYS) { const r = normalizeSocial(k, (v as any)[k]); if (r && r !== 'invalid') out[k] = r; }
  return out;
}
export const socialError = (k: SocialKey | 'shape') => k === 'shape' ? 'Revisa tus redes e intenta de nuevo.'
  : k === 'website' ? 'Revisa tu sitio web: usa un link que empiece con https://.' : `Revisa tu ${SOCIAL_LABEL[k]}: escribe tu usuario o el link de tu perfil.`;
