// Build REAL + backend simulado: "Cómo funciona Meteorito" es pública (sin cuenta) y no llama al API.
// Sin reset ni estado del mock: puede correr en paralelo con mock-guest sin pisarlo.
import { test, expect } from '@playwright/test';

test('MCK-RUL-01 /como-funciona sin cuenta: las 7 reglas, sin login ni llamadas al API', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) apiCalls.push(u.pathname); });
  await page.goto('/como-funciona');
  await expect(page.getByText('Cómo funciona Meteorito')).toBeVisible();
  for (const t of ['Pago en custodia', 'Envío', 'Código de entrega', 'Liberación automática', 'Problemas o disputas', 'Reclamos hasta 30 días después', 'Contacto'])
    await expect(page.getByText(new RegExp(`^\\d\\. ${t}$`))).toBeVisible();
  await expect(page.getByText(/por defecto, 7 días\)/)).toBeVisible();
  await expect(page.getByText('Ver recorrido')).toHaveCount(0); // el tour guiado llega después
  await expect(page.getByText(/Inicia sesión|Crear cuenta|Continuar con Google/i)).toHaveCount(0);
  expect(apiCalls.filter((p) => p !== '/api/health')).toEqual([]);
});
