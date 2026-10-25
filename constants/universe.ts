// Universo animado (web): se pinta UNA vez en el HTML (app/+html.tsx), fuera de React. Nunca se re-renderiza ni se
// reinicia al cambiar de pestaña. Solo CSS @keyframes con transform/opacity (compositor de la GPU, 0 JS por frame).
// Capas: nebulosa que respira, 3 profundidades de estrellas que derivan a distinta velocidad (parallax),
// estrellas que titilan escalonadas (dos curvas, ritmos distintos), destellos en cruz que brillan, 3 planetas tenues
// que derivan muy lento y una estrella fugaz ocasional (~10–13 s).
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
/** Destellos: estrellas brillantes, cada una con su ritmo. 'x' = destello en cruz (rayos en ::before/::after, gira un poco
 *  al brillar); 'o' = punto con halo que late. [left vw, top vh, dur s, delay s, tipo, color] */
type Spark = [number, number, number, number, 'x' | 'o', string];
export const SPARKS: Spark[] = [ // en cruz: en huecos del Vender (nunca sobre tarjetas translúcidas, iconos ni textos)
  [60, 5, 4.2, -0.4, 'x', '255,255,255'], [78, 9, 5.3, -2.2, 'o', '201,182,255'], [64, 30.5, 3.4, -1.1, 'x', '255,214,170'],
  [33, 50, 4.8, -3.3, 'o', '255,255,255'], [92, 40.5, 6.2, -0.9, 'x', '201,182,255'], [6, 84, 5.6, -2.7, 'o', '255,214,170'],
  [52, 57, 3.9, -1.8, 'x', '255,255,255'], [71, 86, 4.6, -0.2, 'o', '201,182,255'], [38, 6, 2.9, -1.4, 'o', '255,255,255'],
  [40, 70, 5.9, -4.1, 'x', '255,214,170'], [30, 24, 3.2, -2.6, 'o', '201,182,255'], [84, 66, 4.4, -3.7, 'o', '255,255,255'],
];
/** Planetas: pocos, chicos, tenues y lentos (decoran sin competir con la UI). Colocados en zonas libres del Vender: a los
 *  costados del círculo "Generar link" (su escenario propio, ~60–70 vh en 375×667, 390×844 y 390×844 con la barra de estado
 *  del PWA), nunca detrás de textos ni avisos (e2e ANIM-05). */
export const PLANETS = [
  // gigante con anillo (morado/índigo con una banda naranja), inclinado, se mece y deriva ~70 s
  { id: 'planet-ringed', cls: 'u-pl1', left: '84vw', top: '59.5vh', size: 46, opacity: 0.68, anim: 'u-p1', dur: 70, ring: true },
  // luna naranja con cráteres suaves (~48 s)
  { id: 'planet-moon', cls: 'u-pl2', left: '3vw', top: '67vh', size: 20, opacity: 0.62, anim: 'u-p2', dur: 48, ring: false },
  // planeta lejano, un punto lila-azul (~36 s)
  { id: 'planet-tiny', cls: 'u-pl3', left: '10vw', top: '62vh', size: 8, opacity: 0.6, anim: 'u-p3', dur: 36, ring: false },
];

/** Propiedades que las @keyframes pueden tocar (el test lo verifica): nada que dispare layout ni paint. */
export const ANIMATED_PROPS = ['transform', 'opacity'] as const;

