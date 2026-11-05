// Tour guiado (estilo Joyride) con overlay propio: sin dependencias nuevas, react-native-web y nativo.
// Pasos, copy, "visto" y estado en lib/tour.ts. <TourHost /> va una vez en el layout raíz; <TourAuto /> lo abre solo la
// primera vez en una pestaña; <TourButton /> ("Ver recorrido") lo vuelve a abrir (Mi cuenta y Cómo funciona).
// Resaltado (solo web): busca el primer elemento visible del paso (data-tour="…" o data-testid="…") y oscurece el resto.
// Si no hay ninguno (sin pedidos/productos, invitado, nativo), el paso se muestra centrado: nunca se traba ni falla.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSegments } from 'expo-router';
import { PrimaryButton } from '@/components/ds';
import { C, R, S, T, TOUCH, shadow } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { track } from '@/lib/analytics';
import {
  TOUR_AUTO_DELAY_MS, TOUR_COPY, TOUR_STEPS, authSettled, cavosModalInDom, closeTour, getTourState, isTourAutoRoute, nextTourStep, prevTourStep,
  startTour, subscribeTour, tourAutoAllowed, tourMayStart, type TourSource,
} from '@/lib/tour';
import { useAuthFlag } from '@/lib/authStore';
import { useAuth } from '@/lib/cavos';

const WEB = Platform.OS === 'web';
type Rect = { x: number; y: number; w: number; h: number };
const PAD = 6; // aire alrededor del elemento resaltado

/** Marca un elemento como destino del tour (web: data-tour="id"). En nativo no hace nada. */
export const tourMark = (id: string): object => (WEB ? { dataSet: { tour: id } } : {});

const useTour = () => useSyncExternalStore(subscribeTour, getTourState, getTourState);

function isShown(el: Element): boolean {
  if (el.closest('[data-tour-root]')) return false;
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
/** Primer destino visible del paso (web). null = paso centrado. */
function findTarget(ids: string[]): { id: string; el: Element } | null {
  if (!WEB || typeof document === 'undefined') return null;
  try {
    for (const id of ids) {
      const sel = `[data-tour="${id}"],[data-testid="${id}"]`;
      for (const el of Array.from(document.querySelectorAll(sel))) if (isShown(el)) return { id, el };
    }
  } catch { /* nunca rompe el tour */ }
  return null;
}
function measure(el: Element, vh: number): Rect | null {
  let r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > vh) { try { el.scrollIntoView({ block: 'center' }); } catch { /* */ } r = el.getBoundingClientRect(); }
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}
const same = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1);

/** Overlay del tour. Montar una sola vez (app/_layout.tsx). */
export function TourHost() {
  const tour = useTour();
  const cavosModal = useAuthFlag('cavosModal'); // modal de Cavos encima (p. ej. re-login): el tour se oculta, no se pierde
  const { width: vw, height: vh } = useWindowDimensions();
  const step = TOUR_STEPS[Math.min(tour.index, TOUR_STEPS.length - 1)];
  const [spot, setSpot] = useState<{ id: string; rect: Rect } | null>(null);

  // Busca (y sigue) el destino del paso: la pantalla puede moverse, cargar o hacer scroll mientras el tour está abierto.
  useEffect(() => {
    if (!tour.open) { setSpot(null); return; }
    const find = () => {
      const t = findTarget(step.targets);
      const rect = t ? measure(t.el, vh) : null;
      setSpot((prev) => (t && rect ? (prev && prev.id === t.id && same(prev.rect, rect) ? prev : { id: t.id, rect }) : null));
    };
    find();
    if (!WEB) return;
    const id = setInterval(find, 300);
    return () => clearInterval(id);
  }, [tour.open, tour.index, vh]);

  if (!tour.open || cavosModal) return null;
  const last = tour.index === TOUR_STEPS.length - 1;
  const finish = (completed: boolean) => { track('tour_closed', { step: step.id, completed, source: tour.source }); closeTour(); };
  const r = spot?.rect ? { x: spot.rect.x - PAD, y: spot.rect.y - PAD, w: spot.rect.w + PAD * 2, h: spot.rect.h + PAD * 2 } : null;
  const cardW = Math.min(360, vw - S.md * 2);
  // Tarjeta: debajo del destino si cabe, si no arriba; centrada si no hay destino.
  // Nunca más alta que el espacio disponible: el texto hace scroll dentro de la tarjeta y los botones siempre se ven (iPhone SE).
  let pos: object = { alignSelf: 'center' };
  let maxH = vh - S.md * 2;
  if (r) {
    const left = Math.max(S.md, Math.min(r.x + r.w / 2 - cardW / 2, vw - cardW - S.md));
    const below = vh - (r.y + r.h), above = r.y;
    if (below >= above) { const top = Math.min(r.y + r.h + S.sm, vh - 200); pos = { position: 'absolute', left, top }; maxH = vh - top - S.md; }
    else { const bottom = Math.min(vh - r.y + S.sm, vh - 200); pos = { position: 'absolute', left, bottom }; maxH = vh - bottom - S.md; }
  }
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => finish(false)} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, !r && s.center]} {...(WEB ? { dataSet: { tourRoot: '1' } } : {})} testID="tour-overlay">
        {r ? <>
          <View style={[s.dim, { left: 0, top: 0, right: 0, height: Math.max(0, r.y) }]} />
          <View style={[s.dim, { left: 0, top: r.y + r.h, right: 0, bottom: 0 }]} />
          <View style={[s.dim, { left: 0, top: r.y, width: Math.max(0, r.x), height: r.h }]} />
          <View style={[s.dim, { left: r.x + r.w, top: r.y, right: 0, height: r.h }]} />
          <View pointerEvents="none" testID="tour-spot" style={[s.ring, { left: r.x, top: r.y, width: r.w, height: r.h }]} />
        </> : <View style={[StyleSheet.absoluteFill, s.dim]} />}
        <View testID="tour" accessibilityViewIsModal accessibilityLabel={TOUR_COPY.label} aria-modal
          {...(WEB ? { dataSet: { tourStep: step.id, tourTarget: spot?.id ?? 'none' } } : {})}
          style={[s.card, { width: cardW, maxHeight: Math.max(200, maxH) }, pos]}>
          <ScrollView testID="tour-scroll" style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: S.sm }} showsVerticalScrollIndicator={false}>
            <Text style={T.caption} testID="tour-count">{TOUR_COPY.count(tour.index + 1, TOUR_STEPS.length)}</Text>
            <Text style={T.title} accessibilityRole="header" testID="tour-title">{step.title}</Text>
            <Text style={[T.body, { color: '#DCD2F5' }]} testID="tour-text">{step.text}</Text>
          </ScrollView>
          <View style={s.dots}>
            {TOUR_STEPS.map((x, i) => <View key={x.id} style={[s.dot, i === tour.index && s.dotOn]} />)}
          </View>
          <View style={s.row}>
            {!last ? <Btn title={TOUR_COPY.skip} kind="ghost" testID="tour-skip" onPress={() => finish(false)} /> : <View />}
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              {tour.index > 0 ? <Btn title={TOUR_COPY.back} kind="secondary" testID="tour-back" onPress={prevTourStep} /> : null}
              <Btn title={last ? TOUR_COPY.done : TOUR_COPY.next} kind="primary" testID="tour-next"
                onPress={() => (last ? finish(true) : nextTourStep())} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Btn({ title, kind, onPress, testID }: { title: string; kind: 'primary' | 'secondary' | 'ghost'; onPress: () => void; testID: string }) {
  return (
    <Pressable accessibilityRole="button" testID={testID} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [s.btn, kind === 'primary' && s.btnPrimary, kind === 'secondary' && s.btnSecondary, pressed && { opacity: 0.75 }]}>
      <Text style={[s.btnText, { color: kind === 'primary' ? C.purple : C.lilac }]}>{title}</Text>
    </Pressable>
  );
}

