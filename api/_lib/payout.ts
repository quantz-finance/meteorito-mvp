// Cuenta IBAN de Costa Rica para cobrar: validación pura (la usan la API y la app). Sin imports de Node.
// Formato: CR + 2 dígitos de control + 18 dígitos = 22 caracteres. Checksum ISO 13616 (mod 97 == 1).

export const normalizeIban = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** mod 97 de un número decimal arbitrariamente largo (en trozos, sin BigInt). */
function mod97(digits: string): number {
  let r = 0;
  for (let i = 0; i < digits.length; i += 7) r = Number(String(r) + digits.slice(i, i + 7)) % 97;
  return r;
}
/** ISO 13616: mueve los 4 primeros al final, letras -> números (A=10…Z=35) y el resto mod 97 debe ser 1. */
export function ibanChecksumOk(iban: string): boolean {
  const s = iban.slice(4) + iban.slice(0, 4);
  const digits = s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return /^\d+$/.test(digits) && mod97(digits) === 1;
}
/** null si es válido; si no, un mensaje corto en tuteo. */
export function crIbanError(v: unknown): string | null {
  const s = normalizeIban(v);
  if (!s) return 'Escribe tu cuenta IBAN.';
  if (!s.startsWith('CR')) return 'La cuenta IBAN de Costa Rica empieza con CR.';
  if (!/^CR\d*$/.test(s)) return 'Después de CR van solo números.';
  if (s.length !== 22) return `Le ${s.length < 22 ? 'faltan' : 'sobran'} ${Math.abs(22 - s.length)} caracteres (son 22 en total).`;
  if (!ibanChecksumOk(s)) return 'Revisa los números: esta cuenta IBAN no es válida.';
  return null;
}
export const isCrIban = (v: unknown) => crIbanError(v) === null;
/** Agrupa en bloques de 4 mientras se escribe: "CR05 0152 0200 1026 2840 66". */
export const formatIban = (v: unknown) => normalizeIban(v).slice(0, 22).replace(/(.{4})(?=.)/g, '$1 ');
/** Enmascarado para la UI: "CR•• •••• … 8066". */
export const maskIban = (last4: string) => `CR•• •••• … ${last4}`;

/** SINPE Móvil: 8 dígitos de Costa Rica (acepta +506 y espacios). null si viene vacío; 'invalid' si no sirve. */
export function normalizeSinpe(v: unknown): string | null | 'invalid' {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^506(?=\d{8}$)/, '');
  if (!d) return null;
  return /^[2-8]\d{7}$/.test(d) ? d : 'invalid';
}
export const maskPhone = (last4: string) => `•••• ${last4}`;

export const cleanHolder = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** Lo único que sale del servidor hacia la app: nunca el IBAN completo ni el teléfono completo. */
export interface PayoutView { iban_last4: string; holder_name: string; sinpe_last4: string | null; updated_at: string | null }
export const payoutView = (row: { iban: string; holder_name: string; sinpe_phone?: string | null; updated_at?: string | null }): PayoutView => ({
  iban_last4: row.iban.slice(-4), holder_name: row.holder_name,
  sinpe_last4: row.sinpe_phone ? row.sinpe_phone.slice(-4) : null, updated_at: row.updated_at ?? null,
});