export const UNIVERSE_KEYFRAMES = [
  // deriva lenta por profundidad: lejos casi quieto, cerca un poco más (parallax)
  '@keyframes u-d1{from{transform:translate3d(-1.2vw,-0.8vh,0)}to{transform:translate3d(1.2vw,0.8vh,0)}}',
  '@keyframes u-d2{from{transform:translate3d(2.4vw,-1.6vh,0)}to{transform:translate3d(-2.4vw,1.6vh,0)}}',
  '@keyframes u-d3{from{transform:translate3d(-4vw,2.4vh,0)}to{transform:translate3d(4vw,-2.4vh,0)}}',
  // titileo marcado e irregular; dos curvas alternadas entre grupos para que nunca parpadeen juntas
  '@keyframes u-tw{0%,100%{opacity:1}22%{opacity:.38}46%{opacity:.95}68%{opacity:.12}86%{opacity:.82}}',
  '@keyframes u-tw2{0%,100%{opacity:.3}30%{opacity:1}52%{opacity:.55}74%{opacity:1}90%{opacity:.14}}',
  // destello en cruz: crece, brilla y gira un poco; punto con halo: late
  '@keyframes u-spark{0%,100%{opacity:.12;transform:scale(.4) rotate(0deg)}45%{opacity:1;transform:scale(1.15) rotate(22deg)}60%{opacity:.7;transform:scale(.9) rotate(30deg)}}',
  '@keyframes u-glint{0%,100%{opacity:.2;transform:scale(.6)}40%{opacity:1;transform:scale(1.3)}58%{opacity:.55;transform:scale(1)}}',
  // planetas: deriva de pocos px en decenas de segundos (el anillo se mece unos grados)
  '@keyframes u-p1{from{transform:translate3d(0,0,0) rotate(-18deg)}to{transform:translate3d(-10px,9px,0) rotate(-11deg)}}',
  '@keyframes u-p2{from{transform:translate3d(0,0,0)}to{transform:translate3d(9px,-11px,0)}}',
  '@keyframes u-p3{from{transform:translate3d(0,0,0)}to{transform:translate3d(-7px,-5px,0)}}',
  '@keyframes u-neb{0%{opacity:.62;transform:translate3d(0,0,0) scale(1)}100%{opacity:.95;transform:translate3d(5vw,-3vh,0) scale(1.1)}}',
  // una sola estrella fugaz, dos pasadas por ciclo de 23 s (cada ~10–13 s), en alturas distintas
  '@keyframes u-shoot{0%{opacity:0;transform:translate3d(0,0,0)}1%{opacity:1}5%{opacity:0;transform:translate3d(-95vw,0,0)}'
    + '5.01%,44.99%{opacity:0;transform:translate3d(0,28vh,0)}46%{opacity:1}50%{opacity:0;transform:translate3d(-95vw,28vh,0)}100%{opacity:0;transform:translate3d(-95vw,28vh,0)}}',
];

