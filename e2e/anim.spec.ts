// Universo animado + meteorito en Tus ventas + pestaña "Home". Proyectos: iPhone SE, iPhone 13, Pixel 7 (demo).
import { expect, test, type Page } from '@playwright/test';
import { expectNoScroll, expectTitleAt16, open } from './helpers';

/** Todas las propiedades que tocan las @keyframes del universo (u-*) y del meteorito (m-bob). */
const keyframeProps = (page: Page) => page.evaluate(() => {
  const props = new Set<string>(); const names: string[] = [];
  for (const sh of Array.from(document.styleSheets)) {
    let rules: CSSRuleList; try { rules = sh.cssRules; } catch { continue; }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSKeyframesRule) || !/^(u-|m-bob$)/.test(r.name)) continue;
      names.push(r.name);
      for (const k of Array.from(r.cssRules) as CSSKeyframeRule[]) for (let i = 0; i < k.style.length; i++) props.add(k.style[i]);
    }
  }
  return { names, props: [...props] };
});

test.describe('Universo y Home', () => {
  test('ANIM-01 barra Vender/Comprar/Home; título Home; meteorito en Tus ventas; 2 pedidos sin scroll', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.evaluate(async () => { const d = (window as any).__meteoritoDemo; await d.seed('fondeado', { title: 'Bici', price_crc: 150000 }); await d.seed('enviado', { title: 'iPhone', price_crc: 90000 }); });
    await open(page, '/pedidos', 'seller');
    const tabs = page.getByRole('tab');
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Vender', 'Comprar', 'Home']);
    await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    // ícono de casa (lucide house), no la caja
    expect(await page.getByRole('tab', { name: 'Home' }).locator('path').first().getAttribute('d')).toMatch(/^M3 10a2 2 0 0 1 \.7-1\.5l7-6/);
    await expectTitleAt16(page, 'Home');
    await expect(page.getByText('Mis pedidos')).toHaveCount(0);
    await expect(page).toHaveURL(/\/pedidos/); // la ruta no cambia
    const card = await page.getByLabel('Tus ventas', { exact: true }).boundingBox();
    const m = page.getByTestId('ventas-mascot');
    await expect(m).toBeVisible();
    const mb = await m.boundingBox();
    expect(card && mb).toBeTruthy();
    expect(mb!.x).toBeGreaterThan(card!.x + card!.width / 2); // asoma por la derecha, los números a la izquierda
    expect(mb!.y).toBeLessThan(card!.y + card!.height); // dentro del cuadro
    // los dos pedidos caben en la primera página, sin scroll
    // (cada seed crea el producto publicado + su pedido: 4 filas; la primera página muestra al menos 2)
    const rows = page.getByRole('button').filter({ hasText: '₡' });
    await expect(rows.nth(0)).toBeInViewport({ ratio: 0.99 });
    await expect(rows.nth(1)).toBeInViewport({ ratio: 0.99 });
    await page.waitForTimeout(400);
    await expectNoScroll(page);
  });

  test('ANIM-02 universo detrás de la app, cubre la pantalla; solo transform/opacity; pausa con la pestaña oculta', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    const u = page.locator('#u');
    await expect(u).toHaveCSS('position', 'absolute'); // pegado al body, que no scrollea
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    const ub = (await u.boundingBox())!; const vp = page.viewportSize()!;
    expect([ub.x, ub.y, Math.round(ub.width), Math.round(ub.height)]).toEqual([0, 0, vp.width, vp.height]); // cubre la pantalla exacta
    await expect(u).toHaveCSS('pointer-events', 'none');
    const kf = await keyframeProps(page);
    expect(kf.names).toEqual(expect.arrayContaining(['u-d1', 'u-d2', 'u-d3', 'u-tw', 'u-tw2', 'u-spark', 'u-glint', 'u-neb', 'u-shoot', 'u-p1', 'u-p2', 'u-p3', 'm-bob']));
    expect(kf.props.length).toBeGreaterThan(0);
    for (const p of kf.props) expect(['transform', 'opacity']).toContain(p);
    // corre (hay animaciones activas) y no hay transiciones en el universo
    const live = await page.evaluate(() => document.getElementById('u')!.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length);
    expect(live).toBeGreaterThanOrEqual(10);
    // pestaña oculta -> todo en pausa
    await page.evaluate(() => document.documentElement.classList.add('bg-hidden'));
    const states = await page.evaluate(() => Array.from(document.querySelectorAll('#u *')).map((e) => getComputedStyle(e).animationPlayState));
    expect(states.every((s) => s === 'paused')).toBe(true);
  });

  test('ANIM-03 cambiar de pestaña no reinicia el fondo (mismo nodo, el reloj sigue)', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.waitForTimeout(600);
    const t0 = await page.evaluate(() => { (window as any).__u = document.getElementById('u'); return Number(document.querySelector('#u .u-l3')!.getAnimations()[0].currentTime); });
    await page.getByRole('tab', { name: 'Comprar' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ same: (window as any).__u === document.getElementById('u'), t: Number(document.querySelector('#u .u-l3')!.getAnimations()[0].currentTime) }));
    expect(r.same).toBe(true);
    expect(r.t).toBeGreaterThan(t0);
  });
  test('ANIM-05 planetas discretos: visibles, tenues, sin tapar el formulario ni recibir toques', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    const ids = ['planet-ringed', 'planet-moon', 'planet-tiny'];
    const vp = page.viewportSize()!;
    // contenido clave del Vender: título, importar, campos, fotos, Entrega y plazo, Generar link, los avisos y las pestañas
    const key = [page.getByText('Vender', { exact: true }).first(), page.getByText('Importar de un link'), page.getByPlaceholder(/iPhone 13/),
      page.locator('input').nth(1), page.getByText('Tomar', { exact: true }), page.getByText('Generar link'), page.getByRole('tablist'),
      page.getByRole('button', { name: 'Entrega y plazo' }), page.getByTestId('sell-photos'), page.getByTestId('rules-hint'), page.getByTestId('beta-notice')];
    const boxes = (await Promise.all(key.map((l) => l.first().boundingBox()))).filter(Boolean) as { x: number; y: number; width: number; height: number }[];
    expect(boxes.length).toBeGreaterThanOrEqual(11);
    for (const id of ids) {
      const pl = page.locator(`#u [data-testid="${id}"]`);
      await expect(pl).toHaveCount(1);
      const st = await pl.evaluate((e) => { const c = getComputedStyle(e); return { op: Number(c.opacity), pe: c.pointerEvents, anim: c.animationName, dur: parseFloat(c.animationDuration) }; });
      expect(st.op).toBeGreaterThanOrEqual(0.35); expect(st.op).toBeLessThanOrEqual(0.75); // tenue
      expect(st.pe).toBe('none');
      expect(st.anim).toMatch(/^u-p\d$/); expect(st.dur).toBeGreaterThanOrEqual(30); // deriva muy lenta
      const b = (await pl.boundingBox())!;
      expect(b.width).toBeLessThanOrEqual(64);
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      // margen para el anillo y el brillo: no se cruza con el contenido clave
      const m = id === 'planet-ringed' ? 22 : 6;
      for (const k of boxes) {
        const hit = b.x - m < k.x + k.width && b.x + b.width + m > k.x && b.y - m < k.y + k.height && b.y + b.height + m > k.y;
        expect(hit, `${id} ${JSON.stringify(b)} tapa ${JSON.stringify(k)}`).toBe(false);
      }
      // un toque sobre el planeta llega a la app, no al universo
      const under = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#u'), [b.x + b.width / 2, b.y + b.height / 2]);
      expect(under).toBe(false);
    }
    await expectNoScroll(page);
  });

  test('ANIM-06 estrellas que brillan: titileo con ritmos distintos y destellos en cruz', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    const r = await page.evaluate(() => {
      const a = document.getElementById('u')!.getAnimations({ subtree: true }) as CSSAnimation[];
      const tw = a.filter((x) => /^u-(tw2?|spark|glint)$/.test(x.animationName));
      return {
        n: tw.length, running: tw.filter((x) => x.playState === 'running').length,
        durs: [...new Set(tw.map((x) => Number((x.effect as KeyframeEffect).getTiming().duration)))],
        curves: [...new Set(tw.map((x) => x.animationName))],
        cross: document.querySelectorAll('#u .u-x').length,
        ray: getComputedStyle(document.querySelector('#u .u-x')!, '::before').width,
      };
    });
    expect(r.n).toBeGreaterThanOrEqual(16);
    expect(r.running).toBe(r.n);
    expect(r.durs.length).toBeGreaterThanOrEqual(12); // no parpadean al unísono
    expect(r.curves).toEqual(expect.arrayContaining(['u-tw', 'u-tw2', 'u-spark', 'u-glint']));
    expect(r.cross).toBeGreaterThanOrEqual(4);
    expect(parseFloat(r.ray)).toBeGreaterThanOrEqual(8); // rayos visibles
    // brillo visible: una estrella-destello cambia de opacidad en ~1 s
    const op = () => page.evaluate(() => Array.from(document.querySelectorAll('#u .u-x')).map((e) => Number(getComputedStyle(e).opacity)));
    const a = await op(); await page.waitForTimeout(900); const b = await op();
    expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeGreaterThan(0.15);
  });
});

test.describe('Reducir movimiento', () => {
  test.use({ reducedMotion: 'reduce' });
  test('ANIM-04 con reducir movimiento el universo es estático (sin animación, sin titileo ni estrella fugaz; planetas quietos)', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    const r = await page.evaluate(() => ({
      names: [...new Set(Array.from(document.querySelectorAll('#u *')).map((e) => getComputedStyle(e).animationName))],
      running: document.getElementById('u')!.getAnimations({ subtree: true }).length,
      shoot: getComputedStyle(document.querySelector('#u .u-shoot')!).display,
    }));
    expect(r.names).toEqual(['none']);
    expect(r.running).toBe(0);
    expect(r.shoot).toBe('none');
    // planetas quietos pero presentes; destellos sin titileo
    for (const id of ['planet-ringed', 'planet-moon', 'planet-tiny']) await expect(page.locator(`#u [data-testid="${id}"]`)).toBeVisible();
    const a = await page.locator('#u').screenshot();
    await page.waitForTimeout(1200);
    const b = await page.locator('#u').screenshot();
    expect(Buffer.compare(a, b)).toBe(0); // imagen quieta
  });
});