/** Abre el tour solo la primera vez que se abre la app en una pestaña (Vender, Home, Comprar). Montar dentro de la app
 *  (no en la bienvenida/login). */
export function TourAuto() {
  const segments = useSegments();
  const auto = isTourAutoRoute(segments as string[]);
  // Cuenta nueva: Cavos abre "Set up a passkey / Save a recovery phrase" con la sesión ya activa. El tour espera a que
  // ese paso termine (o se cierre) y el login esté resuelto: nunca se dibuja encima de un modal de Cavos.
  const auth = useAuth();
  const settled = authSettled(auth);
  const cavosModal = useAuthFlag('cavosModal');
  useEffect(() => {
    const may = () => tourMayStart({ route: auto, allowed: tourAutoAllowed(), open: getTourState().open, settled, cavosModal });
    if (!may()) return;
    let id: any;
    const attempt = () => { id = setTimeout(() => {
      if (!may()) return;
      if (cavosModalInDom()) { attempt(); return; } // el modal aún se está cerrando: esperar, no tapar
      startTour('auto'); track('tour_started', { source: 'auto' });
    }, TOUR_AUTO_DELAY_MS); };
    attempt();
    return () => clearTimeout(id);
  }, [auto, settled, cavosModal]);
  return null;
}

/** Botón "Ver recorrido". before: p. ej. cerrar la hoja de Mi cuenta antes de abrir el tour. */
export function TourButton({ from, before }: { from: string; before?: () => void }) {
  const open = (source: TourSource) => { startTour(source); track('tour_started', { source, from }); };
  return (
    <PrimaryButton title={TOUR_COPY.button} icon="compass-outline" variant="secondary" testID="tour-button"
      onPress={() => {
        if (!before) { open('button'); return; }
        before();
        // iOS no presenta un Modal mientras otro se cierra: espera la animación de la hoja. En web se cierra al instante.
        setTimeout(() => open('button'), WEB ? 0 : 400);
      }} />
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: S.md },
  dim: { position: 'absolute', backgroundColor: 'rgba(8,3,24,0.74)' },
  ring: { position: 'absolute', borderRadius: R.md, borderWidth: 2, borderColor: C.lilac },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.md + 4, gap: S.sm, borderWidth: 1, borderColor: 'rgba(201,182,255,0.35)', ...shadow },
  dots: { flexDirection: 'row', gap: 6, marginTop: S.xs },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(201,182,255,0.3)' },
  dotOn: { backgroundColor: C.lilac, width: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S.sm },
  btn: { minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: S.md, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: C.white },
  btnSecondary: { backgroundColor: C.lilacBg },
  btnText: { fontFamily: Fonts.bold, fontSize: 15 },
});
