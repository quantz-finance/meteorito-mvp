// WhatsApp / teléfono de contacto del vendedor (migración 016). Validación pura: la usan la API y la app. Sin imports de Node.
// Formato de Costa Rica: +506 y 8 dígitos (empieza con 2-8). Se guarda normalizado en E.164: "+50688881234".
// El comprador solo lo ve DESPUÉS de pagar (CONTACT_STATUSES) y solo si demuestra ser el comprador del pedido.

/** Estados en los que el comprador ya pagó: puede ver el contacto del vendedor (coordinar el envío o reclamar después). */
export const CONTACT_STATUSES = ['fondeado', 'enviado', 'entregado', 'liberado', 'en_disputa', 'resuelto'] as const;
export const canShowContact = (status: unknown) => (CONTACT_STATUSES as readonly string[]).includes(String(status));

/** '+50688881234' si es válido; null si viene vacío (es opcional); 'invalid' si no sirve. Acepta +506, espacios y guiones. */
export function normalizeContactPhone(v: unknown): string | null | 'invalid' {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (/[^\d\s+()\-.]/.test(raw)) return 'invalid';
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('506')) d = d.slice(3);
  else if (raw.includes('+')) return 'invalid'; // otro código de país
  return /^[2-8]\d{7}$/.test(d) ? `+506${d}` : 'invalid';
}
/** null si es válido o vacío; si no, un mensaje corto en tuteo. */
export function contactPhoneError(v: unknown): string | null {
  return normalizeContactPhone(v) === 'invalid' ? 'Escribe un número de Costa Rica: 8 dígitos (ej. 8888 1234).' : null;
}
/** "+506 8888 1234" para mostrar. */
export const formatContactPhone = (e164: string) => e164.replace(/^\+506(\d{4})(\d{4})$/, '+506 $1 $2');
/** Link de WhatsApp: https://wa.me/506XXXXXXXX (sin +). */
export const waLink = (e164: string) => `https://wa.me/${e164.replace(/\D/g, '')}`;
