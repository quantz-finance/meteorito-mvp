// Borrador de "Vender": sobrevive a cambiar de pestaña, recargar, que iOS cierre la PWA y a "Entrar de nuevo" cuando la
// sesión vence (antes vivía en sessionStorage: iOS lo borra al cerrar la app y el borrador se perdía justo en el re-login).
// localStorage con vencimiento (24 h) y por dueño (dirección de la billetera): otra cuenta en el mismo teléfono no lo ve.
// Guarda texto, el acuerdo de entrega y las fotos YA SUBIDAS (sus URLs públicas; el API las acepta igual al crear).
export const DRAFT_KEY = 'meteorito:sell-draft-v3';
const OLD_KEY = 'meteorito:sell-draft-v2';
export const DRAFT_TTL_MS = 24 * 3600_000;
const MAX_URL = 2048; // data: URLs (fotos importadas en memoria) no se guardan: se quedan solo en memoria
export interface DraftPhoto { url: string; uri?: string }
export interface SellDraft {
  owner: string | null; title: string; price: string; description?: string | null;
  photos?: DraftPhoto[]; mode?: 'envio' | 'cara_a_cara'; windowMin?: number; source?: { url: string; provider: string } | null;
  at?: number;
}
let mem: SellDraft | null = null;
const ls = (): Storage | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
const oldDraft = () => { try { return typeof window !== 'undefined' ? window.sessionStorage?.getItem(OLD_KEY) ?? null : null; } catch { return null; } };
const dropOld = () => { try { if (typeof window !== 'undefined') window.sessionStorage?.removeItem(OLD_KEY); } catch { /* */ } };
const isEmpty = (d: SellDraft) => !d.title && !d.price && !d.description && !(d.photos?.length) && !d.source;

export function loadSellDraft(owner: string | null, now = Date.now()): SellDraft | null {
  if (!mem) {
    try {
      const raw = ls()?.getItem(DRAFT_KEY) ?? oldDraft();
      if (raw) mem = JSON.parse(raw);
      dropOld();
    } catch { /* sin storage o JSON roto */ }
  }
  const d = mem;
  if (!d) return null;
  if (d.at && now - d.at > DRAFT_TTL_MS) { saveSellDraft(null); return null; }
  if (d.owner && owner && d.owner !== owner) return null;
  return d;
}

export function saveSellDraft(d: SellDraft | null, now = Date.now()) {
  mem = d ? { ...d, at: now } : null;
  if (!d) dropOld();
  const s = ls(); if (!s) return;
  try {
    if (!d || isEmpty(d)) { s.removeItem(DRAFT_KEY); return; }
    const photos = (d.photos ?? []).filter((p) => typeof p.url === 'string' && p.url.length <= MAX_URL && /^https?:\/\//.test(p.url)).map((p) => ({ url: p.url }));
    s.setItem(DRAFT_KEY, JSON.stringify({ ...d, photos, at: now }));
  } catch { /* cuota llena: queda en memoria */ }
}
export const __resetSellDraftForTests = () => { mem = null; };
