import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon, Sheet, type IconName } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { LEARN } from '@/lib/learn';
import { track } from '@/lib/analytics';

/** Explicación breve de Cavos, quién controla qué, custodia y testnet. Acordeón: toca un tema para leer más. */
export function LearnSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>('cavos');
  return (
    <Sheet visible={visible} onClose={onClose} title="Cómo funciona">
      {LEARN.map((l) => {
        const on = open === l.id;
        return (
          <View key={l.id} style={{ backgroundColor: C.lilacBg, borderRadius: R.md, padding: S.md, gap: S.sm }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => { setOpen(on ? null : l.id); if (!on) track('learn_opened', { topic: l.id }); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 32 }}>
              <Icon name={l.icon as IconName} size={22} color={C.lilac} />
              <Text style={[T.headline, { flex: 1 }]}>{l.title}</Text>
              <Icon name={on ? 'chevron-up' : 'chevron-down'} size={18} color={C.textDim} />
            </Pressable>
            {on && <>
              <Text style={T.body}>{l.summary}</Text>
              {l.points.map((p) => (
                <View key={p} style={{ flexDirection: 'row', gap: S.sm }}>
                  <Text style={[T.callout, { color: C.lilac }]}>•</Text>
                  <Text style={[T.callout, { flex: 1 }]}>{p}</Text>
                </View>
              ))}
            </>}
          </View>
        );
      })}
    </Sheet>
  );
}
