// (56) Aviso de beta "línea discreta donde importa": texto EXACTO en una sola constante, presente en el pago (antes del
//      botón de pagar), Vender, la hoja del PIN y la de disputa; footnote + icono de información, contraste AA; y la regla
//      "sin etiquetas de prueba" de los e2e solo exceptúa esta constante. El e2e MCK-BETA-01 (iPhone SE) mide el viewport.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { BETA_NOTICE, BETA_NOTICE_LINK } from '../../lib/rules';
import { Brand } from '../../constants/Colors';

const read = (f: string) => readFileSync(f, 'utf8');
/** Contraste WCAG entre dos colores #RRGGBB. */
function contrast(a: string, b: string) {
  const L = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05);
}

export async function run(t: T) {
  t.check('texto exacto en una sola constante', BETA_NOTICE === 'Beta en testnet, sin dinero real. Meteorito no verifica el producto.' && BETA_NOTICE_LINK === 'Ver cómo funciona');
  const files = ['components/PayBox.tsx', 'components/DisputeSheet.tsx', 'app/(tabs)/vender.tsx', 'components/RulesLink.tsx', 'app/p/[slug].tsx'];
  t.check('nadie copia el texto a mano (solo lib/rules.ts)', files.every((f) => !read(f).includes('Beta en testnet')));
  const pay = read('components/PayBox.tsx');
  const payFooter = pay.slice(pay.indexOf("if (order.status === 'creado'"), pay.indexOf('} else if (sinpe'));
  t.check('pago: <BetaNotice> ANTES del botón "Pagar en custodia"', payFooter.includes('<BetaNotice from="pay"') && payFooter.indexOf('<BetaNotice') < payFooter.indexOf('Pagar en custodia'));
  const pinSheet = pay.slice(pay.indexOf("sheet === 'paid'"), pay.indexOf("sheet === 'photo'"));
  t.check('hoja tras pagar (antes del PIN): aviso (y cierra la hoja al ir a las reglas)', /<BetaNotice from="pin"[^>]*onNavigate/.test(pinSheet));
  t.check('hoja de disputa: aviso', /<BetaNotice from="dispute" onNavigate=\{onClose\}/.test(read('components/DisputeSheet.tsx')));
  t.check('Vender: aviso', /<BetaNotice from="sell"/.test(read('app/(tabs)/vender.tsx')));
  const comp = read('components/RulesLink.tsx');
  const body = comp.slice(comp.indexOf('export function BetaNotice'));
  t.check('estilo discreto: footnote + information-circle-outline + C.textDim + "Ver cómo funciona" a las reglas',
    /T\.footnote/.test(body) && /information-circle-outline/.test(body) && /C\.textDim/.test(body) && /BETA_NOTICE_LINK/.test(body) && /open\(/.test(body));
  const c1 = contrast(Brand.muted, Brand.purpleDark), c2 = contrast(Brand.muted, Brand.purpleMid);
  t.check('contraste AA (≥4.5) sobre el fondo y sobre las hojas', c1 >= 4.5 && c2 >= 4.5, `${c1.toFixed(2)} / ${c2.toFixed(2)}`);
  const helpers = read('e2e/helpers.ts');
  t.check('e2e "sin testnet/prueba": la excepción es SOLO BETA_NOTICE (documentada)', /withoutBetaNotice = \(text: string\) => text\.split\(BETA_NOTICE\)\.join\(''\)/.test(helpers)
    && ['e2e/layout.spec.ts', 'e2e/buyer-fb.spec.ts', 'e2e/prod/smoke.spec.ts'].every((f) => !/expect\(text\)\.not\.toMatch\(\/[^/]*testnet/.test(read(f))));
  t.check('e2e MCK-BETA-01 (iPhone SE): aviso visible antes del botón de pagar', /MCK-BETA-01/.test(read('e2e/mock-guest.spec.ts')));
}
