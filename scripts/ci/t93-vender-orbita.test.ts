// (93) Vender rediseñado: "Generar link" es un círculo grande que se aprieta (órbitas, meteorito, halo, partículas,
//      onda expansiva). Misma funcionalidad: valida igual, carga igual, mismo texto. Animaciones livianas (solo
//      transform/opacity, CSS en web, driver nativo en el teléfono) y quietas con "Reducir movimiento".
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { burstPoints, FLOATERS, LAUNCH_MAX, LAUNCH_MIN, LAUNCH_STAGE_MIN, launchPad, launchSize, launchState, orbitHalfHeight } from '../../lib/launchCore';
import { isListingValid } from '../../lib/listing';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

export async function run(t: T) {
  // Estados
  t.check('estado: falta algo -> idle (apagado, pero se puede tocar para ver qué falta)', launchState(false, false) === 'idle');
  t.check('estado: listo -> ready', launchState(true, false) === 'ready');
  t.check('estado: generando -> busy (gana sobre listo/no listo)', launchState(true, true) === 'busy' && launchState(false, true) === 'busy');
  t.check('listo = mismas reglas que validateListing', isListingValid({ title: 'Bici de montaña', price: 150000, photos: 1, photosBusy: false })
    && !isListingValid({ title: 'Bici', price: 500, photos: 1, photosBusy: false }) && !isListingValid({ title: 'Bici de montaña', price: 150000, photos: 0, photosBusy: false })
    && !isListingValid({ title: 'Bici de montaña', price: 150000, photos: 1, photosBusy: true }));
  // Tamaños: el círculo vive en su propio escenario (entre "Entrega y plazo" y los avisos) y se ajusta a su alto libre
  const se = launchSize(132), big = launchSize(240, 358), min = launchSize(0);
  t.check('círculo: entre 96 y 150 px; ~120 px en iPhone SE, 150 px en pantallas altas', LAUNCH_MIN === 96 && LAUNCH_MAX === 150
    && se.core >= 118 && big.core === 150 && [se, big, min].every((z) => z.core % 2 === 0) && min.core === 96, `${se.core}/${big.core}/${min.core}`);
  t.check('círculo + aire caben en el escenario (nunca se sale hacia los avisos)', [110, 132, 150, 170, 240].every((h) => h < LAUNCH_STAGE_MIN || launchSize(h).core + 2 * launchPad(h) <= h)
    && LAUNCH_STAGE_MIN === LAUNCH_MIN + 2 * launchPad(0));
  t.check('órbitas elípticas: más anchas que el círculo, pero su alto no pasa del círculo (no tapan nada arriba ni abajo)',
    [se, big].every((z) => [z.inner, z.outer].every((o) => o.a > z.core / 2 && orbitHalfHeight(o) + 9 <= z.core / 2 + launchPad(0)) && z.outer.a > z.inner.a));
  t.check('órbitas: caben a lo ancho en 343 px (iPhone SE)', (launchSize(200, 343).outer.a + 12) * 2 <= 343);
  t.check('órbitas: giran despacio (>= 8 s por vuelta)', se.inner.period >= 8 && se.outer.period >= 8);
  const b = burstPoints(10, 92);
  t.check('chispas: 10 puntos alrededor, a <= 92 px (salen del círculo)', b.length === 10 && b.every((p) => Math.hypot(p.x, p.y) <= 93) && /burstPoints\(10, 92\)/.test(src('constants/motion.ts')));
  t.check('partículas flotantes: pocas (<= 8)', FLOATERS.length >= 3 && FLOATERS.length <= 8);

  // Animaciones: CSS solo transform/opacity; quietas con reducir movimiento
  const motion = src('constants/motion.ts');
  for (const k of ['m-orbit', 'm-halo', 'm-halo-calm', 'm-glow', 'm-glow-calm', 'm-sonar', 'm-ox', 'm-oy', 'm-front', 'm-shock', 'm-burst', 'm-rise', 'm-shake', 'm-ignite']) {
    const body = motion.match(new RegExp(`@keyframes ${k}\\{(.*?\\}\\})`))?.[1] ?? '';
    const props = [...body.replace(/--[a-z]+:[^;}]+/g, '').matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    t.check(`${k}: existe y solo anima transform/opacity`, props.length > 0 && props.every((p) => p === 'transform' || p === 'opacity'), props.join(','));
  }
  t.check('reducir movimiento: sin onda, chispas ni partículas', /prefers-reduced-motion[^]*\[data-anim="shock"\],\[data-anim="shock2"\],\[data-anim="burst"\],\[data-anim="floaters"\]\{display:none!important\}/.test(motion));

  const btn = src('components/LaunchButton.tsx');
  t.check('botón: rol y nombre accesibles, estado busy', /accessibilityRole="button"/.test(btn) && /accessibilityLabel=\{label\}/.test(btn) && /accessibilityState=\{\{ busy \}\}/.test(btn));
  t.check('botón: nunca aria-disabled (se puede tocar para ver qué falta)', !/disabled=/.test(btn));
  t.check('botón: cargando muestra indicador y no relanza', /busy \? <ActivityIndicator/.test(btn) && /if \(busy\) return;/.test(btn));
  t.check('botón: nativo con useNativeDriver, web en CSS; respeta reducir movimiento', /useNativeDriver: true/.test(btn) && !/useNativeDriver: false/.test(btn) && /useReducedMotion\(\)/.test(btn) && /anim\('orbit'\)/.test(btn));
  t.check('botón: decoración sin toques (pointerEvents none)', /pointerEvents="none" style=\{\[s\.decor/.test(btn));
  t.check('botón: sin librerías pesadas de animación', ![...btn.matchAll(/from '([^']+)'/g)].some((m) => /lottie|^moti$|framer|three|skia/i.test(m[1])));
  t.check('botón: sin emojis', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(btn));

  const ven = src('app/(tabs)/vender.tsx');
  t.check('Vender: usa el círculo con el mismo texto "Generar link", submit, busy y listo', /<LaunchButton label="Generar link" ready=\{ready\} busy=\{busy\} size=\{launch\.core\} inner=\{launch\.inner\} outer=\{launch\.outer\} onPress=\{\(\) => submit\(\)\} \/>/.test(ven));
  t.check('botón: sólido (gradiente violeta opaco, sin stopOpacity en el relleno) también apagado', /id="lg-on"/.test(btn) && /id="lg-off"/.test(btn)
    && !/<RadialGradient id="lg-(on|off)"[^]*?<\/RadialGradient>/.exec(btn)![0].includes('stopOpacity') && !/<RadialGradient id="lg-off"[^]*?<\/RadialGradient>/.exec(btn)![0].includes('stopOpacity'));
  t.check('botón: el círculo no se anima solo (se toca estable); el pulso en reposo es brillo (opacidad) y halo', !/anim\('breathe/.test(btn) && /anim\(lit \? 'glow' : 'glow-calm'\)/.test(btn) && /anim\(lit \? 'halo' : 'halo-calm'\)/.test(btn));
  const space = ven.slice(ven.indexOf('testID="launch-space"'));
  t.check('Vender: el círculo va en su propio espacio (flujo), después de "Entrega y plazo" y antes de los avisos, sin footer flotante',
    ven.indexOf('accessibilityLabel="Entrega y plazo"') < ven.indexOf('testID="launch-space"') && space.indexOf('<LaunchButton') < space.indexOf('testID="sell-photo-help"')
    && /testID="sell-photo-help"[^]*De 1 a 4 fotos[^]*<RulesHint text=\{SELL_SUMMARY\} from="sell" \/>[^]*<BetaNotice from="sell" \/>/.test(space)
    && !/<Screen footerBare title="Vender" subtitle/.test(ven));
  t.check('Vender: los avisos nunca se esconden (sin condición de pantalla chica)', !/\? null : <Text style=\{T\.footnote\}>De 1 a 4/.test(ven) && !/compact \/>/.test(ven));
  t.check('Vender: listo = isListingValid con fotos cargando', /const ready = isListingValid\(\{ title, price: priceNum, photos: photos\.length, photosBusy \}\)/.test(ven));
  t.check('Vender: sigue validando al tocar (validateListing en submit)', /const errs = validateListing\(\{ title, price: priceNum, photos: photos\.length, photosBusy \}\)/.test(ven));
  t.check('Vender: aviso de beta, importar, borrador y re-login intactos', /<BetaNotice from="sell"/.test(ven) && /COPY\.importLink\.title/.test(ven) && /saveSellDraft\(/.test(ven) && /loadSellDraft\(address\)/.test(ven) && /<OrphanWalletCard/.test(ven));
  t.check('Vender: inputs >= 16 px', [...ven.matchAll(/(fieldInput|priceInput): \{[^}]*fontSize: (\d+)/g)].every((m) => Number(m[2]) >= 16) && /fieldInput: \{[^}]*fontSize/.test(ven));
}
