// (56) Aviso de beta "línea discreta donde importa": texto EXACTO en una sola constante, presente en el pago (antes del
//      botón de pagar), Vender, la hoja del PIN y la de disputa; footnote + icono de información, contraste AA; y la regla
//      "sin etiquetas de prueba" de los e2e solo exceptúa esta constante. El e2e MCK-BETA-01 (iPhone SE) mide el viewport.
//      Guardia de legibilidad: falla si la letra del aviso baja de 12 px o si algún color del aviso queda < 4.5:1 (WCAG AA)
//      contra cualquier fondo donde aparece, en TODOS los temas (tokens reales de constants/theme.ts y constants/Colors.ts).
//      Corre en el check requerido `ci` (npm run test:ci, onchain: false: también sin secretos testnet).
// No quitar sin revisión legal (Neo, Ley 7472).
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { BETA_NOTICE, BETA_NOTICE_LINK } from '../../lib/rules';

const read = (f: string) => readFileSync(f, 'utf8');
type RGB = [number, number, number];
/** '#RRGGBB' o 'rgba(r,g,b,a)' -> RGB; con alfa se compone sobre `under` (como lo pinta el navegador). */
function rgb(v: string, under: RGB = [0, 0, 0]): RGB {
  if (/^#[0-9a-f]{6}$/i.test(v)) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (!m) throw new Error(`color no reconocido: ${v}`);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + under[k] * (1 - a))) as RGB;
}
/** Contraste WCAG 2.x entre un color de texto y un fondo. */
export function contrast(fg: string, bg: string, page = '#000000') {
  const B = rgb(bg, rgb(page)), F = rgb(fg, B);
  const L = (c: RGB) => { const l = c.map((x) => x / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const [x, y] = [L(F), L(B)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05);
}
/** Tokens REALES leídos del código (theme.ts importa react-native, no se puede importar en node). */
function themes() {
  const colors = read('constants/Colors.ts'), theme = read('constants/theme.ts');
  const obj = (src: string, decl: RegExp) => { const i = src.search(decl); const body = src.slice(src.indexOf('{', i) + 1, src.indexOf('};', i)); return body; };
  const Brand: Record<string, string> = {};
  for (const [, k, v] of obj(colors, /export const Brand\s*=/).matchAll(/(\w+):\s*'([^']+)'/g)) Brand[k] = v;
  const resolve = (v: string, C: Record<string, string>) => { v = v.trim(); const q = v.match(/^'([^']+)'$/); if (q) return q[1];
    const r = v.match(/^(Brand|C)\.(\w+)$/); if (r) return (r[1] === 'Brand' ? Brand : C)[r[2]]; throw new Error(`token no resuelto: ${v}`); };
  const C: Record<string, string> = { ...Brand };
  for (const [, k, v] of obj(theme, /export const C\s*=/).matchAll(/^\s*(\w+):\s*([^,\n]+),?\s*$/gm)) C[k] = resolve(v, C);
  // Temas de navegación (light/dark): hoy comparten el mismo objeto, pero si alguno cambia el fondo, se mide igual.
  const named: Record<string, Record<string, string>> = {};
  const themeObj = (ref: string): Record<string, string> => {
    const src = obj(colors, new RegExp(`const ${ref}\\s*=`)), base = src.match(/\.\.\.(\w+)/);
    const t: Record<string, string> = base ? { ...themeObj(base[1]) } : {};
    for (const [, k, v] of src.matchAll(/(\w+):\s*('[^']+'|[\w.]+)/g)) t[k] = resolve(v, C);
    return t;
  };
  const def = colors.match(/export default \{([^}]*)\}/)![1];
  for (const [, name, ref] of def.matchAll(/(\w+):\s*(\w+)/g)) {
    named[name] = themeObj(ref);
  }
  return { C, named, theme };
}

export async function run(t: T) {
  t.check('texto exacto en una sola constante', BETA_NOTICE === 'Beta en testnet, sin dinero real. Meteorito no verifica el producto.' && BETA_NOTICE_LINK === 'Ver cómo funciona');
  const files = ['components/PayBox.tsx', 'components/DisputeSheet.tsx', 'app/(tabs)/vender.tsx', 'components/RulesLink.tsx', 'app/p/[slug].tsx'];
  t.check('nadie copia el texto a mano (solo lib/rules.ts)', files.every((f) => !read(f).includes('Beta en testnet')));
  const pay = read('components/PayBox.tsx');
  const payFooter = pay.slice(pay.indexOf("if (order.status === 'creado'"), pay.indexOf('} else if (sinpe'));
  t.check('pago: <BetaNotice custody> (pie de custodia) ANTES del botón "Pagar en custodia"', payFooter.includes('<BetaNotice from="pay" custody') && payFooter.indexOf('<BetaNotice') < payFooter.indexOf('Pagar en custodia'));
  const pinSheet = pay.slice(pay.indexOf("sheet === 'paid'"), pay.indexOf("sheet === 'photo'"));
  t.check('hoja tras pagar (antes del PIN): aviso (y cierra la hoja al ir a las reglas)', /<BetaNotice from="pin"[^>]*onNavigate/.test(pinSheet));
  t.check('hoja de disputa: aviso', /<BetaNotice from="dispute" onNavigate=\{onClose\}/.test(read('components/DisputeSheet.tsx')));
  t.check('Vender: aviso', /<BetaNotice from="sell"/.test(read('app/(tabs)/vender.tsx')));
  const comp = read('components/RulesLink.tsx');
  const body = comp.slice(comp.indexOf('export function BetaNotice'));
  t.check('estilo discreto: footnote + information-circle-outline + C.textDim + "Ver cómo funciona" a las reglas',
    /T\.footnote/.test(body) && /information-circle-outline/.test(body) && /C\.textDim/.test(body) && /BETA_NOTICE_LINK/.test(body) && /open\(/.test(body));
  // --- Guardia de legibilidad (No quitar sin revisión legal (Neo, Ley 7472)) ---
  const { C, named, theme } = themes();
  t.check('guardia: el cálculo de contraste detecta un gris ilegible (sanity)', contrast('#5A4F7A', C.bg) < 4.5 && contrast('#FFFFFF', '#000000') > 20.9);
  const foot = theme.match(/footnote:\s*\{([^}]*)\}/)![1];
  const footSize = Number(foot.match(/fontSize:\s*(\d+(?:\.\d+)?)/)![1]);
  const overrides = [...body.slice(0, body.indexOf('\n}')).matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const sizes = [footSize, ...overrides];
  t.check('letra del aviso ≥ 12 px (T.footnote y cualquier fontSize propio)', sizes.every((n) => n >= 12), sizes.join(', '));
  const fnBody = body.slice(0, body.indexOf('\n}'));
  const fgTokens = [...new Set([...fnBody.matchAll(/color[=:]\s*\{?\s*C\.(\w+)/g)].map((m) => m[1]).concat(foot.match(/color:\s*C\.(\w+)/)![1]))];
  // Fondos donde se muestra: pantalla (C.bg: pago, Vender), hojas y tarjetas (C.surface: PIN, disputa) y el fondo de cada tema.
  const bgs: Record<string, string> = { 'C.bg': C.bg, 'C.surface': C.surface };
  for (const [name, th] of Object.entries(named)) if (th.background) bgs[`tema ${name}`] = th.background;
  const rows = fgTokens.flatMap((f) => Object.entries(bgs).map(([b, v]) => ({ f, b, r: contrast(C[f], v, C.bg) })));
  const worst = rows.reduce((a, x) => (x.r < a.r ? x : a));
  t.check(`contraste AA (≥4.5:1) de cada color del aviso (${fgTokens.join(', ')}) en ${Object.keys(bgs).length} fondos/temas`,
    fgTokens.length >= 2 && Object.keys(named).length >= 1 && worst.r >= 4.5, `mínimo ${worst.r.toFixed(2)} (C.${worst.f} sobre ${worst.b})`);
  const helpers = read('e2e/helpers.ts');
  t.check('e2e "sin testnet/prueba": las excepciones son SOLO BETA_NOTICE y CUSTODY_NOTICE (documentadas)', /withoutBetaNotice = \(text: string\) => text\.split\(CUSTODY_NOTICE\)\.join\(''\)\.split\(BETA_NOTICE\)\.join\(''\)/.test(helpers)
    && ['e2e/layout.spec.ts', 'e2e/buyer-fb.spec.ts', 'e2e/prod/smoke.spec.ts'].every((f) => !/expect\(text\)\.not\.toMatch\(\/[^/]*testnet/.test(read(f))));
  t.check('e2e MCK-BETA-01 (iPhone SE): aviso visible antes del botón de pagar', /MCK-BETA-01/.test(read('e2e/mock-guest.spec.ts')));
  // Animación de entrada (Neo): los avisos legales nunca arrancan en opacidad 0 ni dependen de que la animación termine.
  const rl = read('components/RulesLink.tsx'), motion = read('constants/motion.ts'), html = read('app/+html.tsx');
  t.check('avisos legales marcados data-legal (BetaNotice, RulesHint "Ver reglas", RulesLink "Cómo funciona")',
    /legalMark: object = Platform\.OS === 'web' \? \{ dataSet: \{ legal: '1' \} \}/.test(rl)
    && ['testID="beta-notice" {...legalMark}', 'testID="rules-hint" hitSlop={6} {...legalMark}', 'testID="rules-link" hitSlop={8} {...legalMark}'].every((x) => rl.includes(x)));
  const anims = motion.match(/LEGAL_ANIMS = \[([^\]]+)\]/)?.[1] ?? '';
  const fadeIns = [...motion.matchAll(/@keyframes (m-[\w-]+)\{(?:from|0%)\{opacity:0/g)].map((m) => m[1]);
  const usedBy = (kf: string) => [...motion.matchAll(new RegExp(`\\[data-anim="([\\w-]+)"\\]\\{animation:${kf} `, 'g'))].map((m) => m[1]);
  t.check('toda animación de entrada que arranca en opacidad 0 está en LEGAL_ANIMS (fuera si contiene un aviso)',
    fadeIns.length >= 3 && fadeIns.flatMap(usedBy).filter((a) => !['confetti', 'burst', 'shock', 'shock2'].includes(a)).every((a) => anims.includes(`'${a}'`)));
  t.check('LEGAL_CSS: el aviso y cualquier contenedor que lo tenga (:has) sin animación; sin :has, sin entradas con opacidad',
    /'\[data-legal\]\{animation:none!important\}'/.test(motion) && /legalSel\(':has\(\[data-legal\]\)'\)\}\{animation:none!important\}/.test(motion)
    && /appearLegal\(':has\(\[data-legal\]\)'\)\}\{animation:none!important\}/.test(motion) && /'\[data-appear\]>\*', '\[data-appear-sub\]>\*', '\[data-appear-item\]'/.test(motion)
    && /@supports not selector\(:has\(\*\)\)\{\$\{legalSel\(''\)\},\$\{appearLegal\(''\)\}\{animation:none!important\}\}/.test(motion));
  t.check('LEGAL_CSS va al final de MOTION_CSS, en el <style> del HTML estático (vale sin JS y desde el primer cuadro)',
    /`\.replace\(\/\\n\/g, ''\) \+ LEGAL_CSS;/.test(motion) && /MOTION_CSS \+/.test(html) && !/useEffect[^]*MOTION_CSS/.test(html));
  t.check('e2e con la animación ACTIVA: LEG-01/02/03 y MCK-BETA-01 miden aviso + ancestros sin animación de entrada',
    /expectLegalVisible\(page, \['beta-notice', 'rules-hint'\]\)/.test(read('e2e/mock-guest.spec.ts')) && ['LEG-01', 'LEG-02', 'LEG-03', "localStorage.setItem('meteorito:e2e-anim', '1')"].every((x) => read('e2e/legal-visible.spec.ts').includes(x))
    && /MCK-BETA-02[^]*meteorito:e2e-anim[^]*expectLegalVisible/.test(read('e2e/mock-guest.spec.ts')));
}