export function universeCss(img: { far: string; near: string; nebula: string }): string {
  const groups = STAR_GROUPS.map((g, i) => `#u .u-g${i}{width:${g.size}px;height:${g.size}px;border-radius:50%;box-shadow:${starShadows(g.n, g.seed, g.alpha, g.size > 1.5 ? 1 : 0)};animation:${i % 2 ? 'u-tw2' : 'u-tw'} ${g.tw}s ease-in-out ${g.delay}s infinite}`).join('');
  const sparks = SPARKS.map(([l, t, d, dl, k, c], i) => `#u .u-s${i}{left:${l}vw;top:${t}vh;--c:${c};animation:${k === 'x' ? 'u-spark' : 'u-glint'} ${d}s ease-in-out ${dl}s infinite}`).join('');
  const planets = PLANETS.map((p) => `#u .${p.cls}{left:${p.left};top:${p.top};width:${p.size}px;height:${p.size}px;opacity:${p.opacity};animation:${p.anim} ${p.dur}s ease-in-out infinite alternate}`).join('');
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
    + '#u .u-sp{width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:#fff;box-shadow:0 0 6px 2px rgba(var(--c),.75),0 0 16px 5px rgba(var(--c),.22)}'
    // rayos de la cruz (heredan la animación del destello; sin animación propia)
    + "#u .u-x::before,#u .u-x::after{content:'';position:absolute;left:-7.25px;top:1px;width:18px;height:1.5px;border-radius:1px;background:linear-gradient(90deg,rgba(var(--c),0),rgba(var(--c),.95) 50%,rgba(var(--c),0))}"
    + '#u .u-x::after{transform:rotate(90deg)}'
    + '#u .u-x{width:3.5px;height:3.5px;margin:-1.75px 0 0 -1.75px}'
    + sparks
    // planetas (sin will-change: la animación ya los sube a su capa; formas en gradientes, sin imágenes)
    + '#u .u-pl{border-radius:50%}'
    + '#u .u-pb{inset:0;border-radius:50%;background:linear-gradient(160deg,rgba(255,138,61,0) 46%,rgba(255,138,61,.28) 52%,rgba(255,138,61,0) 60%),'
    + 'radial-gradient(circle at 34% 28%,#d9ccff 0,#8a63e8 34%,#4b2a9c 68%,#22104f 100%);box-shadow:inset -9px -6px 14px rgba(14,5,38,.6),0 0 22px 2px rgba(138,99,232,.28)}'
    + "#u .u-pl-ring::before,#u .u-pl-ring::after{content:'';position:absolute;left:-24px;top:16px;width:90px;height:14px;border-radius:50%;"
    + 'border:2px solid rgba(255,186,140,.55);box-shadow:0 0 0 3px rgba(201,182,255,.14),inset 0 0 4px rgba(255,186,140,.3)}'
    + '#u .u-pl-ring::after{clip-path:inset(50% 0 0 0)}'
    + '#u .u-pl2{background:radial-gradient(circle at 62% 60%,rgba(150,52,48,.35) 0 2px,transparent 2.6px),radial-gradient(circle at 36% 66%,rgba(150,52,48,.28) 0 1.4px,transparent 2px),'
    + 'radial-gradient(circle at 34% 30%,#ffe4c4 0,#ffa866 36%,#e8743f 66%,#7a2f4c 100%);box-shadow:inset -4px -3px 6px rgba(30,8,30,.55),0 0 12px 1px rgba(255,138,61,.25)}'
    + '#u .u-pl3{background:radial-gradient(circle at 35% 30%,#eee8ff 0,#8f8cf0 52%,#3b2f8a 100%);box-shadow:0 0 6px 1px rgba(160,150,255,.35)}'
    + planets
    + '#u .u-shoot{left:70vw;top:4vh;transform:rotate(-24deg);transform-origin:left center}'
    + '#u .u-streak{width:130px;height:2px;border-radius:2px;background:linear-gradient(90deg,#fff 0,rgba(255,216,170,.75) 12%,rgba(201,182,255,0) 100%);'
    + 'box-shadow:0 0 6px rgba(255,255,255,.55);opacity:0;animation:u-shoot 23s cubic-bezier(.3,.6,.4,1) 4s infinite;will-change:transform,opacity}'
    + 'html.bg-hidden #u *{animation-play-state:paused!important}'
    + '@media (prefers-reduced-motion: reduce){#u *{animation:none!important}#u .u-shoot{display:none}}';
}

export const UNIVERSE_HTML = '<div class="u-neb"></div>'
  + '<div class="u-l1"><div class="u-far"></div>' + [0, 1].map((i) => `<div class="u-g${i}"></div>`).join('') + '</div>'
  + '<div class="u-l2"><div class="u-near"></div>' + [2, 3].map((i) => `<div class="u-g${i}"></div>`).join('') + '</div>'
  + '<div class="u-l3">' + [4, 5].map((i) => `<div class="u-g${i}"></div>`).join('') + SPARKS.map((s, i) => `<div class="u-sp u-s${i}${s[4] === 'x' ? ' u-x' : ''}"></div>`).join('') + '</div>'
  + PLANETS.map((p) => `<div class="u-pl ${p.cls}${p.ring ? ' u-pl-ring' : ''}" data-testid="${p.id}">${p.ring ? '<div class="u-pb"></div>' : ''}</div>`).join('')
  + '<div class="u-shoot"><div class="u-streak"></div></div>';
