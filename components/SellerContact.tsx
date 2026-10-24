// "Contacta al vendedor" en /p/<slug>: SOLO en el dispositivo del comprador y SOLO con el pedido pagado (lo decide la
// página con CONTACT_STATUSES + isBuyerDevice; el servidor vuelve a validar la llave/sesión y el estado).
// Si el vendedor no agregó su WhatsApp (o no está disponible), no se muestra nada.
import { useEffect, useState } from 'react';
import { Linking, Platform, Text } from 'react-native';
import { Card, PrimaryButton } from '@/components/ds';
import { S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { getSellerContact } from '@/lib/store';
import { formatContactPhone, waLink } from '../api/_lib/contact';
import { track } from '@/lib/analytics';

export function SellerContact({ slug }: { slug: string }) {
  const auth = useAuth();
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getSellerContact(auth, slug).then((p) => { if (live) setPhone(p); });
    return () => { live = false; };
  }, [slug]);
  if (!phone) return null;
  const href = waLink(phone);
  // Web: enlace real (<a href>) para que el navegador abra WhatsApp; nativo: Linking.
  const link = Platform.OS === 'web'
    ? { href, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' }, onPress: () => track('seller_contact_opened') }
    : { onPress: () => { track('seller_contact_opened'); Linking.openURL(href).catch(() => {}); } };
  return (
    <Card style={{ gap: S.sm }}>
      <Text style={T.caption}>Contacta al vendedor</Text>
      <Text style={T.callout}>Escríbele para coordinar el envío o si algo no está bien con tu compra.</Text>
      <PrimaryButton testID="seller-whatsapp" title="Escribir por WhatsApp" icon="logo-whatsapp" variant="secondary"
        accessibilityLabel={`Escribir al vendedor por WhatsApp, ${formatContactPhone(phone)}`} {...(link as object)} />
      <Text style={[T.footnote, { textAlign: 'center' }]}>{formatContactPhone(phone)}</Text>
    </Card>
  );
}
