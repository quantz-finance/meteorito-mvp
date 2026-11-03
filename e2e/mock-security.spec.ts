// Encabezados de seguridad + CSP (los mismos de vercel.json, los aplica mock-server) y secretos del comprador fuera de
// localStorage (bóveda cifrada en IndexedDB) con migración desde la versión anterior.
import { test, expect } from '@playwright/test';

// Sin reset ni estado del mock: puede correr en paralelo con mock-guest. Los flujos con estado (pago sin violaciones de
// CSP, migración de la bóveda) están en mock-guest.spec.ts (serial, comparten el backend simulado).

test('SEC-01 encabezados de seguridad y CSP en el HTML', async ({ request }) => {
  const r = await request.get('/');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['content-security-policy']).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=(self)');
  expect(h['permissions-policy']).toContain('microphone=()');
  expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
});
