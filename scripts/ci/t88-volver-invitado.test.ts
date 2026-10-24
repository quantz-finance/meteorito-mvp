// (88) Volver del comprador sin cuenta: si no hay historial, ninguna pantalla pública lo manda a una ruta con login
//      (Home /pedidos, Vender /vender...): va a Mis compras (/comprar/compras). Con cuenta, igual que antes.
//      + Bienvenida: "Quiero comprar (sin cuenta)" abre el feed (/comprar); pedir un link sigue en Comprar › Pagar con link.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { GUEST_HOME, guestFallback, isPublicPath, prevIsPublic } from '../../lib/publicRoutes';

const read = (f: string) => readFileSync(f, 'utf8');
export async function run(t: T) {
  t.check('rutas con login: /pedidos, /vender, /, /mi-tienda, /ventas, /admin/disputas', ['/pedidos', '/vender', '/', '/mi-tienda', '/ventas', '/admin/disputas'].every((p) => !isPublicPath(p)));
  t.check('rutas públicas: Comprar (3), /p, /t, /i, legales, reglas, chat', ['/comprar', '/comprar/link', '/comprar/compras', '/p/abc', '/t/valeria', '/i/nueva', '/legal/privacidad', '/como-funciona', '/chat?x=1', '/mensajes'].every(isPublicPath));
  t.check('invitado sin historial: /pedidos -> Mis compras', GUEST_HOME === '/comprar/compras' && guestFallback('/pedidos', true) === '/comprar/compras');
  t.check('invitado: /vender (legales, reglas) -> Mis compras', guestFallback('/vender', true) === '/comprar/compras');
  t.check('invitado: un destino público se respeta (/comprar)', guestFallback('/comprar', true) === '/comprar');
  t.check('con cuenta: sin cambios', guestFallback('/pedidos', false) === '/pedidos' && guestFallback('/vender', false) === '/vender');
  // Pila de react-navigation: un link abierto directo trae "(tabs)" sin montar debajo (initialRouteName = Vender, con login).
  t.check('link directo: debajo "(tabs)" sin montar (Vender) -> no es historial del comprador', !prevIsPublic({ index: 1, routes: [{ name: '(tabs)' }, { name: 'p/[slug]' }] }));
  t.check('debajo Home/Vender montados -> tampoco', !prevIsPublic({ index: 1, routes: [{ name: '(tabs)', state: { index: 2, routes: [{ name: 'vender' }, { name: 'comprar' }, { name: 'pedidos' }] } }, { name: 'p/[slug]' }] }));
  t.check('debajo Comprar (Mis compras) -> atrás de verdad', prevIsPublic({ index: 1, routes: [{ name: '(tabs)', state: { index: 1, routes: [{ name: 'vender' }, { name: 'comprar' }, { name: 'pedidos' }] } }, { name: 'p/[slug]' }] }));
  t.check('debajo otra pantalla pública (/t, /p) -> atrás de verdad; sin nada debajo -> no', prevIsPublic({ index: 2, routes: [{ name: '(tabs)' }, { name: 't/[store]' }, { name: 'p/[slug]' }] }) && !prevIsPublic({ index: 0, routes: [{ name: 'p/[slug]' }] }) && !prevIsPublic(undefined));
  t.check('estado real de getState(): (tabs) con params.screen=comprar (sin estado hijo) -> atrás de verdad', prevIsPublic({ index: 1, routes: [{ name: '(tabs)', params: { screen: 'comprar' } }, { name: 'p/[slug]' }] }) && !prevIsPublic({ index: 1, routes: [{ name: '(tabs)', params: { screen: 'pedidos' } }, { name: 'p/[slug]' }] }));
  const back = read('components/BackButton.tsx');
  t.check('useBack: con cuenta igual que antes (goBack)', /if \(!guest \|\| typeof to !== 'string'\) return goBack\(to\)/.test(back));
  t.check('useBack invitado: atrás solo si la anterior es pública; si no, Mis compras (o guestExit)', /if \(router\.canGoBack\(\) && prevIsPublic\(nav\.getState\(\) as any\)\) router\.back\(\)/.test(back) && /else router\.replace\(guestFallback\(to, true\) as Href\)/.test(back));
  t.check('BackButton y la X del encabezado usan useBack', /const back = useBack\(fallback, replace\)/.test(back) && /useBack\(to \?\? '\/vender', false, guestBack\)/.test(read('components/ds.tsx')));
  t.check('legales y reglas (se abren desde la bienvenida): el invitado vuelve a la bienvenida', ['app/legal/[doc].tsx', 'app/como-funciona.tsx'].every((f) => /<Screen back="\/vender" guestBack="\/"/.test(read(f))));
  t.check('/p/<pedido> sigue pidiendo /pedidos (con cuenta) y el invitado cae en Mis compras', /back="\/pedidos"/.test(read('app/p/[slug].tsx')));
  const w = read('components/Welcome.tsx');
  t.check('bienvenida: "Quiero comprar (sin cuenta)" abre el feed /comprar (no /i/nueva)', /track\('buyer_start_tapped'\); router\.push\('\/comprar'\)/.test(w) && !/router\.push\('\/i\/nueva'\)/.test(w));
  t.check('pedir un link sigue en Comprar › Pagar con link', /router\.push\('\/i\/nueva'\)/.test(read('app/(tabs)/comprar/link.tsx')));
}
