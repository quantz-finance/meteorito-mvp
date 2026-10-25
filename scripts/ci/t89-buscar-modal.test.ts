// (89) Comprar › Buscar en un modalcito: sin input fijo sobre el feed; un cuarto icono (lupa) arriba a la derecha junto a
//      Feed, Pagar con link y Mis compras abre una hoja con el buscador enfocado (>= 16 px). Mismo comportamiento que antes
//      (debounce, filtro Identidad confirmada / Sin confirmar, Para ti / Siguiendo). Cerrar con X, tocando afuera o Esc;
//      limpiar la búsqueda; con búsqueda activa, punto en la lupa y chip arriba del feed para limpiarla.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { clearSearch, closeSearch, getFeedSearch, openSearch, setSearchText, subscribeFeedSearch, SEARCH_COPY } from '../../lib/feedSearch';

const read = (f: string) => readFileSync(f, 'utf8');
const BANNED = /seguro|garant|verificad|empresa|fintech|banco|billetera|proteg/i;
const VOSEO = /(?<![\p{L}])(tenés|podés|querés|buscá|escribí|tocá|cerrá|borrá)(?![\p{L}])/iu;

export async function run(t: T) {
  // ---------- Estado compartido (lupa <-> feed) ----------
  clearSearch(); closeSearch();
  let calls = 0; const off = subscribeFeedSearch(() => { calls++; });
  t.check('arranca cerrado y vacío', !getFeedSearch().open && getFeedSearch().text === '' && !getFeedSearch().active);
  openSearch();
  t.check('openSearch abre la hoja y avisa', getFeedSearch().open && calls === 1);
  setSearchText('bici');
  t.check('texto escrito = búsqueda activa (punto en la lupa)', getFeedSearch().text === 'bici' && getFeedSearch().active);
  setSearchText('   ');
  t.check('solo espacios no cuenta como búsqueda activa', !getFeedSearch().active);
  setSearchText('ps5'); closeSearch();
  t.check('cerrar la hoja conserva la búsqueda', !getFeedSearch().open && getFeedSearch().text === 'ps5' && getFeedSearch().active);
  clearSearch();
  t.check('limpiar deja el texto vacío', getFeedSearch().text === '' && !getFeedSearch().active);
  setSearchText('x'.repeat(200));
  t.check('máximo 60 caracteres', getFeedSearch().text.length === 60);
  clearSearch(); off();
  t.check('copy en tuteo, sin palabras prohibidas', Object.values(SEARCH_COPY).every((c) => typeof c !== 'string' || (!BANNED.test(c) && !VOSEO.test(c))) && SEARCH_COPY.open === 'Buscar' && SEARCH_COPY.title === 'Buscar productos');

  // ---------- Lupa: cuarto icono ----------
  const nav = read('components/ComprarNav.tsx');
  t.check('lupa (icono search, no emoji) con etiqueta accesible y mismo tamaño que los otros', /<Icon name="search"/.test(nav) && /accessibilityLabel=\{SEARCH_COPY\.open\}/.test(nav) && /testID="comprar-search"/.test(nav));
  t.check('lupa fuera del tablist de las 3 pantallas (es una acción, role button)', nav.indexOf('testID="comprar-search"') > nav.indexOf('COMPRAR_VIEWS.map') && /accessibilityRole="button" accessibilityLabel=\{SEARCH_COPY\.open\}/.test(nav));
  t.check('desde Pagar con link o Mis compras, la lupa lleva al feed con la hoja abierta', /openSearch\(\)/.test(nav) && /router\.replace\('\/comprar'\)/.test(nav));
  t.check('punto en la lupa con búsqueda activa', /testID="search-active"/.test(nav) && /useFeedSearch\(\)/.test(nav));
  t.check('4 iconos caben en iPhone SE: 44 px, separación 4', /btn: \{ width: 44, height: 44/.test(nav) && /row: \{ flexDirection: 'row', gap: 4 \}/.test(nav));

  // ---------- Feed sin input fijo + hoja ----------
  const feed = read('components/Feed.tsx');
  t.check('el feed ya no tiene un input fijo', !/<TextInput/.test(feed) && !/s\.searchInput/.test(feed));
  t.check('el feed usa la búsqueda compartida y la hoja', /useFeedSearch\(\)/.test(feed) && /<SearchSheet/.test(feed));
  t.check('chip arriba del feed con la búsqueda activa y botón para limpiarla', /testID="search-chip"/.test(feed) && /accessibilityLabel=\{COPY\.feed\.clear\}/.test(feed));
  t.check('mismo debounce y mismas consultas (filtro + vista)', /SEARCH_DEBOUNCE_MS = 3\d\d/.test(feed) && /getFeed\(\{ q, verified: filter/.test(feed));
  const sheet = read('components/SearchSheet.tsx');
  t.check('hoja: input enfocado, letra >= 16 px, etiqueta "Buscar productos"', /autoFocus/.test(sheet) && /input: \{[^}]*fontSize: (1[6-9]|2\d)/.test(sheet) && /accessibilityLabel=\{COPY\.feed\.searchLabel\}/.test(sheet));
  t.check('hoja: cerrar con X / afuera / Esc (Sheet con onClose) y Enter cierra', /<Sheet visible=\{open\} onClose=\{closeSearch\}/.test(sheet) && /onSubmitEditing=\{[^}]*closeSearch\(\)/.test(sheet));
  t.check('hoja: limpiar la búsqueda', /clearSearch\(\)/.test(sheet) && /accessibilityLabel=\{COPY\.feed\.clear\}/.test(sheet));
}
