// (85) Mis compras sin cuenta (comprador invitado). Bug: sin sesión, el icono de la bienvenida abría /comprar/compras con
//      la app completa (barra Vender/Comprar/Home + iconos de Comprar) y sin salida: solo esa ruta era pública, así que
//      Feed, Vender y Home volvían a la bienvenida/login o no hacían nada. Arreglo: toda la pestaña Comprar es pública
//      (Feed, Pagar con link, Mis compras), sin barra de pestañas para el invitado (Vender y Home piden entrar) y con
//      "Volver" arriba; vacío amable con link al feed; el seguimiento /p/<pedido> se abre con push (atrás vuelve aquí).
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { isPublicRoute } from '../../lib/publicRoutes';
import { MY_PURCHASES_EMPTY, MY_PURCHASES_TO_FEED } from '../../lib/purchases';
import { COMPRAR_VIEWS } from '../../lib/comprarViews';

const read = (f: string) => readFileSync(f, 'utf8');
const BANNED = /seguro|garant|verificad|empresa|fintech|banco|billetera|proteg/i;
const VOSEO = /(?<![\p{L}])(tenés|podés|querés|mirá|tocá|fijate)(?![\p{L}])/iu;

export async function run(t: T) {
  // ---------- Rutas públicas (sin login) ----------
  t.check('Comprar › Feed (/comprar) se ve sin cuenta', isPublicRoute(['(tabs)', 'comprar']));
  t.check('Comprar › Pagar con link se ve sin cuenta', isPublicRoute(['(tabs)', 'comprar', 'link']));
  t.check('Comprar › Mis compras se ve sin cuenta', isPublicRoute(['(tabs)', 'comprar', 'compras']));
  t.check('los 3 iconos de Comprar llevan a rutas públicas (nunca a la bienvenida/login)', COMPRAR_VIEWS.every((v) => isPublicRoute(['(tabs)', ...v.href.split('/').filter(Boolean)])));
  t.check('seguimiento /p, tienda /t, invitaciones /i, legales, reglas, /mis-compras, chat: públicos', ['p', 't', 'i', 'legal', 'como-funciona', 'mis-compras', 'chat', 'mensajes'].every((r) => isPublicRoute([r, 'x'])));
  t.check('Vender y Home (vendedor) siguen pidiendo entrar', !isPublicRoute(['(tabs)', 'vender']) && !isPublicRoute(['(tabs)', 'pedidos']) && !isPublicRoute(['mi-tienda']) && !isPublicRoute(['ventas']) && !isPublicRoute([]));
  const layout = read('app/_layout.tsx');
  t.check('el Gate usa isPublicRoute (una sola lista, probada)', /const isPublic = isPublicRoute\(segments/.test(layout) && !/segments\[0\] === 'p' \|\|/.test(layout));

  // ---------- Una sola navegación, sin menús del vendedor ----------
  const tabs = read('app/(tabs)/_layout.tsx');
  t.check('invitado: sin barra de pestañas (Vender/Home piden entrar); con cuenta, la barra normal', /const guest = useIsGuest\(\)/.test(tabs) && /tabBar=\{\(p\) => \(guest \? null : <TabBar \{\.\.\.p\} \/>\)\}/.test(tabs));
  const nav = read('components/ComprarNav.tsx');
  t.check('useIsGuest = sin sesión Cavos con dirección', /return !\(auth\.isAuthenticated && auth\.address\)/.test(nav) && /GUEST_BACK = '\/'/.test(nav));
  for (const [f, active] of [['index', 'feed'], ['link', 'link'], ['compras', 'compras']] as const) {
    const s = read(`app/(tabs)/comprar/${f}.tsx`);
    t.check(`${f}: invitado con "Volver" arriba a la izquierda + el mismo selector de 3 iconos`, /const guest = useIsGuest\(\)/.test(s) && /<Screen back=\{guest \? GUEST_BACK : undefined\} backTop /.test(s) && s.includes(`<ComprarNav active="${active}" />`));
  }
  const ds = read('components/ds.tsx');
  t.check('Screen backTop: Volver encima del título (no compite con los 3 iconos)', /const backBtn = back && \(!title \|\| backTop\) \? <BackButton fallback=\{back\} replace=\{backTop\} \/>/.test(ds) && /back=\{backTop \? undefined : back\}/.test(ds));

  t.check('Volver del invitado va directo a la bienvenida (la bienvenida no está en la pila: router.back() no hacía nada)', /if \(replace\) exitTo\(fallback\); else goBack\(fallback\)/.test(read('components/BackButton.tsx')) && /window\.location\.assign\(String\(href\)\)/.test(read('components/BackButton.tsx')));

  // ---------- Vacío amable + seguimiento con push ----------
  t.check('vacío: "Aquí verás tus compras activas." + link al feed', MY_PURCHASES_EMPTY === 'Aquí verás tus compras activas.' && MY_PURCHASES_TO_FEED === 'Ver productos');
  const compras = read('app/(tabs)/comprar/compras.tsx');
  t.check('el link del vacío vuelve al feed (/comprar)', /title=\{MY_PURCHASES_TO_FEED\}[^\n]*router\.replace\('\/comprar'\)/.test(compras));
  t.check('cada fila abre el seguimiento con push (atrás vuelve a Mis compras)', /router\.push\(\{ pathname: '\/p\/\[slug\]'/.test(compras));
  t.check('copy sin palabras prohibidas ni voseo', ![MY_PURCHASES_EMPTY, MY_PURCHASES_TO_FEED].some((c) => BANNED.test(c) || VOSEO.test(c)));
}
