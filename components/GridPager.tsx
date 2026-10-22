// Cuadrícula paginada sin scroll: mide el espacio real disponible y decide cuántas columnas y filas caben.
// Si no caben todos, pagina con flechas y puntos (sin scroll vertical). Cambio de página con un fundido suave.
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { anim, pressTransition } from '@/constants/motion';
import { C, S, T, TOUCH } from '@/constants/theme';

const CONTROLS_H = TOUCH;

/** Pura (testeable): columnas, filas y tamaño de celda para un área dada. */
export function gridLayout(o: { w: number; h: number; n: number; minCellW: number; minCellH: number; gap: number; maxCols?: number; maxRows?: number }) {
  const cols = Math.max(1, Math.min(o.maxCols ?? 4, Math.floor((o.w + o.gap) / (o.minCellW + o.gap))));
  const fit = (h: number) => Math.max(1, Math.min(o.maxRows ?? 8, Math.floor((h + o.gap) / (o.minCellH + o.gap))));
  let rows = fit(o.h);
  const paged = o.n > cols * rows;
  if (paged) rows = fit(o.h - CONTROLS_H - o.gap);
  const per = cols * rows;
  const pages = Math.max(1, Math.ceil(o.n / per));
  const gridH = o.h - (pages > 1 ? CONTROLS_H + o.gap : 0);
  return { cols, rows, per, pages, cellW: (o.w - o.gap * (cols - 1)) / cols, cellH: Math.min((gridH - o.gap * (rows - 1)) / rows, o.minCellH * 1.6) };
}

export function GridPager<T>({ items, keyOf, renderItem, minCellW, minCellH, gap = S.sm, maxCols, maxRows, label = 'Página' }: {
  items: T[]; keyOf: (t: T) => string; renderItem: (t: T, size: { width: number; height: number }) => ReactNode;
  minCellW: number; minCellH: number; gap?: number; maxCols?: number; maxRows?: number; label?: string;
}) {
  const win = useWindowDimensions();
  const [box, setBox] = useState({ w: Math.min(win.width, 560) - S.md * 2, h: Math.max(minCellH, win.height * 0.35) });
  const [page, setPage] = useState(0);
  const L = gridLayout({ w: box.w, h: box.h, n: items.length, minCellW, minCellH, gap, maxCols, maxRows });
  useEffect(() => { if (page > L.pages - 1) setPage(L.pages - 1); }, [L.pages, page]);
  const p = Math.min(page, L.pages - 1);
  const slice = items.slice(p * L.per, p * L.per + L.per);
  const go = (d: number) => { const n = Math.max(0, Math.min(L.pages - 1, p + d)); if (n !== p) { haptic.tap(); setPage(n); } };

  const rows: T[][] = [];
  for (let i = 0; i < slice.length; i += L.cols) rows.push(slice.slice(i, i + L.cols));
  return (
    <View style={{ flex: 1, minHeight: minCellH }} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; if (Math.abs(width - box.w) > 1 || Math.abs(height - box.h) > 1) setBox({ w: width, h: height }); }}>
      <View key={`${p}-${L.per}`} {...anim('fade')} style={{ gap }}>
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap }}>
            {r.map((t) => <View key={keyOf(t)} style={{ width: L.cellW, height: L.cellH }}>{renderItem(t, { width: L.cellW, height: L.cellH })}</View>)}
          </View>
        ))}
      </View>
      {L.pages > 1 ? (
        <View style={s.controls} accessibilityLabel={`${label} ${p + 1} de ${L.pages}`}>
          <Arrow icon="chevron-back" label="Anterior" disabled={p === 0} onPress={() => go(-1)} />
          <View style={s.dots}>
            {L.pages <= 7 ? Array.from({ length: L.pages }, (_, i) => (
              <Pressable key={i} onPress={() => { haptic.tap(); setPage(i); }} hitSlop={8} accessibilityLabel={`${label} ${i + 1}`}>
                <View style={[s.dot, i === p && s.dotOn, pressTransition]} />
              </Pressable>
            )) : <Text style={T.footnote}>{p + 1} / {L.pages}</Text>}
          </View>
          <Arrow icon="chevron-forward" label="Siguiente" disabled={p === L.pages - 1} onPress={() => go(1)} />
        </View>
      ) : null}
    </View>
  );
}

function Arrow({ icon, label, disabled, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.arrow, disabled && { opacity: 0.3 }, pressTransition, pressed && { transform: [{ scale: 0.92 }] }]}>
      <Icon name={icon} size={20} color={C.lilac} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, height: CONTROLS_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.surface2 },
  dotOn: { width: 22, backgroundColor: C.lilac },
});
