// (47) Universo animado (web) + "Home": solo transform/opacity, estático con reducir movimiento, pausa en segundo plano.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { ANIMATED_PROPS, STAR_GROUPS, UNIVERSE_HTML, UNIVERSE_KEYFRAMES, universeCss } from '../../constants/universe';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

/** Propiedades usadas dentro de cada @keyframes (entre llaves internas). */
function keyframeProps(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/@keyframes\s+[\w-]+\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
    for (const b of m[1].matchAll(/\{([^{}]*)\}/g)) for (const d of b[1].split(';')) { const p = d.split(':')[0].trim(); if (p) out.push(p); }
  }
  return out;
}

export async function run(t: T) {
  const css = universeCss({ far: '/f.webp', near: '/n.webp', nebula: '/neb.webp' });
  const props = [...new Set(keyframeProps(UNIVERSE_KEYFRAMES.join('')))];
  t.check('universo: las @keyframes solo animan transform/opacity', props.length > 0 && props.every((p) => (ANIMATED_PROPS as readonly string[]).includes(p)), props.join(','));
  t.check('universo: las @keyframes del meteorito (bob) solo transform', [...new Set(keyframeProps(src('constants/motion.ts').match(/@keyframes m-bob\{.*?\}\}/)?.[0] ?? ''))].join() === 'transform');
  t.check('universo: sin transiciones ni animación de layout (width/height/top/left/filter)', !/transition|animation:[^;}]*(width|height|top|left|filter)/.test(css));
  t.check('universo: reducir movimiento -> sin animación y sin estrella fugaz', /@media \(prefers-reduced-motion: reduce\)\{#u \*\{animation:none!important\}#u \.u-shoot\{display:none\}\}/.test(css));
  t.check('universo: pestaña oculta -> pausa', css.includes('html.bg-hidden #u *{animation-play-state:paused!important}'));
  t.check('universo: 3 profundidades con velocidades distintas (parallax)', ['u-d1 150s', 'u-d2 95s', 'u-d3 60s'].every((x) => css.includes(x)) && new Set(STAR_GROUPS.map((g) => g.depth)).size === 3);
  t.check('universo: titileo escalonado (ritmos y desfases distintos)', new Set(STAR_GROUPS.map((g) => `${g.tw}/${g.delay}`)).size === STAR_GROUPS.length);
  t.check('universo: pegado al body (no scrollea), recortado, detrás de la app, sin eventos', css.includes('html{overflow:hidden}body{position:relative}') && /#u\{position:absolute;inset:0;z-index:0;overflow:hidden;[^}]*pointer-events:none/.test(css) && css.includes('#root{position:relative;z-index:1}'));
  t.check('universo: estrella fugaz ocasional (2 pasadas por ciclo de 23 s)', /u-shoot 23s/.test(css) && /46%\{opacity:1\}/.test(UNIVERSE_KEYFRAMES.join('')));
  t.check('universo: pocos nodos (estrellas en box-shadow, no un nodo por estrella)', (UNIVERSE_HTML.match(/<div/g) ?? []).length <= 30);
  const html = src('app/+html.tsx');
  t.check('HTML: el universo se pinta una vez fuera de React', /<div id="u" aria-hidden="true"/.test(html) && html.includes('UNIVERSE_CSS'));
  t.check('Home: etiqueta de la pestaña', /name="pedidos" options=\{\{ title: 'Home' \}\}/.test(src('app/(tabs)/_layout.tsx')));
  t.check('Home: título de la pantalla (la ruta sigue /pedidos)', /<Screen title="Home"/.test(src('app/(tabs)/pedidos.tsx')));
  t.check('Home: ícono de casa en la pestaña (no la caja)', /pedidos: \(\{ color, fill \}\) => <><Path d="M3 10a2 2 0 0 1 \.7-1\.5l7-6/.test(src('components/TabBar.tsx')) && !/M11 21\.7a2 2 0 0 0 2 0l7-4/.test(src('components/TabBar.tsx')));
  t.check('Tus ventas: meteorito decorativo', /testID="ventas-mascot"/.test(src('components/SalesSummary.tsx')) && /LivelyMascot/.test(src('components/SalesSummary.tsx')));
}
