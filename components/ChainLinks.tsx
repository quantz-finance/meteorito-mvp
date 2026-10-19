// Evidencia on-chain: links a Stellar Expert (contrato de escrow y, si existen, hashes de fondeo/liberación).
// No se muestra en modo demo (los datos son ficticios) ni sin contractId.
import { Linking, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { chainLinks, type ChainInfo } from '@/lib/chain';

export { chainLinks };

export function ChainLinks({ order, align = 'flex-start' }: { order: ChainInfo | null | undefined; align?: 'flex-start' | 'center' }) {
  const links = chainLinks(order);
  if (!links.length) return null;
  return (
    <View style={{ gap: S.xs, alignItems: align }}>
      {links.map((l) => (
        <Pressable key={l.url} accessibilityRole="link" onPress={() => Linking.openURL(l.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs, minHeight: 32 }}>
          <Text style={[T.footnote, { color: C.lilac }]}>{l.label}</Text><Icon name="open-outline" size={14} color={C.lilac} />
        </Pressable>
      ))}
    </View>
  );
}
