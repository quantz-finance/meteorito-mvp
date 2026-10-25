// Animación de entrada ÚNICA de la app (lógica pura, se prueba en Node: t91). Cada bloque aparece con fade + subida corta,
// escalonado entre hermanos, con tope para que la pantalla quede completa en ~0,5 s. Se repite al volver a la pantalla.
export const APPEAR = {
  durationMs: 280,
  distancePx: 10,
  stepMs: 40,
  maxSteps: 5,
  /** Grupo anidado (p. ej. el formulario dentro de la pantalla): arranca un poco después del encabezado. */
  subBaseMs: 60,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

/** Retraso del hermano i (0, 40, 80… con tope). */
export const appearDelay = (i: number, base = 0) => base + Math.min(Math.max(0, Math.floor(i) || 0), APPEAR.maxSteps) * APPEAR.stepMs;
/** Tiempo hasta que el último bloque termina (raíz y anidado). */
export const appearTotalMs = (sub = false) => appearDelay(APPEAR.maxSteps, sub ? APPEAR.subBaseMs : 0) + APPEAR.durationMs;
/** Ciclo de foco -> nombre de animación. Alternar el nombre reinicia la animación CSS sin remontar (no se pierde lo escrito). */
export const appearCycle = (n: number): 'a' | 'b' => (n % 2 ? 'b' : 'a');

/** CSS (web): raíz [data-appear], anidado [data-appear-sub] (el contenedor no se anima, sus hijos sí) e ítems sueltos
 *  [data-appear-item] con [data-ai]. Solo transform/opacity. html.no-appear (navegador automatizado) y reducir movimiento: sin animación. */
export function appearCss(): string {
  const { durationMs: d, distancePx: y, easing } = APPEAR;
  // Sin 'to' y con fill backwards: termina en el estilo propio del elemento (su opacidad de deshabilitado, su escala al
  // apretar) y después no lo pisa.
  const kf = (n: string) => `@keyframes m-ap-${n}{from{opacity:0;transform:translate3d(0,${y}px,0)}}`;
  const anim = (n: string) => `animation:m-ap-${n} ${d}ms ${easing} backwards`;
  const steps = Array.from({ length: APPEAR.maxSteps + 1 }, (_, i) => i);
  const nth = (i: number) => (i === APPEAR.maxSteps ? `:nth-child(n+${i + 1})` : `:nth-child(${i + 1})`);
  return kf('a') + kf('b')
    + ['a', 'b'].map((n) => `[data-appear="${n}"]>*,[data-appear-sub="${n}"]>*,[data-appear-item="${n}"]{${anim(n)}}`).join('')
    + '[data-appear]>[data-appear-sub],[data-appear]>[data-appear-skip],[data-appear-sub]>[data-appear-skip]{animation:none}'
    + steps.map((i) => `[data-appear]>${nth(i)}{animation-delay:${appearDelay(i)}ms}`).join('')
    + steps.map((i) => `[data-appear-sub]>${nth(i)}{animation-delay:${appearDelay(i, APPEAR.subBaseMs)}ms}`).join('')
    + steps.map((i) => `[data-appear-item][data-ai="${i}"]{animation-delay:${appearDelay(i)}ms}`).join('')
    + 'html.no-appear [data-appear]>*,html.no-appear [data-appear-sub]>*,html.no-appear [data-appear-item]{animation:none!important}'
    + 'html.bg-hidden [data-appear]>*,html.bg-hidden [data-appear-sub]>*,html.bg-hidden [data-appear-item]{animation-play-state:paused}'
    + '@media (prefers-reduced-motion: reduce){[data-appear]>*,[data-appear-sub]>*,[data-appear-item]{animation:none!important}}';
}

/** Script inline (antes del JS): en navegadores automatizados (Playwright) la entrada es instantánea para que los tests no
 *  dependan del tiempo; localStorage 'meteorito:e2e-anim' = '1' la reactiva (el test de la animación). */
export const APPEAR_TEST_JS = "try{if(navigator.webdriver&&localStorage.getItem('meteorito:e2e-anim')!=='1')document.documentElement.classList.add('no-appear')}catch(e){}";
