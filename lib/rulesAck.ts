// Acuerdo de la beta para vender: versión de reglas que quien vende aceptó en ESTE dispositivo (hoja "Antes de publicar"
// en Vender). Se manda al crear el link (rules_ack) y el servidor la guarda en el pedido (orders.rules_version, 033).
// Web: localStorage. Sin localStorage (app nativa, modo privado): en memoria durante la sesión. Nunca lanza.
import { CURRENT_RULES_VERSION } from '../api/_lib/orderRules';

export const RULES_ACK_KEY = 'meteorito:reglas-vendedor';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
function storage(): Store | null {
  try { const s = (globalThis as { localStorage?: Store }).localStorage; return s && typeof s.getItem === 'function' ? s : null; } catch { return null; }
}
let mem = 0;
/** Versión aceptada (0 = ninguna), nunca mayor que la vigente. */
export function acceptedRulesVersion(): number {
  let v = mem;
  try { v = Math.max(v, Number(storage()?.getItem(RULES_ACK_KEY)) || 0); } catch { /* */ }
  return Math.min(Math.max(0, Math.floor(v)), CURRENT_RULES_VERSION);
}
export const needsRulesAck = () => acceptedRulesVersion() < CURRENT_RULES_VERSION;
export function acceptRules(v = CURRENT_RULES_VERSION) {
  mem = Math.max(mem, v);
  try { storage()?.setItem(RULES_ACK_KEY, String(v)); } catch { /* en memoria */ }
}
