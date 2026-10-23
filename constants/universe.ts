// Universo animado (web): se pinta UNA vez en el HTML (app/+html.tsx), fuera de React. Nunca se re-renderiza ni se
// reinicia al cambiar de pestaña. Solo CSS @keyframes con transform/opacity (compositor de la GPU, 0 JS por frame).
// Capas: nebulosa que respira, 3 profundidades de estrellas que derivan a distinta velocidad (parallax),
// estrellas que titilan escalonadas, destellos que laten y una estrella fugaz ocasional (~10–13 s).
// Pestaña oculta -> html.bg-hidden pausa todo. prefers-reduced-motion -> estático (sin animación, sin fugaz).

/** Generador determinista (mismo cielo en cada build y en el servidor/cliente). */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r2 = (n: number) => Math.round(n * 100) / 100;
/** box-shadow de n estrellas en vw/vh: una sola caja pinta muchas estrellas (1 capa de GPU, no n nodos). */
function starShadows(n: number, seed: number, alpha: [number, number], blur = 0): string {
  const rnd = rng(seed);
  return Array.from({ length: n }, () => {
    const a = r2(alpha[0] + rnd() * (alpha[1] - alpha[0]));
    const tint = rnd() < 0.18 ? `rgba(201,182,255,${a})` : rnd() < 0.1 ? `rgba(255,200,150,${a})` : `rgba(255,255,255,${a})`;
    return `${r2(rnd() * 112)}vw ${r2(rnd() * 112)}vh ${blur}px ${tint}`;
  }).join(',');
}

/** Grupos de estrellas: profundidad (deriva), tamaño, cuántas y ritmo de titileo. */
export const STAR_GROUPS = [
  { depth: 1, size: 1, n: 70, seed: 11, tw: 5.7, delay: -1.2, alpha: [0.35, 0.7] as [number, number] },
  { depth: 1, size: 1, n: 60, seed: 23, tw: 4.3, delay: -3.1, alpha: [0.3, 0.65] as [number, number] },
  { depth: 2, size: 1.5, n: 40, seed: 37, tw: 3.7, delay: -0.6, alpha: [0.5, 0.9] as [number, number] },
  { depth: 2, size: 1.5, n: 34, seed: 41, tw: 6.1, delay: -2.4, alpha: [0.45, 0.85] as [number, number] },
  { depth: 3, size: 2, n: 18, seed: 53, tw: 3.1, delay: -1.7, alpha: [0.7, 1] as [number, number] },
  { depth: 3, size: 2, n: 16, seed: 67, tw: 4.9, delay: -0.3, alpha: [0.65, 1] as [number, number] },
];
/** Destellos: estrellas grandes que laten (escala + opacidad), escalonadas. [left vw, top vh, dur s, delay s] */
const SPARKS: [number, number, number, number][] = [[12, 14, 4.2, -0.4], [78, 9, 5.1, -2.2], [64, 31, 3.6, -1.1], [22, 46, 4.8, -3.3],
  [88, 52, 4.4, -0.9], [8, 71, 5.6, -2.7], [52, 63, 3.9, -1.8], [71, 84, 4.6, -0.2]];

/** Propiedades que las @keyframes pueden tocar (el test lo verifica): nada que dispare layout ni paint. */
export const ANIMATED_PROPS = ['transform', 'opacity'] as const;

export const UNIVERSE_KEYFRAMES = [
  // deriva lenta por profundidad: lejos casi quieto, cerca un poco más (parallax)
  '@keyframes u-d1{from{transform:translate3d(-1.2vw,-0.8vh,0)}to{transform:translate3d(1.2vw,0.8vh,0)}}',
  '@keyframes u-d2{from{transform:translate3d(2.4vw,-1.6vh,0)}to{transform:translate3d(-2.4vw,1.6vh,0)}}',
  '@keyframes u-d3{from{transform:translate3d(-4vw,2.4vh,0)}to{transform:translate3d(4vw,-2.4vh,0)}}',
  '@keyframes u-tw{0%,100%{opacity:1}50%{opacity:.28}}',
  '@keyframes u-spark{0%,100%{opacity:.25;transform:scale(.55)}50%{opacity:1;transform:scale(1.25)}}',
  '@keyframes u-neb{0%{opacity:.62;transform:translate3d(0,0,0) scale(1)}100%{opacity:.95;transform:translate3d(5vw,-3vh,0) scale(1.1)}}',
  // una sola estrella fugaz, dos pasadas por ciclo de 23 s (cada ~10–13 s), en alturas distintas
  '@keyframes u-shoot{0%{opacity:0;transform:translate3d(0,0,0)}1%{opacity:1}5%{opacity:0;transform:translate3d(-95vw,0,0)}'
    + '5.01%,44.99%{opacity:0;transform:translate3d(0,28vh,0)}46%{opacity:1}50%{opacity:0;transform:translate3d(-95vw,28vh,0)}100%{opacity:0;transform:translate3d(-95vw,28vh,0)}}',
];

