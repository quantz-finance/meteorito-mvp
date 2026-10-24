// Rutas que se ven sin cuenta (puro: lo usan app/_layout.tsx y los tests). Todo lo demás muestra la bienvenida/login.
// El comprador no necesita cuenta (llave de invitado en este dispositivo): links de pago, tiendas, invitaciones, legales,
// reglas, chat y TODA la pestaña Comprar (Feed /comprar, Pagar con link /comprar/link y Mis compras /comprar/compras).
// Vender y Home son del vendedor: piden entrar.
const PUBLIC_ROOTS = ['p', 't', 'i', 'legal', 'como-funciona', 'mis-compras', 'chat', 'mensajes'];

export function isPublicRoute(segments: readonly string[]): boolean {
  if (PUBLIC_ROOTS.includes(segments[0])) return true;
  return segments[0] === '(tabs)' && segments[1] === 'comprar';
}
