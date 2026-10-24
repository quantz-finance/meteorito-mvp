// Reseñas: limpieza del comentario y nombre corto del comprador. Puro (sin Node): lo usan la API y la app (demo).
export const REVIEW_MAX = 280;
/** Comentario de la reseña: espacios normalizados; null si viene vacío; 'too_long' (> 280) o 'link' (sin links: spam). */
export function cleanReviewComment(raw: unknown): string | null | 'too_long' | 'link' {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > REVIEW_MAX) return 'too_long';
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|co|cr|app|io|ly|me)\b/i.test(s)) return 'link';
  return s;
}
/** Nombre corto público del comprador: "maría josé rodríguez" -> "María R."; uno solo -> "Diego"; vacío -> null. */
export function shortBuyerName(raw: unknown): string | null {
  const words = String(raw ?? '').replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const cap = (w: string) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es');
  const first = cap(words[0]).slice(0, 18);
  return words.length > 1 ? `${first} ${words[words.length - 1].charAt(0).toLocaleUpperCase('es')}.` : first;
}
