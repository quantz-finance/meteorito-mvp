// Motor de checklist por categoría. Agregar una categoría = solo configuración.
export type IdentifierKind = 'imei' | 'serial' | 'imei_or_serial';

export interface Check { id: string; label: string; blocksRelease: boolean }
export interface Category {
  id: string;
  label: string;
  identifier: { kind: IdentifierKind; required: boolean; label: string };
  checks: Check[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'celular', label: 'Celular',
    identifier: { kind: 'imei', required: false, label: 'IMEI (opcional)' },
    checks: [
      { id: 'imei_limpio', label: 'IMEI limpio (sin reporte de robo ni deuda)', blocksRelease: true },
      { id: 'cuenta_off', label: 'iCloud / cuenta de Google desactivada', blocksRelease: true },
    ],
  },
  {
    id: 'consola', label: 'Consola',
    identifier: { kind: 'serial', required: true, label: 'Número de serie' },
    checks: [{ id: 'cuenta_cerrada', label: 'Cuenta cerrada / sin bloqueo', blocksRelease: true }],
  },
  {
    id: 'laptop', label: 'Laptop',
    identifier: { kind: 'serial', required: true, label: 'Número de serie' },
    checks: [{ id: 'sin_bios_findmy', label: 'Sin contraseña de BIOS ni Buscar mi Mac/dispositivo', blocksRelease: true }],
  },
  {
    id: 'tablet', label: 'Tablet',
    identifier: { kind: 'imei_or_serial', required: true, label: 'IMEI o número de serie' },
    checks: [{ id: 'cuenta_off', label: 'iCloud / cuenta de Google desactivada', blocksRelease: true }],
  },
  {
    id: 'camara', label: 'Cámara',
    identifier: { kind: 'serial', required: true, label: 'Número de serie' },
    checks: [],
  },
  {
    id: 'otro', label: 'Otro',
    identifier: { kind: 'serial', required: false, label: 'Número de serie (opcional)' },
    checks: [],
  },
];

export const CONDITIONS = ['Nuevo', 'Como nuevo', 'Buen estado', 'Con detalles'] as const;

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
export const isValidImei = (v: string) => /^\d{15}$/.test(v) && luhnValid(v);
const isValidSerial = (v: string) => /^[A-Za-z0-9-]{4,30}$/.test(v);

/** Devuelve un mensaje de error en español o null si es válido. */
export function validateIdentifier(cat: Category, raw: string): string | null {
  const v = raw.trim();
  if (!v) return cat.identifier.required ? `Falta ${cat.identifier.label.toLowerCase()}` : null;
  switch (cat.identifier.kind) {
    case 'imei': return isValidImei(v) ? null : 'IMEI inválido: deben ser 15 dígitos válidos';
    case 'serial': return isValidSerial(v) ? null : 'Número de serie inválido';
    case 'imei_or_serial':
      if (/^\d{15}$/.test(v)) return isValidImei(v) ? null : 'IMEI inválido';
      return isValidSerial(v) ? null : 'IMEI o serie inválido';
  }
}

export interface CheckResult { id: string; label: string; blocksRelease: boolean; ok: boolean }
export const checksSummary = (cat: Category, state: Record<string, boolean>): CheckResult[] =>
  cat.checks.map((c) => ({ ...c, ok: !!state[c.id] }));
