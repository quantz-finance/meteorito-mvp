// Puntuación del vendedor: etiqueta pura (sin React ni red; testeable).
/** "4.8 · 12 calificaciones" o "Nuevo vendedor". */
export function ratingLabel(s: { rating_avg: number | null; rating_count: number }): string {
  if (!s.rating_count || s.rating_avg == null) return 'Nuevo vendedor';
  const avg = (Math.round(s.rating_avg * 10) / 10).toFixed(1);
  return `${avg} · ${s.rating_count} calificaci${s.rating_count === 1 ? 'ón' : 'ones'}`;
}