export function universeCss(img: { far: string; near: string; nebula: string }): string {
  const groups = STAR_GROUPS.map((g, i) => `#u .u-g${i}{width:${g.size}px;height:${g.size}px;border-radius:50%;box-shadow:${starShadows(g.n, g.seed, g.alpha, g.size > 1.5 ? 1 : 0)};animation:u-tw ${g.tw}s ease-in-out ${g.delay}s infinite}`).join('');
  const sparks = SPARKS.map(([l, t, d, dl], i) => `#u .u-s${i}{left:${l}vw;top:${t}vh;animation:u-spark ${d}s ease-in-out ${dl}s infinite}`).join('');
  return UNIVERSE_KEYFRAMES.join('')
    // Pegado al body, que nunca scrollea (alto fijo, overflow hidden): igual que fixed a la vista, pero sus capas
    // (más grandes que la pantalla para la deriva) quedan recortadas por el body y nunca suman alto de scroll (WebKit).
    + 'html{overflow:hidden}body{position:relative}'
    + '#u{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#1A0B3D;contain:strict}'
    + '#root{position:relative;z-index:1}'
    + '#u div,#u img{position:absolute}'
    + `#u .u-neb{left:-60vw;top:-15vh;width:220vw;height:130vh;background:url(${img.nebula}) center/100% 100% no-repeat;animation:u-neb 19s ease-in-out infinite alternate;will-change:transform,opacity}`
    + `#u .u-far{inset:-6vh -6vw;background:url(${img.far}) center/cover;opacity:.75}`
    + `#u .u-near{inset:-6vh -6vw;background:url(${img.near}) center/cover;opacity:.85}`
    + '#u .u-l1{inset:-6vh -6vw;animation:u-d1 150s ease-in-out infinite alternate;will-change:transform}'
    + '#u .u-l2{inset:-6vh -6vw;animation:u-d2 95s ease-in-out infinite alternate;will-change:transform}'
    + '#u .u-l3{inset:-6vh -6vw;animation:u-d3 60s ease-in-out infinite alternate;will-change:transform}'
    + '#u .u-l1>div,#u .u-l2>div,#u .u-l3>div{left:0;top:0}'
    + groups
    + '#u .u-sp{width:3px;height:3px;border-radius:50%;background:#fff;box-shadow:0 0 6px 2px rgba(201,182,255,.7),0 0 14px 4px rgba(255,255,255,.18)}'
    + sparks
    + '#u .u-shoot{left:70vw;top:4vh;transform:rotate(-24deg);transform-origin:left center}'
    + '#u .u-streak{width:130px;height:2px;border-radius:2px;background:linear-gradient(90deg,#fff 0,rgba(255,216,170,.75) 12%,rgba(201,182,255,0) 100%);'
    + 'box-shadow:0 0 6px rgba(255,255,255,.55);opacity:0;animation:u-shoot 23s cubic-bezier(.3,.6,.4,1) 4s infinite;will-change:transform,opacity}'
    + 'html.bg-hidden #u *{animation-play-state:paused!important}'
    + '@media (prefers-reduced-motion: reduce){#u *{animation:none!important}#u .u-shoot{display:none}}';
}

export const UNIVERSE_HTML = '<div class="u-neb"></div>'
  + '<div class="u-l1"><div class="u-far"></div>' + [0, 1].map((i) => `<div class="u-g${i}"></div>`).join('') + '</div>'
  + '<div class="u-l2"><div class="u-near"></div>' + [2, 3].map((i) => `<div class="u-g${i}"></div>`).join('') + '</div>'
  + '<div class="u-l3">' + [4, 5].map((i) => `<div class="u-g${i}"></div>`).join('') + SPARKS.map((_, i) => `<div class="u-sp u-s${i}"></div>`).join('') + '</div>'
  + '<div class="u-shoot"><div class="u-streak"></div></div>';
