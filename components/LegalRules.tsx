// Reglas con texto legal aprobado (lib/rules.ts LEGAL_RULES), renderizadas desde ahí: hoja "Al pagar aceptas" (antes de
// pagar), acuerdo de la beta en Vender (antes de publicar) y /como-funciona. Nunca se copia el texto a mano.
import { Text, View } from 'react-native';
import { Icon, PrimaryButton, Sheet } from '@/components/ds';
import { legalMark } from '@/components/RulesLink';
import { C, S, T } from '@/constants/theme';
import { currentLegalRules, SELLER_AGREEMENT_ACCEPT, SELLER_AGREEMENT_INTRO, SELLER_AGREEMENT_TITLE, type LegalRule } from '@/lib/rules';

/** Filas de reglas (icono + título + texto exacto). */
export function LegalRuleRows({ rules, heading }: { rules: LegalRule[]; heading?: string }) {
  if (!rules.length) return null;
  return (
    <View testID="legal-rules" style={{ gap: S.sm }} {...legalMark}>
      {heading ? <Text style={T.caption}>{heading}</Text> : null}
      {rules.map((r) => (
        <View key={r.id} testID={`legal-rule-${r.id}`} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
          <Icon name={r.icon} size={20} color={C.lilac} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[T.headline, { fontSize: 15 }]}>{r.title}</Text>
            <Text style={T.callout}>{r.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Acuerdo de la beta para vender: se ve y se acepta antes de publicar (una vez por versión de reglas, por dispositivo). */
export function SellerAgreementSheet({ visible, mode, onAccept, onClose }: { visible: boolean; mode: string; onAccept: () => void; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={SELLER_AGREEMENT_TITLE}
      footer={<PrimaryButton testID="rules-accept" title={SELLER_AGREEMENT_ACCEPT} icon="checkmark" onPress={onAccept} />}>
      <Text style={T.callout}>{SELLER_AGREEMENT_INTRO}</Text>
      <LegalRuleRows rules={currentLegalRules(mode)} />
    </Sheet>
  );
}
