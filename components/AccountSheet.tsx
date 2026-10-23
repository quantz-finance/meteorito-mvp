// "Mi cuenta" (antes en Inicio; ahora se abre desde el encabezado de Pedidos).
import { lazy, Suspense, useState } from 'react';
import { Text } from 'react-native';
import { Card, ErrorText, PrimaryButton, Sheet, SkeletonCard } from '@/components/ds';
import { AnalyticsToggle, LegalLinks } from '@/components/LegalLinks';
import { T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { logoutSafely } from '@/lib/wallet';
const ProfileCard = lazy(() => import('@/components/Payout').then((m) => ({ default: m.ProfileCard }))); // diferido: solo al abrir

export function AccountSheet({ visible, onClose, products }: { visible: boolean; onClose: () => void; products: number }) {
  const auth = useAuth();
  const [logoutMsg, setLogoutMsg] = useState<string | null>(null);
  return (
    <Sheet page visible={visible} onClose={onClose} title="Mi cuenta"
      footer={<PrimaryButton title="Cerrar sesión" icon="log-out-outline" variant="secondary" onPress={async () => { const m = await logoutSafely(auth); if (m) { setLogoutMsg(m); return; } setLogoutMsg(null); onClose(); }} />}>
      {logoutMsg ? <ErrorText>{logoutMsg}</ErrorText> : null}
      {visible ? <Suspense fallback={<SkeletonCard />}><ProfileCard products={products} /></Suspense> : null}
      <Card><Text style={T.caption}>Correo</Text><Text style={T.body}>{auth.email ?? '—'}</Text></Card>
      <Card><AnalyticsToggle /></Card>
      <LegalLinks onNavigate={onClose} />
    </Sheet>
  );
}
