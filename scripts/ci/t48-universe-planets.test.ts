// (48) Universo v2: estrellas que titilan de verdad (ritmos distintos, destellos en cruz) + planetas discretos.
// Ligero en iPhone: solo transform/opacity (t47), pocos nodos, sin eventos, estático con reducir movimiento.
import type { T } from './setup';
import { PLANETS, SPARKS, STAR_GROUPS, UNIVERSE_HTML, UNIVERSE_KEYFRAMES, universeCss } from '../../constants/universe';

export async function run(t: T) {
  const css = universeCss({ far: '/f.webp', near: '/n.webp', nebula: '/neb.webp' });
  const kf = UNIVERSE_KEYFRAMES.join('');
  // Planetas: 2–3, chicos/medianos, tenues, deriva muy lenta
  t.check('planetas: entre 2 y 3, uno con anillo', PLANETS.length >= 2 && PLANETS.length <= 3 && PLANETS.some((p) => p.ring), PLANETS.map((p) => p.id).join(','));
  t.check('planetas: cada uno en el HTML con data-testid', PLANETS.every((p) => UNIVERSE_HTML.includes(`data-testid="${p.id}"`)));
  t.check('planetas: chicos/medianos (<= 64 px)', PLANETS.every((p) => p.size <= 64 && p.size >= 6), PLANETS.map((p) => p.size).join(','));
  t.check('planetas: tenues (opacidad <= .75) para no tapar el texto', PLANETS.every((p) => p.opacity <= 0.75 && p.opacity >= 0.35));
  t.check('planetas: deriva muy lenta (>= 30 s por ciclo, ritmos distintos)', PLANETS.every((p) => p.dur >= 30 && css.includes(`animation:${p.anim} ${p.dur}s`)) && new Set(PLANETS.map((p) => p.dur)).size === PLANETS.length);
  t.check('planetas: sus @keyframes existen y solo mueven poco (transform)', PLANETS.every((p) => new RegExp(`@keyframes ${p.anim}\\{from\\{transform:[^}]*\\}to\\{transform:[^}]*\\}\\}`).test(kf)));
  t.check('planetas: colores de la marca (morado/índigo/naranja)', /#8a63e8|#6b4fd8/i.test(css) && /#ff8a3d|rgba\(255,138,61/i.test(css));
  t.check('planetas: anillo delante/detrás con pseudo-elementos (sin nodos extra ni animación propia)', /::before,#u \.u-pl-ring::after\{content:''/.test(css) && /u-pl-ring::after\{clip-path:inset\(50% 0 0 0\)\}/.test(css) && !/::(before|after)\{[^}]*animation/.test(css));
  // Estrellas que brillan
  t.check('titileo: marcado (baja a <= .15 de opacidad)', /@keyframes u-tw\{[^@]*opacity:\.1[0-5]?\b/.test(kf) || /@keyframes u-tw\{[^@]*opacity:\.12/.test(kf));
  t.check('titileo: dos curvas distintas alternadas entre grupos (no parpadean juntas)', css.includes('animation:u-tw ') && css.includes('animation:u-tw2 ') && /@keyframes u-tw2\{/.test(kf));
  const durs = [...STAR_GROUPS.map((g) => g.tw), ...SPARKS.map((s) => s[2])];
  t.check('titileo: >= 12 ritmos distintos entre grupos y destellos', new Set(durs).size >= 12, String(new Set(durs).size));
  t.check('destellos: >= 10, con >= 4 en cruz (brillo con rayos)', SPARKS.length >= 10 && SPARKS.filter((s) => s[4] === 'x').length >= 4);
  t.check('destellos: rayos de la cruz en pseudo-elementos', /#u \.u-x::before,#u \.u-x::after\{content:''/.test(css));
  // Ligero
  t.check('ligero: <= 30 nodos en el universo', (UNIVERSE_HTML.match(/<div/g) ?? []).length <= 30, String((UNIVERSE_HTML.match(/<div/g) ?? []).length));
  t.check('ligero: will-change solo en pocas capas (<= 5)', (css.match(/will-change/g) ?? []).length <= 5, String((css.match(/will-change/g) ?? []).length));
  t.check('sin eventos: el universo no intercepta toques', /#u\{[^}]*pointer-events:none/.test(css));
  t.check('reducir movimiento: todo quieto (planetas estáticos, sin titileo)', css.includes('@media (prefers-reduced-motion: reduce){#u *{animation:none!important}'));
}
