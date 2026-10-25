// Botón que abre (o retoma) una conversación y navega a /chat. Antes de comprar: con la tienda o un producto. Dentro
// de una compra: por el pedido (comprador o vendedor). Si el chat no está disponible (sin migración 025) no se muestra.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { PrimaryButton, toast, type IconName } from '@/components/ds';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/cavos';
import { chatHref, openChat, useChatAvailable, type ChatRole } from '@/lib/chat';
import { COPY } from '@/lib/copy';
import { getMyStore } from '@/lib/store';
import { isOwnerView } from '@/lib/storePage';

export type ChatTarget = { store_slug: string; item_slug?: string } | { item_slug: string } | { order_slug: string };

export function useOpenChat() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const open = async (as: ChatRole, target: ChatTarget, source: string, before?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await openChat(auth, as, target);
      before?.(); // p. ej. cerrar la hoja del pedido para que no quede encima del chat
      // Desde un producto, ?p=<slug>: el primer mensaje lleva la tarjeta del producto (estilo Messenger).
      const p = 'item_slug' in target && target.item_slug ? `&p=${target.item_slug}` : '';
      router.push(`${chatHref(r.token, r.role)}&src=${source}${p}` as never);
    } catch (e: any) {
      track('chat_open_failed', { source, code: String(e?.code ?? 'error').slice(0, 40) });
      toast(e?.code === 'chat_unavailable' ? COPY.chat.unavailable : e?.status === 429 || e?.code === 'self_chat' ? e.message : COPY.chat.openError, 'info');
    } finally { setBusy(false); }
  };
  return { open, busy };
}

export function ChatButton({ as, target, source, title = COPY.chat.send, icon = 'chatbubble-ellipses-outline', variant = 'secondary', a11y, testID = 'chat-button', onOpen }: {
  as: ChatRole; target: ChatTarget; source: string; title?: string; icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost'; a11y?: string; testID?: string; onOpen?: () => void;
}) {
  const available = useChatAvailable();
  const { open, busy } = useOpenChat();
  if (!available) return null;
  return <PrimaryButton testID={testID} title={title} icon={icon} variant={variant} loading={busy} accessibilityLabel={a11y ?? title} onPress={() => open(as, target, source, onOpen)} />;
}

/** "Preguntar al vendedor" en la ficha de un producto: siempre visible (sin cuenta, con la llave), sin esperar el perfil
 *  de la tienda (sin storeSlug abre solo con el producto). Se oculta si quien mira es el dueño de la tienda. */
export function AskSellerButton({ storeSlug, itemSlug }: { storeSlug: string | null | undefined; itemSlug: string }) {
  const auth = useAuth();
  const [mineSlug, setMineSlug] = useState<string | null | undefined>(auth.isAuthenticated ? undefined : null);
  useEffect(() => {
    if (!auth.isAuthenticated) { setMineSlug(null); return; }
    let live = true;
    getMyStore(auth).then((x) => live && setMineSlug(x.store_slug)).catch(() => live && setMineSlug(null));
    return () => { live = false; };
  }, [auth.isAuthenticated, auth.address]);
  // Con sesión se espera a saber de quién es la tienda (undefined = cargando) para no mostrárselo un instante al dueño.
  if (mineSlug === undefined || (auth.isAuthenticated && storeSlug === undefined) || (storeSlug && isOwnerView(auth, mineSlug, storeSlug))) return null;
  const target: ChatTarget = storeSlug ? { store_slug: storeSlug, item_slug: itemSlug } : { item_slug: itemSlug };
  return <ChatButton as="buyer" target={target} source="product" title={COPY.chat.askSeller} testID="ask-seller" />;
}
