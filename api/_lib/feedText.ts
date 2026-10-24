// Texto del feed y del buscador: normalización (sin mayúsculas ni acentos), palabras, cursor y filtro. Puro: lo usan la API y la app (demo).
export type VerifiedFilter = 'true' | 'false' | 'all';
export const FEED_MAX = 20;
export const FEED_DEFAULT = 10;

/** "  CÁMARA  Ñandú " -> "camara nandu". Igual para el producto y para lo que escribe el comprador. */
export function foldText(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
/** Palabras a buscar (máx. 5, de hasta 30 letras). Solo letras y números: nada llega crudo a un filtro de PostgREST. */
export function searchTokens(q: unknown): string[] {
  return foldText(String(q ?? '').slice(0, 120)).split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.slice(0, 30)).slice(0, 5);
}
export const matchesTokens = (text: string, tokens: string[]) => { const f = foldText(text); return tokens.every((w) => f.includes(w)); };
/** Patrón ILIKE tolerante a acentos: las vocales pasan a "_" (un carácter cualquiera). "camara" -> "*c_m_r_*". */
export const ilikePattern = (w: string) => `*${w.replace(/[aeiou]/g, '_')}*`;

export const encodeCursor = (iso: string) => iso;
export function decodeCursor(c: unknown): string | null {
  const s = String(c ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}
export function parseVerified(v: unknown): VerifiedFilter {
  if (v == null || v === '') return 'all';
  const s = String(v);
  if (s === 'true' || s === 'false' || s === 'all') return s;
  throw Object.assign(new Error('Filtro inválido.'), { status: 400, code: 'bad_filter' });
}

