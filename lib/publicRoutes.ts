// Rutas que se ven sin cuenta (puro: lo usan app/_layout.tsx y los tests). Todo lo demás muestra la bienvenida/login.
// Comprar y los links de pago piden una cuenta Cavos. La invitación del vendedor sigue pública.
const PUBLIC_ROOTS = ['t', 'i', 'legal', 'como-funciona', 'chat', 'mensajes'];

export function isPublicRoute(segments: readonly string[]): boolean {
  // Crear una invitación de comprador (/i/nueva) pide entrar: quien compra crea su cuenta y empieza la transacción.
  // Sin sesión se ve el login en la misma URL y, al entrar, sigue en /i/nueva. Abrir/aceptar una invitación (/i/<código>) sigue siendo público.
  if (segments[0] === 'i' && segments[1] === 'nueva') return false;
  if (PUBLIC_ROOTS.includes(segments[0])) return true;
  return false;
}

const TAB_ROUTES = ['vender', 'pedidos', 'comprar'];
/** Igual que isPublicRoute, pero con un link ("/p/abc?x=1", "/comprar/compras"). */
export function isPublicPath(href: string): boolean {
  const segs = String(href).split(/[?#]/)[0].split('/').filter(Boolean);
  return isPublicRoute(TAB_ROUTES.includes(segs[0]) ? ['(tabs)', ...segs] : segs);
}
/** Donde cae el comprador sin cuenta cuando no hay a dónde volver. */
export const GUEST_HOME = '/como-funciona';
/** Volver sin historial: con cuenta, el destino de siempre; sin cuenta, nunca una ruta con login (-> Mis compras). */
export function guestFallback<H extends string>(href: H, guest: boolean): H | typeof GUEST_HOME {
  return guest && !isPublicPath(href) ? GUEST_HOME : href;
}

type NavState = { index?: number; routes: { name: string; state?: NavState; params?: { screen?: string } }[] } | undefined;
/** ¿La pantalla anterior de la pila (estado de react-navigation) se ve sin cuenta? Un link abierto directo trae debajo
 *  "(tabs)" sin montar (initialRouteName): eso es Vender (con login), no historial real del comprador. */
export function prevIsPublic(state: NavState): boolean {
  if (!state?.routes?.length) return false;
  const i = state.index ?? state.routes.length - 1;
  if (i < 1) return false;
  const prev = state.routes[i - 1];
  if (prev.name === '(tabs)') {
    // getState() no siempre trae el estado hijo: la pestaña sale de params.screen (navegación hacia ella)
    const tabs = prev.state; const tab = tabs?.routes?.[tabs.index ?? 0]?.name ?? prev.params?.screen ?? 'vender';
    return isPublicRoute(['(tabs)', ...tab.split('/')]);
  }
  return isPublicRoute(prev.name.split('/'));
}
