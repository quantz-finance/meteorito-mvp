// Chat comprador-vendedor: reglas PURAS (sin Node ni red). Las usan la API (api/_lib/chat.ts), la app y el demo.
// Texto solo (v1): máximo CHAT_MAX caracteres, sin caracteres de control, saltos de línea acotados.

export const CHAT_MAX = 1000;
/** Mensajes por minuto por quien envía (por identidad; sin cuenta también por IP). */
export const CHAT_SEND_PER_MIN = 12;
export const CHAT_SEND_IP_PER_MIN = 30;
/** Conversaciones nuevas por hora por identidad (anti-spam a vendedores). */
export const CHAT_OPEN_PER_HOUR = 20;
/** Aviso push a la otra parte: como mucho uno cada CHAT_PUSH_COOLDOWN_MIN por conversación mientras no lea. */
export const CHAT_PUSH_COOLDOWN_MIN = 10;
/** Si la otra parte tuvo la conversación abierta hace menos de esto, no se le manda push (ya lo está viendo). */
export const CHAT_PRESENT_MS = 25_000;
/** "Escribiendo…": vigente durante este tiempo desde el último aviso. */
export const CHAT_TYPING_MS = 6_000;
export type ChatRole = 'buyer' | 'seller';

/** Token de conversación: 32 caracteres base64url (24 bytes aleatorios). Nunca un id secuencial. */
export const validChatToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{32}$/.test(t);
/** client_id del mensaje (envío optimista / idempotente): lo genera la app. */
export const validClientId = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(t);

/** Texto listo para guardar, o un código de error. */
export function cleanChatText(v: unknown): string | 'empty' | 'too_long' {
  if (typeof v !== 'string') return 'empty';
  // Sin caracteres de control (salvo salto de línea y tab), sin espacios raros de ancho cero, como mucho 2 líneas vacías seguidas.
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return 'empty';
  if ([...s].length > CHAT_MAX) return 'too_long';
  return s;
}

const PHONE = /(?:\+?\d[\s\-().]*){8,}/; // 8+ dígitos (con o sin +506, espacios, guiones)
const LINK = /(?:https?:\/\/|www\.|wa\.me\/|\b[a-z0-9-]+\.(?:com|net|org|io|app|co|cr|me|ly|link|shop|store|info|biz)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
/** ¿El mensaje comparte un teléfono, un correo o un link? (aviso suave "paga dentro de Meteorito"; nunca se bloquea). */
export function sharesContact(text: string): boolean {
  const t = String(text ?? '');
  return PHONE.test(t) || LINK.test(t) || EMAIL.test(t);
}

/** Vista previa corta para la bandeja y el push (una línea). */
export const chatPreview = (text: string, n = 90) => { const one = String(text ?? '').replace(/\s+/g, ' ').trim(); return [...one].length > n ? [...one].slice(0, n - 1).join('') + '…' : one; };

/** "Comprador · 4F2A": etiqueta estable de un comprador para el vendedor, sin revelar su identidad. */
export function buyerLabel(buyerId: string): string {
  let h = 2166136261; const s = String(buyerId ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `Comprador · ${(h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-4)}`;
}

export interface ChatRowLite { last_message_at?: string | null; last_sender?: string | null; buyer_read_at?: string | null; seller_read_at?: string | null }
/** ¿Hay algo sin leer para este lado? (el último mensaje es de la otra parte y llegó después de que leí). */
export function isUnread(c: ChatRowLite, role: ChatRole): boolean {
  if (!c.last_message_at || !c.last_sender || c.last_sender === role) return false;
  const read = role === 'buyer' ? c.buyer_read_at : c.seller_read_at;
  return !read || Date.parse(read) < Date.parse(c.last_message_at);
}

/** Polling inteligente: rápido con el chat abierto y activo, más lento si no pasa nada, detenido si la pestaña no se ve. */
export function chatPollDelay(o: { visible: boolean; idleMs: number }): number | null {
  if (!o.visible) return null;
  if (o.idleMs < 30_000) return 2_500;
  if (o.idleMs < 120_000) return 6_000;
  return 15_000;
}
/** Bandeja / insignia: cada 45 s con la pantalla visible; nada en segundo plano. */
export const CHAT_BADGE_MS = 45_000;
