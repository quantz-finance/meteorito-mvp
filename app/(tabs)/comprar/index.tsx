// Comprar › Feed (/comprar, la pantalla por defecto): solo el feed (buscador, filtro y publicaciones), sin nada encima.
// Pagar con link y Mis compras se abren con los iconos de arriba a la derecha (components/ComprarNav).
import { Screen } from '@/components/ds';
import { ComprarNav } from '@/components/ComprarNav';
import { Feed } from '@/components/Feed';

export default function Comprar() {
  return (
    <Screen title="Comprar" scroll={false} right={<ComprarNav active="feed" />}>
      <Feed header={<></>} />
    </Screen>
  );
}
