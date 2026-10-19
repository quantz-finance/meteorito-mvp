// Fila discreta de enlaces legales + interruptor de analítica (Mi cuenta).
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { isOptedOut, setOptOut, track } from '@/lib/analytics';
import { Fonts } from '@/constants/Colors';
import { C, S, T, TOUCH } from '@/constants/theme';

export function AnalyticsToggle() {
  const [on, setOn] = useState(!isOptedOut());
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={T.headline}>Analítica de uso</Text>
        <Text style={T.footnote}>Datos anónimos para mejorar Meteorito. Sin correo, IMEI ni billetera.</Text>
      </View>
      <Switch value={on} accessibilityLabel="Analítica de uso" trackColor={{ true: C.purple, false: C.surface2 }} thumbColor={C.white}
        onValueChange={(v) => { if (!v) track('analytics_opted_out'); setOptOut(!v); setOn(v); }} />
    </View>
  );
}

export function LegalLinks({ onNavigate }: { onNavigate?: () => void }) {
  const go = (doc: string) => { onNavigate?.(); track('legal_opened', { doc }); router.push({ pathname: '/legal/[doc]', params: { doc } }); };
  const L = ({ t, on }: { t: string; on: () => void }) => (
    <Pressable onPress={on} accessibilityRole="link" hitSlop={8} style={s.link}><Text style={s.linkT}>{t}</Text></Pressable>
  );
  return (
    <View style={s.legal}>
      <View style={s.links}>
        <L t="Privacidad" on={() => go('privacidad')} /><Text style={s.sep}>·</Text>
        <L t="Términos de uso" on={() => go('terminos')} />
      </View>
      <Text style={[T.footnote, { textAlign: 'center', fontSize: 12 }]}>Meteorito · Costa Rica</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm },
  legal: { gap: S.xs, alignItems: 'center', paddingTop: S.sm },
  links: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  link: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: S.xs },
  linkT: { fontFamily: Fonts.bold, fontSize: 13, color: C.lilac },
  sep: { color: C.textDim, fontSize: 13 },
});
