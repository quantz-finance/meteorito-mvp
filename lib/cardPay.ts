// Pago con tarjeta (Lendara). Abre el widget de @lendara/widget en modo "modal" (iframe sobre la página): en una PWA de
// iOS en pantalla completa los popups se abren fuera de la app (o se bloquean tras un await), el iframe no.
// El widget solo avisa; quien decide si el pedido quedó pagado es el servidor (step card_confirm verifica en Lendara y
// en Horizon). Ver docs/lendara-card.md.
import { Platform } from 'react-native';
import { Lendara } from '@lendara/widget'; // estático: nada de chunks async (t40); no toca window al importar

export type CardWidgetResult = 'completed' | 'failed' | 'closed';
const STYLE_ID = 'meteorito-lendara-style';
// Pantalla completa en teléfono: respetar el notch / la barra de inicio de la PWA (el widget no lo hace).
const CSS = `@media (max-width:520px){.lendara-overlay{padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)!important;background:#fff!important}
.lendara-frame{height:calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))!important}}`;

/** Abre el widget y resuelve cuando el pago se completa, falla o la persona lo cierra. */
export async function openCardWidget(url: string): Promise<CardWidgetResult> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') throw new Error('El pago con tarjeta está disponible en la web.');
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.append(s);
  }
  return new Promise((resolve) => {
    let result: CardWidgetResult = 'closed';
    const h = Lendara.open({
      url, mode: 'modal',
      onComplete: () => { result = 'completed'; h.close(); },
      // Fallo (KYC, vencido…): el widget muestra su propio estado; al cerrarlo el servidor da el motivo en español.
      onError: () => { result = 'failed'; },
      onClose: () => resolve(result),
    });
  });
}
