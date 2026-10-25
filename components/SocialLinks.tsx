// Redes del vendedor (031): fila de iconos redondos en el perfil público y campos opcionales en "Editar mi tienda".
// Solo links https canónicos (api/_lib/socials.ts, el API vuelve a validar). Nunca van a analítica.
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, type IconName } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, S, T } from '@/constants/theme';
import { SOCIAL_KEYS, SOCIAL_LABEL, SOCIAL_MAX, type SocialKey, type Socials } from '../api/_lib/socials';

export const SOCIAL_ICON: Record<SocialKey, IconName> = {
  instagram: 'logo-instagram', tiktok: 'logo-tiktok', facebook: 'logo-facebook', x: 'logo-x', youtube: 'logo-youtube', website: 'globe-outline',
};
const REL = 'noopener noreferrer nofollow';

export function SocialRow({ socials }: { socials?: Socials | null }) {
  const keys = SOCIAL_KEYS.filter((k) => typeof socials?.[k] === 'string' && socials[k]!.startsWith('https://'));
  if (!keys.length) return null;
  return (
    <View style={{ gap: 4, marginTop: S.xs }}>
    <View style={s.row} testID="store-socials">
      {keys.map((k) => {
        const href = socials![k]!;
        const link = Platform.OS === 'web' ? { href, hrefAttrs: { target: '_blank', rel: REL } } : { onPress: () => { Linking.openURL(href).catch(() => {}); } };
        return (
          <Pressable key={k} accessibilityRole="link" accessibilityLabel={SOCIAL_LABEL[k]} testID={`social-${k}`} style={({ pressed }) => [s.dot, pressed && { opacity: 0.8 }]} {...(link as object)}>
            <Icon name={SOCIAL_ICON[k]} size={20} color={C.text} />
          </Pressable>
        );
      })}
    </View>
    <Text style={T.footnote} testID="socials-note">Meteorito no verifica estas cuentas. Para que tu compra quede en custodia, paga dentro de Meteorito.</Text>
    </View>
  );
}

export function SocialInputs({ value, onChange }: { value: Partial<Record<SocialKey, string>>; onChange: (v: Partial<Record<SocialKey, string>>) => void }) {
  return (
    <View style={{ gap: S.sm }}>
      <Text style={T.caption}>Tus redes (opcional)</Text>
      {SOCIAL_KEYS.map((k) => (
        <View key={k} style={[ui.input, { flexDirection: 'row', alignItems: 'center', gap: S.sm }]}>
          <Icon name={SOCIAL_ICON[k]} size={20} color={C.lilac} />
          <TextInput style={{ flex: 1, minWidth: 0, fontSize: 16, color: C.text, paddingVertical: S.sm, outlineStyle: 'none' } as object}
            value={value[k] ?? ''} onChangeText={(v) => onChange({ ...value, [k]: v })} maxLength={SOCIAL_MAX}
            placeholder={k === 'website' ? 'Sitio web (https://…)' : `${SOCIAL_LABEL[k]}: @usuario o link`} placeholderTextColor={C.textDim}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel={SOCIAL_LABEL[k]} testID={`social-input-${k}`} />
        </View>
      ))}
      <Text style={T.footnote}>Se muestran en tu tienda, a la vista de cualquiera que la visite. Puedes quitarlas cuando quieras.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: S.sm },
  dot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.lilacBg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
});
