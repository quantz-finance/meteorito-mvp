// Formulario de tarjeta propio (components/CardSheet.tsx): validación y formato en el navegador. Puro, sin red.
// El número y el CVC NUNCA salen del navegador: al servidor solo va el resultado de la tarjeta (scenario) + nombre y correo.
// Hoy el cobro es el sandbox de Lendara (docs/lendara-card.md): solo se aceptan sus 4 tarjetas de prueba. Con un
// procesador real (Tilopay SDK v2 / ONVO) este archivo sigue validando y el número va tokenizado por su SDK.

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'unknown';
export type CardScenario = 'approved' | 'kyc_rejected' | 'payment_not_received' | 'delayed';

export const digits = (s: string) => s.replace(/\D/g, '');

export function luhn(num: string): boolean {
  const d = digits(num);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}

export function cardBrand(num: string): CardBrand {
  const d = digits(num);
  if (/^4/.test(d)) return 'visa';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  return 'unknown';
}
export const cardLength = (b: CardBrand) => (b === 'amex' ? 15 : 16);
export const cvcLength = (b: CardBrand) => (b === 'amex' ? 4 : 3);

/** "4242424242424242" -> "4242 4242 4242 4242" (Amex 4-6-5). Corta al largo de la marca. */
export function formatCardNumber(raw: string): string {
  const b = cardBrand(raw); const d = digits(raw).slice(0, b === 'unknown' ? 19 : cardLength(b));
  if (b === 'amex') return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
  return d.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** "1229" / "12/29" / "1/29" -> "12/29". Escribir "4" pone "04/". Borrar el "/" funciona (no se re-agrega con 2 dígitos). */
export function formatExpiry(raw: string, prev = ''): string {
  let d = digits(raw).slice(0, 4);
  if (d.length === 1 && Number(d) > 1) d = '0' + d;
  if (d.length < 2) return d;
  if (d.length === 2) return raw.length < prev.length ? d : d + '/';
  return d.slice(0, 2) + '/' + d.slice(2);
}

/** Vencimiento MM/AA válido y no vencido (vale hasta el último día del mes). */
export function expiryValid(v: string, now = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(v.trim()); if (!m) return false;
  const month = Number(m[1]), year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const end = new Date(year, month, 1); // primer día del mes siguiente
  if (end <= now) return false;
  return year <= now.getFullYear() + 20;
}
export const cvcValid = (cvc: string, num: string) => new RegExp(`^\\d{${cvcLength(cardBrand(num))}}$`).test(cvc);
export const emailValid = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e.trim()) && e.trim().length <= 254;
export const nameValid = (n: string) => n.replace(/\s+/g, ' ').trim().length >= 2 && n.trim().length <= 80;

/** Tarjetas que acepta el procesador actual (sandbox de Lendara) -> resultado. Cualquier otra: no aceptada. */
const ACCEPTED: Record<string, CardScenario> = {
  '4242424242424242': 'approved',
  '4000000000000002': 'kyc_rejected',
  '4000000000009995': 'payment_not_received',
  '4000000000000077': 'delayed',
};
export const scenarioFor = (num: string): CardScenario | null => ACCEPTED[digits(num)] ?? null;

export type CardForm = { name: string; email: string; number: string; expiry: string; cvc: string };
export type CardErrors = Partial<Record<keyof CardForm, string>>;
export const NOT_ACCEPTED = 'Tarjeta no aceptada. Prueba con otra o paga por SINPE Móvil.';

/** Errores por campo (en español). Vacío = listo para pagar. */
export function validateCard(f: CardForm, now = new Date()): CardErrors {
  const e: CardErrors = {};
  if (!nameValid(f.name)) e.name = 'Escribe tu nombre como aparece en la tarjeta.';
  if (!emailValid(f.email)) e.email = 'Revisa tu correo.';
  const b = cardBrand(f.number); const d = digits(f.number);
  if (d.length < (b === 'unknown' ? 12 : cardLength(b)) || !luhn(d)) e.number = 'Revisa el número de la tarjeta.';
  else if (!scenarioFor(d)) e.number = NOT_ACCEPTED;
  if (!expiryValid(f.expiry, now)) e.expiry = /^\d{2}\/\d{2}$/.test(f.expiry) ? 'La tarjeta está vencida o la fecha no es válida.' : 'Usa el formato MM/AA.';
  if (!cvcValid(f.cvc, f.number)) e.cvc = 'Revisa el CVC.';
  return e;
}
