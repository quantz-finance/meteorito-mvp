// (92) Animación de entrada ÚNICA en toda la app: fade + subida corta (8–12 px), 250–300 ms ease-out, escalonada 40–60 ms
//      entre bloques hermanos con tope (todo visible en ~0,5 s), se repite al volver a la pantalla, instantánea con reducir
//      movimiento y en navegadores automatizados (los tests no dependen del tiempo). Solo transform/opacity.
import type { T } from './setup';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APPEAR, APPEAR_TEST_JS, appearCss, appearCycle, appearDelay, appearTotalMs } from '../../lib/appearCore';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) ? [p] : []; });

export async function run(t: T) {
  t.check('fade + subida de 8–12 px', APPEAR.distancePx >= 8 && APPEAR.distancePx <= 12);
  t.check('duración 250–300 ms, ease-out', APPEAR.durationMs >= 250 && APPEAR.durationMs <= 300 && /cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(APPEAR.easing));
  t.check('escalonado 40–60 ms entre hermanos', APPEAR.stepMs >= 40 && APPEAR.stepMs <= 60 && appearDelay(1) - appearDelay(0) === APPEAR.stepMs);
  t.check('tope: el bloque 20 sale igual que el último escalón', appearDelay(20) === appearDelay(APPEAR.maxSteps) && appearDelay(-3) === 0);
  t.check('pantalla completa en ~0,5 s (raíz <= 520 ms, anidado <= 560 ms)', appearTotalMs() <= 520 && appearTotalMs(true) <= 560, `${appearTotalMs()}/${appearTotalMs(true)}`);
  t.check('ciclo de foco alterna el nombre (reinicia sin remontar)', appearCycle(0) === 'a' && appearCycle(1) === 'b' && appearCycle(2) === 'a');

  const css = appearCss();
  const kfs = [...css.matchAll(/@keyframes (m-ap-[ab])\{(.*?\}\})?/g)];
  t.check('dos keyframes idénticos (a/b)', kfs.length === 2);
  const props = [...css.matchAll(/@keyframes m-ap-[ab]\{from\{([^}]*)\}\}/g)].flatMap((m) => m[1].split(';').map((d) => d.split(':')[0]));
  t.check('solo transform/opacity', props.length > 0 && props.every((p) => p === 'opacity' || p === 'transform'), props.join(','));
  t.check('termina en el estilo propio (sin "to", fill backwards: no pisa el apretado ni la opacidad de deshabilitado)', !/m-ap-a\{[^@]*to\{/.test(css) && /backwards/.test(css) && !/m-ap-a \d+ms [^;}]* both/.test(css));
  t.check('raíz, anidado e ítems con retrasos escalonados', /\[data-appear\]>:nth-child\(2\)\{animation-delay:40ms\}/.test(css) && /\[data-appear-sub\]>:nth-child\(1\)\{animation-delay:60ms\}/.test(css) && /\[data-appear-item\]\[data-ai="5"\]\{animation-delay:200ms\}/.test(css));
  t.check('contenedores anidados/grillas no se suman a la entrada de sus hijos', /\[data-appear\]>\[data-appear-sub\],\[data-appear\]>\[data-appear-skip\]/.test(css));
  t.check('reducir movimiento: instantánea', /prefers-reduced-motion: reduce\)\{\[data-appear\]>\*,\[data-appear-sub\]>\*,\[data-appear-item\]\{animation:none!important\}\}/.test(css));
  t.check('pestaña oculta: en pausa', /html\.bg-hidden \[data-appear\]>\*/.test(css));
  t.check('navegador automatizado: instantánea salvo meteorito:e2e-anim=1 (tests sin depender del tiempo)', /navigator\.webdriver/.test(APPEAR_TEST_JS) && /meteorito:e2e-anim/.test(APPEAR_TEST_JS) && /html\.no-appear/.test(css));
  t.check('el CSS y el script van en el HTML', /appearCss\(\)/.test(src('constants/motion.ts')) && /APPEAR_TEST_JS/.test(src('app/+html.tsx')));
  t.check('el CSS de entrada va ANTES de los data-anim (las animaciones propias ganan)', src('constants/motion.ts').indexOf('${appearCss()}') < src('constants/motion.ts').indexOf('@keyframes m-enter'));

  const ap = src('components/Appear.tsx');
  t.check('primitivo: Appear, AppearGroup, AppearSub, appearItem, appearSkip y useAppearCycle', ['export function Appear(', 'export function AppearGroup(', 'export function AppearSub(', 'export const appearItem', 'export const appearSkip', 'export function useAppearCycle('].every((x) => ap.includes(x)));
  t.check('se repite al tomar el foco (useFocusEffect)', /useFocusEffect\(/.test(ap));
  t.check('nativo: driver nativo y reducir movimiento', /useNativeDriver: true/.test(ap) && /useReducedMotion\(\)/.test(ap));

  const ds = src('components/ds.tsx');
  t.check('Screen: toda pantalla entra con el primitivo (encabezado + bloques)', (ds.match(/<AppearBlock cycle=\{cycle\}/g) ?? []).length === 2 && /useAppearCycle\(\)/.test(ds) && !/anim\('enter'\)/.test(ds));
  t.check('una sola animación: sin Reveal ni FadeInDown en la app', walk('app').concat(walk('components')).every((f) => !/<Reveal\b|FadeInDown|FadeIn\./.test(readFileSync(f, 'utf8'))));
  t.check('Comprar (feed): tarjetas escalonadas, la lista no se suma', /appearItem\(useAppear\(\), index \+ 1\)/.test(src('components/Feed.tsx')) && /<FlatList \{\.\.\.appearSkip\}/.test(src('components/Feed.tsx')));
  t.check('grillas (Home, tienda): celdas escalonadas', /appearItem\(cycle, i \* L\.cols \+ j\)/.test(src('components/GridPager.tsx')));
  t.check('Vender, Pagar con link, Mis compras, Home, historial: contenido escalonado', ['app/(tabs)/vender.tsx', 'app/(tabs)/comprar/link.tsx', 'app/(tabs)/comprar/compras.tsx', 'app/(tabs)/pedidos.tsx', 'app/ventas.tsx'].every((f) => /<AppearSub /.test(src(f))));
  t.check('chat y bienvenida (sin Screen) también', /<AppearGroup /.test(src('app/chat.tsx')) && /useAppearCycle\(\)/.test(src('components/Welcome.tsx')) && /<Appear i=\{0\}>/.test(src('components/Welcome.tsx')));
}
