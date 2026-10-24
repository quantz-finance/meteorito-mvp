// Algoritmo del feed de Comprar: puntaje 0..1 por publicación + penalización por diversidad de vendedores.
// PURO (sin red ni base): lo usan la API (api/_lib/feed.ts) y el demo (lib/demoFeed.ts), y se prueba determinístico (t70).
//
// Objetivo: que el comprador vea primero lo nuevo de vendedores confiables y de los que sigue, sin que un solo
// vendedor tape el feed, y que publicar bien (fotos, descripción) y vender bien se premie.
//
// Para AJUSTAR el algoritmo, cambia solo FEED_WEIGHTS / FEED_RANK (y corre t70). Cada señal va de 0 a 1 y el puntaje
// es la suma ponderada (los pesos suman 1), así que un peso es "cuánto del puntaje puede mover esa señal".

/** Pesos de cada señal (suman 1). */
export const FEED_WEIGHTS = {
  /** Sigues a este vendedor: es la señal más fuerte para lo que publicó hace poco y se apaga con los días
   *  (mitad cada FEED_RANK.followedHalfLifeH h): lo de hace una semana ya no tapa lo nuevo de los demás. */
  followed: 0.30,
  /** Lo nuevo primero: el feed es de publicaciones. Decae a la mitad cada FEED_RANK.recencyHalfLifeH horas. */
  recency: 0.25,
  /** Estrellas promedio ponderadas por cantidad de reseñas (promedio bayesiano: pocas reseñas pesan poco). */
  reputation: 0.14,
  /** Identidad confirmada. */
  identity: 0.10,
  /** Publicación completa: fotos (hasta 4), descripción y un título claro. Premia publicar bien. */
  quality: 0.08,
  /** Ventas completadas (liberadas + disputas resueltas), en escala logarítmica hasta FEED_RANK.salesSaturation. */
  sales: 0.07,
  /** Actividad reciente del vendedor (last_seen_at, migración 021). Sin el dato, cuenta 0 para todos (no cambia el orden). */
  activity: 0.06,
} as const;

export const FEED_RANK = {
  /** Horas en que la señal de novedad cae a la mitad. */
  recencyHalfLifeH: 48,
  /** Horas en que el impulso de "lo sigues" cae a la mitad (es más lento que la novedad). */
  followedHalfLifeH: 96,
  /** Promedio bayesiano: un vendedor sin reseñas cuenta como ratingPrior estrellas; cada reseña real mueve el promedio. */
  ratingPrior: 3.5,
  ratingPriorN: 5,
  /** Ventas a partir de las cuales la señal ya es 1. */
  salesSaturation: 20,
  /** Horas en que la señal de actividad cae a la mitad. Vendedor que ocultó su última conexión: 0.5 (neutro). */
  activityHalfLifeH: 24,
  /** Diversidad: como mucho maxRun tarjetas seguidas del mismo vendedor. */
  maxRun: 2,
  /** Cuántas publicaciones (las más nuevas que cumplen el filtro/búsqueda) se ordenan por puntaje. Después: por fecha. */
  window: 120,
} as const;

export type Weights = { [K in keyof typeof FEED_WEIGHTS]: number };
export interface RankSeller { verified: boolean; rating_avg: number | null; rating_count: number; sales_completed?: number; followed?: boolean;
  /** ISO de la última conexión; null = nunca / sin dato; 'hidden' = el vendedor la ocultó. */ last_seen_at?: string | null | 'hidden' }
export interface RankItem { slug: string; created_at: string; seller_key: string; photos: number; title: string; description?: string | null; seller: RankSeller }

const clamp = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const halfLife = (hours: number, h: number) => clamp(Math.pow(0.5, Math.max(0, hours) / h));

/** Cada señal entre 0 y 1. */
export function signals(it: RankItem, now: number, r = FEED_RANK): Record<keyof typeof FEED_WEIGHTS, number> {
  const s = it.seller;
  const ageH = (now - Date.parse(it.created_at)) / 3600e3;
  const n = Math.max(0, Number(s.rating_count) || 0);
  const avg = s.rating_avg == null || !n ? r.ratingPrior : Number(s.rating_avg);
  const bayes = (r.ratingPrior * r.ratingPriorN + avg * n) / (r.ratingPriorN + n);
  const seen = s.last_seen_at;
  const activity = seen === 'hidden' ? 0.5 : seen ? halfLife((now - Date.parse(seen)) / 3600e3, r.activityHalfLifeH) : 0;
  const desc = String(it.description ?? '').trim().length, title = String(it.title ?? '').trim().length;
  return {
    recency: Number.isFinite(ageH) ? halfLife(ageH, r.recencyHalfLifeH) : 0,
    followed: s.followed && Number.isFinite(ageH) ? halfLife(ageH, r.followedHalfLifeH) : 0,
    reputation: clamp((bayes - 1) / 4),
    identity: s.verified ? 1 : 0,
    sales: clamp(Math.log1p(Math.max(0, s.sales_completed ?? 0)) / Math.log1p(r.salesSaturation)),
    quality: clamp(0.6 * Math.min(it.photos, 4) / 4 + 0.25 * Math.min(desc, 60) / 60 + 0.15 * Math.min(title, 12) / 12),
    activity,
  };
}
export function score(it: RankItem, now: number, w: Weights = FEED_WEIGHTS, r = FEED_RANK): number {
  const sg = signals(it, now, r);
  return (Object.keys(w) as (keyof Weights)[]).reduce((acc, k) => acc + w[k] * sg[k], 0);
}

/** Desempate estable: más nuevo primero y después por slug. */
const tie = (a: RankItem, b: RankItem) => (a.created_at === b.created_at ? (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) : a.created_at < b.created_at ? 1 : -1);

/** Ordena por puntaje y aplica la diversidad: nunca más de maxRun seguidas del mismo vendedor (si queda otro vendedor). */
export function rankFeed<T extends RankItem>(items: T[], now: number, w: Weights = FEED_WEIGHTS, r = FEED_RANK): T[] {
  const scored = items.map((it) => ({ it, sc: score(it, now, w, r) }));
  scored.sort((a, b) => (b.sc - a.sc) || tie(a.it, b.it));
  return diversify(scored.map((x) => x.it), r.maxRun);
}
export function diversify<T extends { seller_key: string }>(sorted: T[], maxRun: number = FEED_RANK.maxRun): T[] {
  const rest = [...sorted]; const out: T[] = [];
  while (rest.length) {
    const tail = out.slice(-maxRun);
    const blocked = tail.length === maxRun && tail.every((x) => x.seller_key === tail[0].seller_key) ? tail[0].seller_key : null;
    let i = blocked == null ? 0 : rest.findIndex((x) => x.seller_key !== blocked);
    if (i < 0) i = 0; // solo queda ese vendedor
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
}

/** Cursor del feed ordenado: posición dentro de la ventana + momento en que se armó (la ventana no cambia al paginar). */
export const encodeRankCursor = (offset: number, asOf: number) => `r${offset}_${asOf}`;
export function decodeRankCursor(c: unknown): { offset: number; asOf: number } | null {
  const m = /^r(\d{1,4})_(\d{13})$/.exec(String(c ?? ''));
  return m ? { offset: Number(m[1]), asOf: Number(m[2]) } : null;
}
