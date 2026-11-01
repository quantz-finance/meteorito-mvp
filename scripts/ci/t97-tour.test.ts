// (97) Tour guiado (estilo Joyride, overlay propio en components/Tour.tsx; pasos y estado en lib/tour.ts):
//      arranca solo UNA vez (visto en localStorage; sin storage, en memoria y sin romper nativo), solo en las pestañas
//      (nunca en un link de pago/tienda), no en navegadores automatizados salvo el flag de e2e; "Ver recorrido" en
//      Mi cuenta y en Cómo funciona; pasos sin destino en pantalla se muestran centrados; copy corto, tuteo, sin
//      palabras prohibidas; sin dependencias nuevas. El e2e MCK-TOUR-01/02 (e2e/mock-tour.spec.ts) lo prueba en el build real.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import {
  TOUR_COPY, TOUR_E2E_KEY, TOUR_SEEN_KEY, TOUR_STEPS, closeTour, getTourState, isTourAutoRoute, markTourSeen, nextTourStep,
  prevTourStep, resetTourSeen, startTour, tourAutoAllowed, tourSeen,
} from '../../lib/tour';
import { TOUR } from '../../lib/rules';

const read = (f: string) => readFileSync(f, 'utf8');
// Regla legal + marca: ni seguro/garantía/verificado/protegido ni empresa/fintech/banco/billetera (con derivados).
const BANNED = /(?<!\p{L})(segur\p{L}*|garant\p{L}*|verific\p{L}*|proteg\p{L}*|empresa\p{L}*|fintech\p{L}*|banc[oa]s?|bancari\p{L}*|billetera\p{L}*)(?!\p{L})/iu;
const VOSEO = /(?<!\p{L})(?:(pod|ten|quer|sab|vend|compr|pag|necesit|recib|eleg|dec|escrib|pon|pued)(és|ás|ís)|(mir|toc|revis|confirm|pag|guard|esper|cancel|report|cre)á|vos)(?!\p{L})/iu;

function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, m };
}

