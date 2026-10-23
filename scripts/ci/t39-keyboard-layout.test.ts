// (39) Teclado iOS: el alto de la pantalla no cambia al abrir el teclado (visualViewport se achica, el layout no).
// Encabezado compartido: el título siempre en el mismo punto. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { editableFocused, nextStable } from '../../lib/viewportCore';

export async function run(t: T) {
  const s0 = { width: 375, height: 667 };
  t.check('primera medida se toma tal cual', nextStable(null, s0, false) === s0);
  t.check('teclado abierto (campo enfocado): el alto NO baja', nextStable(s0, { width: 375, height: 351 }, true) === s0);
  t.check('sin teclado: acepta un alto menor (p. ej. barra del navegador)', nextStable(s0, { width: 375, height: 600 }, false).height === 600);
  t.check('crece siempre (teclado cerrado / barra oculta)', nextStable(s0, { width: 375, height: 700 }, true).height === 700);
  t.check('giro del teléfono (cambia el ancho): nuevo tamaño aunque haya teclado', nextStable(s0, { width: 667, height: 300 }, true).width === 667);
  const el = (tagName: string, type?: string) => ({ activeElement: { tagName, type, isContentEditable: false } as any });
  t.check('campo de texto / numérico / textarea cuentan como teclado', editableFocused(el('INPUT', 'text')) && editableFocused(el('INPUT', 'tel')) && editableFocused(el('TEXTAREA')));
  t.check('botón, checkbox o archivo NO cuentan como teclado', !editableFocused(el('INPUT', 'checkbox')) && !editableFocused(el('INPUT', 'file')) && !editableFocused(el('BUTTON')) && !editableFocused({ activeElement: null } as any));
  const html = readFileSync(new URL('../../app/+html.tsx', import.meta.url), 'utf8');
  t.check('viewport: interactive-widget=resizes-visual y #root con alto estable (--app-h)', /interactive-widget=resizes-visual/.test(html) && /#root\{height:100%;height:var\(--app-h,100dvh\)/.test(html));
  const ds = readFileSync(new URL('../../components/ds.tsx', import.meta.url), 'utf8');
  t.check('ds: Screen y Sheet usan el alto estable, no useWindowDimensions', !/useWindowDimensions\(\)/.test(ds) && /useStableWindow\(\)/.test(ds));
  t.check('ds: ScreenHeader compartido con fila de alto fijo', /export function ScreenHeader/.test(ds) && /header: \{[^}]*minHeight: TOUCH/.test(ds));
  for (const f of ['app/(tabs)/pedidos.tsx', 'app/(tabs)/vender.tsx', 'app/(tabs)/comprar.tsx', 'app/i/nueva.tsx', 'components/GridPager.tsx', 'components/Welcome.tsx']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    t.check(`${f}: sin useWindowDimensions (alto con teclado)`, !/useWindowDimensions/.test(src));
  }
}
