// Comprar › Feed (/comprar, la pantalla por defecto): solo el feed (buscador, filtro y publicaciones), sin nada encima.
// Pagar con link y Mis compras se abren con los iconos de arriba a la derecha (components/ComprarNav).
import { Screen } from '@/components/ds';
import { ComprarNav, GUEST_BACK, useIsGuest } from '@/components/ComprarNav';
import { Feed } from '@/components/Feed';

export default function Comprar() {
  const guest = useIsGuest(); // sin cuenta: sin barra de pestañas, Volver arriba a la izquierda
  return (
    <Screen back={guest ? GUEST_BACK : undefined} backTop title="Comprar" scroll={false} right={<ComprarNav active="feed" />}>
      <Feed header={<></>} />
    </Screen>
  );
}