export async function run(t: T) {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    // --- Pasos y copy ---
    t.check('5 pasos en orden: bienvenida, link de pago, custodia, envío/entrega, reglas', TOUR_STEPS.map((s) => s.id).join() === 'hola,link,custodia,entrega,reglas');
    const all = [...TOUR_STEPS.flatMap((s) => [s.title, s.text]), ...Object.values(TOUR_COPY).filter((v) => typeof v === 'string'), TOUR_COPY.count(1, 5)].join(' | ');
    t.check('sin palabras prohibidas (seguro, garantía, verificado, proteg*, empresa, fintech, banco, billetera)', !BANNED.test(all), all.match(BANNED)?.[0]);
    t.check('copy en tuteo, sin voseo', !VOSEO.test(all), all.match(VOSEO)?.[0]);
    t.check('copy corto: título ≤ 32 y texto ≤ 150 caracteres', TOUR_STEPS.every((s) => s.title.length <= 32 && s.text.length <= 150),
      TOUR_STEPS.map((s) => `${s.id}:${s.title.length}/${s.text.length}`).join(' '));
    const by = Object.fromEntries(TOUR_STEPS.map((s) => [s.id, s.text]));
    t.check('explica: crear link de pago, custodia, envío/entrega con código, reglas; beta en testnet sin dinero real',
      /link/.test(by.link) && /custodia/.test(by.custodia) && /envío/i.test(by.entrega) && /código de entrega/.test(by.entrega) && /reglas/.test(by.reglas)
      && /testnet, sin dinero real/.test(by.hola));
    t.check('botón "Ver recorrido" y controles Siguiente/Atrás/Saltar/Listo', TOUR_COPY.button === 'Ver recorrido' && TOUR_COPY.next === 'Siguiente' && TOUR_COPY.back === 'Atrás' && TOUR_COPY.skip === 'Saltar' && TOUR_COPY.done === 'Listo');
    t.check('destinos: link -> Vender (launch-space/pestaña) o Pagar con link; entrega -> Home o Mis compras; reglas -> Ver reglas/Cómo funciona/botón',
      TOUR_STEPS[1].targets.includes('launch-space') && TOUR_STEPS[1].targets.includes('tab-vender') && TOUR_STEPS[3].targets.includes('tab-pedidos')
      && TOUR_STEPS[3].targets.includes('comprar-compras') && TOUR_STEPS[4].targets.join() === 'rules-hint,rules-link,tour-button' && TOUR_STEPS[0].targets.length === 0);

    // --- Rutas donde arranca solo ---
    t.check('arranca solo en las pestañas (Vender, Home, Comprar)', [['(tabs)', 'vender'], ['(tabs)', 'pedidos'], ['(tabs)', 'comprar'], ['(tabs)', 'comprar', 'compras']].every((s) => isTourAutoRoute(s)));
    t.check('nunca solo en links de pago, tienda, invitación, legales, reglas, Mis compras ni chat', [['p', '[slug]'], ['t', '[store]'], ['i', '[code]'], ['legal', '[doc]'], ['como-funciona'], ['mis-compras'], ['chat'], ['compartir', '[slug]'], []].every((s) => !isTourAutoRoute(s)));

    // --- "Visto": web (localStorage) ---
    setGlobal('navigator', { webdriver: false });
    const ls = memStorage(); setGlobal('localStorage', ls); resetTourSeen();
    t.check('primera vez: se puede abrir solo', !tourSeen() && tourAutoAllowed());
    startTour('auto');
    t.check('al abrirse queda visto en localStorage (recargar no lo repite)', ls.m.get(TOUR_SEEN_KEY) === '1' && tourSeen() && !tourAutoAllowed() && getTourState().open && getTourState().index === 0);
    // estado: siguiente / atrás / cerrar
    nextTourStep(); nextTourStep(); prevTourStep();
    t.check('Siguiente / Atrás', getTourState().index === 1);
    closeTour();
    t.check('Saltar/cerrar lo cierra', !getTourState().open);
    startTour('button');
    t.check('"Ver recorrido" lo vuelve a abrir desde el paso 1 aunque ya esté visto', getTourState().open && getTourState().index === 0 && getTourState().source === 'button');
    for (let i = 0; i < TOUR_STEPS.length; i++) nextTourStep();
    t.check('Siguiente en el último paso (Listo) lo cierra', !getTourState().open);
    t.check('TOUR (lib/rules.ts) activo y abre el tour', TOUR.enabled === true && typeof TOUR.start === 'function' && (TOUR.start!(), getTourState().open));
    closeTour();

    // --- Navegador automatizado: no tapa los demás e2e salvo el flag ---
    resetTourSeen(); setGlobal('navigator', { webdriver: true });
    t.check('navegador automatizado: no arranca solo', !tourAutoAllowed());
    ls.setItem(TOUR_E2E_KEY, '1');
    t.check(`...salvo localStorage ${TOUR_E2E_KEY}=1 (el e2e del tour)`, tourAutoAllowed());
    setGlobal('navigator', { webdriver: false });

    // --- Nativo / sin storage: nunca lanza, visto en memoria ---
    setGlobal('localStorage', undefined); resetTourSeen();
    let ok = true;
    try { ok = tourAutoAllowed(); markTourSeen(); ok = ok && tourSeen() && !tourAutoAllowed(); } catch { ok = false; }
    t.check('sin localStorage (nativo): no lanza y el visto queda en memoria', ok);
    const boom = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
    setGlobal('localStorage', boom);
    ok = true;
    try { resetTourSeen(); ok = tourAutoAllowed(); startTour('auto'); ok = ok && getTourState().open && tourSeen(); closeTour(); } catch { ok = false; }
    t.check('localStorage que lanza (Safari privado): no rompe, visto en memoria', ok);
  } finally {
    if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete (globalThis as any).navigator;
    if (lsDesc) Object.defineProperty(globalThis, 'localStorage', lsDesc); else delete (globalThis as any).localStorage;
  }

  // --- Cableado ---
  const tour = read('components/Tour.tsx'), layout = read('app/_layout.tsx'), acct = read('components/AccountSheet.tsx'), rules = read('app/como-funciona.tsx');
  const gate = layout.slice(layout.indexOf('function Gate'));
  t.check('layout: <TourHost /> una vez en la raíz y <TourAuto /> dentro de la app (después de la bienvenida/login)',
    (layout.match(/<TourHost \/>/g) ?? []).length === 1 && /<TourAuto \/>/.test(gate) && gate.indexOf('<TourAuto />') > gate.indexOf('return <Welcome />'));
  t.check('Mi cuenta: "Ver recorrido" (cierra la hoja antes de abrir)', /<TourButton from="account" before=\{onClose\} \/>/.test(acct));
  t.check('Cómo funciona: "Ver recorrido" arriba, antes de las reglas', /<TourButton from="rules" \/>/.test(rules) && rules.indexOf('<TourButton') < rules.indexOf('RULES.map'));
  t.check('overlay propio: Modal + react-native (sin dependencias de tour)', /from 'react-native'/.test(tour) && /<Modal/.test(tour)
    && !/joyride|react-native-copilot|spotlight-tour|intro\.js|shepherd/i.test(read('package.json')));
  t.check('nativo: DOM solo detrás de WEB y typeof document; paso sin destino = centrado (data-tour-target="none")',
    /if \(!WEB \|\| typeof document === 'undefined'\) return null;/.test(tour) && /tourTarget: spot\?\.id \?\? 'none'/.test(tour) && /!r && s\.center/.test(tour));
  t.check('destinos marcados: pestañas (tab-*) e iconos de Comprar (comprar-*)', /tourMark\(`tab-\$\{route\.name\}`\)/.test(read('components/TabBar.tsx')) && /tourMark\(`comprar-\$\{v\.key\}`\)/.test(read('components/ComprarNav.tsx')));
  const src = tour.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const strings = [...(src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? []), ...(src.match(/>[^<>{}\n]+</g) ?? [])];
  t.check('components/Tour.tsx: textos sin palabras prohibidas', !strings.some((s) => BANNED.test(s)), strings.find((s) => BANNED.test(s)));
  const e2e = read('e2e/mock-tour.spec.ts');
  t.check('e2e MCK-TOUR-01 (arranca una vez, Saltar, no vuelve, "Ver recorrido") y MCK-TOUR-02 (sin destinos: centrado)',
    /MCK-TOUR-01/.test(e2e) && /MCK-TOUR-02/.test(e2e) && /tour-skip/.test(e2e) && /tour-button/.test(e2e) && /addInitScript\(\(k\) => localStorage\.setItem\(k, .1.\), TOUR_E2E_KEY\)/.test(e2e));
}
