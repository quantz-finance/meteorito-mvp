// QR del pago con cripto (SEP-7). Se dibuja con react-native-svg (un solo Path), sin imágenes ni red.
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { qrMatrix, qrPath } from '@/lib/cryptoPay';

export function Qr({ value, size = 132, label }: { value: string; size?: number; label: string }) {
  const m = useMemo(() => qrMatrix(value), [value]);
  const d = useMemo(() => qrPath(m), [m]);
  const pad = 2; const vb = m.size + pad * 2;
  return (
    <View accessibilityRole="image" accessibilityLabel={label} testID="crypto-qr" style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' }}>
      <Svg width={size} height={size} viewBox={`${-pad} ${-pad} ${vb} ${vb}`} {...({ shapeRendering: "crispEdges" } as object)}>
        <Rect x={-pad} y={-pad} width={vb} height={vb} fill="#fff" />
        <Path d={d} fill="#1A0B3D" />
      </Svg>
    </View>
  );
}
