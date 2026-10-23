// Navegación de 3 pestañas (Vender, Comprar, Pedidos) + foto de la tienda. Proyectos: iPhone SE, iPhone 13, Pixel 7 (demo).
import { expect, test } from '@playwright/test';
import { expectNoScroll, open, PHOTO, settle } from './helpers';

test.describe('Navegación', () => {
  test('NAV-01 la barra tiene exactamente Vender, Comprar, Home (en ese orden)', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Vender', 'Comprar', 'Home']);
    await expect(page.getByRole('tab', { name: 'Inicio' })).toHaveCount(0);
  });

  test('NAV-02 la app abre en Vender ("/" y rutas viejas de Inicio redirigen)', async ({ page }) => {
    for (const path of ['/', '/?utm_source=landing']) {
      await open(page, path, 'seller', path === '/');
      await expect(page).toHaveURL(/\/vender(\?|$)/);
      await expect(page.getByRole('tab', { name: 'Vender' })).toHaveAttribute('aria-selected', 'true');
    }
    const manifest = await (await page.request.get('/manifest.json')).json();
    expect(manifest.start_url).toBe('/vender');
  });

  test('NAV-03 Home: Tus ventas + Mi cuenta junto a Actualizar, sin scroll', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.evaluate(() => (window as any).__meteoritoDemo.seed('fondeado', { title: 'Bici', price_crc: 150000 }));
    await open(page, '/pedidos', 'seller');
    await expect(page.getByText('Tus ventas', { exact: true })).toBeVisible();
    await expect(page.getByLabel('En curso: 1')).toBeVisible();
    await settle(page); // las dos medidas en el mismo cuadro, ya sin la animación de entrada
    const [acct, refresh] = await page.evaluate(() => ['Mi cuenta', 'Actualizar'].map((l) => {
      const r = document.querySelector(`[aria-label="${l}"]`)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
    expect(acct && refresh).toBeTruthy();
    expect(Math.abs(acct!.y - refresh!.y)).toBeLessThanOrEqual(1); // misma fila
    expect(Math.abs(acct!.width - refresh!.width)).toBeLessThanOrEqual(1); // mismo tamaño
    expect(Math.abs(acct!.x + acct!.width - refresh!.x)).toBeLessThanOrEqual(16); // uno al lado del otro
    await page.waitForTimeout(500);
    await expectNoScroll(page);
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await expect(page.getByRole('button', { name: /Cerrar sesión/ })).toBeVisible();
  });

  test('NAV-04 Comprar: pagar un link pegado', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    const slug = await page.evaluate(() => (window as any).__meteoritoDemo.seed('creado', { title: 'Lámpara', price_crc: 20000 }));
    await open(page, '/comprar', 'seller');
    await page.getByRole('button', { name: 'Pagar un link' }).click();
    await page.getByPlaceholder('meteorito.app/p/…').fill(`https://pago.meteorito.app/p/${slug}`);
    await page.getByRole('button', { name: /Ver producto/ }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${slug}`));
  });
});

test.describe('Foto de la tienda', () => {
  test('FOTO-01 tocar la foto, elegir una imagen: se ve en Mi cuenta y en /t/<usuario>', async ({ page }) => {
    await open(page, '/mi-tienda', 'seller', true);
    const avatar = page.getByRole('button', { name: 'Cambiar la foto de tu tienda' });
    await expect(avatar).toBeVisible();
    await expect(page.getByTestId('store-avatar-img')).toHaveCount(0); // sin foto: placeholder
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), avatar.click()]);
    await fc.setFiles(PHOTO);
    await expect(page.getByTestId('store-avatar-img').first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => String(JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).store?.avatar ?? '').slice(0, 11))).toBe('data:image/');
    await open(page, '/pedidos', 'seller');
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await expect(page.getByTestId('store-avatar-img').first()).toBeVisible();
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByTestId('store-avatar-img').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cambiar la foto de tu tienda' })).toHaveCount(0); // el comprador no la cambia
  });
});
