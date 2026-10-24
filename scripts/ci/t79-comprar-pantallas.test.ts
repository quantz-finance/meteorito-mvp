// (70) Comprar en 3 pantallas con su propio link: Feed (/comprar, por defecto, solo el feed), Pagar con link
//      (/comprar/link: importar de un link, invitar al vendedor y pagar un link, igual que antes) y Mis compras (/comprar/compras),
//      con 3 iconos del mismo tamaño arriba a la derecha, estado activo y etiquetas accesibles.
import { existsSync, readFileSync } from 'node:fs';
import type { T } from './setup';
import { COMPRAR_VIEWS } from '../../lib/comprarViews';

const read = (f: string) => readFileSync(f, 'utf8');
export async function run(t: T) {
  t.check('3 pantallas con link propio, en orden Feed, Pagar con link, Mis compras', JSON.stringify(COMPRAR_VIEWS.map((v) => [v.label, v.href])) === JSON.stringify([['Feed', '/comprar'], ['Pagar con link', '/comprar/link'], ['Mis compras', '/comprar/compras']]));
  t.check('iconos (sin emoji): tienda, link, bolsa', COMPRAR_VIEWS.map((v) => v.icon).join(',') === 'storefront-outline,link-outline,bag-check-outline');
  t.check('rutas: comprar/index, link, compras con layout propio; la pestaña sigue siendo "comprar"', ['index', 'link', 'compras', '_layout'].every((f) => existsSync(`app/(tabs)/comprar/${f}.tsx`)) && !existsSync('app/(tabs)/comprar.tsx'));
  const nav = read('components/ComprarNav.tsx');
  t.check('iconos del mismo tamaño (44), estado activo claro (fondo lila + aria-selected) y etiqueta accesible', /btn: \{ width: 44, height: 44/.test(nav) && /on: \{ backgroundColor: C\.lilac \}/.test(nav) && /aria-selected=\{on\}/.test(nav) && /accessibilityLabel=\{v\.label\}/.test(nav) && /accessibilityRole="tab"/.test(nav));
  const feed = read('app/(tabs)/comprar/index.tsx'), link = read('app/(tabs)/comprar/link.tsx'), compras = read('app/(tabs)/comprar/compras.tsx');
  t.check('Feed: solo el feed, nada encima', /<Feed header=\{<><\/>\} \/>/.test(feed) && !/Importar de un link|Pagar un link|Invitar a un vendedor/.test(feed) && /<ComprarNav active="feed" \/>/.test(feed));
  t.check('Pagar con link: importar, invitar y pagar un link, sin scroll', /Importar de un link/.test(link) && /Invitar a un vendedor/.test(link) && /Pagar un link/.test(link) && /scroll=\{false\}/.test(link) && /<ComprarNav active="link" \/>/.test(link) && !/<Feed/.test(link));
  t.check('Mis compras con el mismo selector arriba a la derecha', /<ComprarNav active="compras" \/>/.test(compras));
  t.check('link anterior /mis-compras redirige a /comprar/compras', /Redirect href="\/comprar\/compras"/.test(read('app/mis-compras.tsx')));
}
