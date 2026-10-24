// (66) Una sola página de tienda: /t/<usuario> es el perfil público y también "Mi tienda". Las herramientas del dueño
//      (editar, Mi cuenta, WhatsApp, historial, plantilla, pausar) solo con la sesión del dueño viendo su propia tienda;
//      visitantes e invitados nunca las ven. Compartir siempre visible (navigator.share, si no, copia el link). Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { isOwnerView, myStoreHref, shareLink } from '../../lib/storePage';

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

export async function run(t: T) {
  // ---- quién es dueño ----
  const anon = { isAuthenticated: false };
  const signed = { isAuthenticated: true };
  t.check('invitado (sin sesión) nunca es dueño', !isOwnerView(anon, 'valeria', 'valeria'));
  t.check('con sesión viendo otra tienda: visitante', !isOwnerView(signed, 'valeria', 'jose-games'));
  t.check('con sesión viendo su tienda: dueño', isOwnerView(signed, 'valeria', 'valeria'));
  t.check('el usuario del link no distingue mayúsculas ni espacios', isOwnerView(signed, 'valeria', ' Valeria '));
  t.check('con sesión pero sin tienda propia todavía: visitante', !isOwnerView(signed, null, 'valeria') && !isOwnerView(signed, '', ''));
  t.check('Mi tienda apunta a la URL canónica /t/<usuario>', myStoreHref('Valeria') === '/t/valeria');

  // ---- compartir: navigator.share, si no hay o falla, copiar ----
  const url = 'https://pago.meteorito.app/t/valeria';
  let shared: any = null; let copied: string | null = null;
  const copy = async (s: string) => { copied = s; };
  let m = await shareLink({ url, title: 'Valeria', text: 'Mira' }, { share: async (d: any) => { shared = d; } }, copy);
  t.check('con navigator.share: comparte el link y no copia', m === 'web_share' && shared?.url === url && copied === null, m);
  copied = null;
  m = await shareLink({ url, title: 'Valeria', text: 'Mira' }, { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }, copy);
  t.check('si la persona cancela la hoja de compartir: no copia', m === 'cancelled' && copied === null, m);
  m = await shareLink({ url, title: 'Valeria', text: 'Mira' }, { share: async () => { throw new Error('NotAllowed'); } }, copy);
  t.check('si navigator.share falla: copia el link', m === 'copy' && copied === url, m);
  copied = null;
  m = await shareLink({ url, title: 'Valeria', text: 'Mira' }, undefined, copy);
  t.check('sin navigator.share: copia el link', m === 'copy' && copied === url, m);

  // ---- textos ----
  const store = COPY.store as Record<string, unknown>;
  const flat = Object.values(store).map((v) => (typeof v === 'function' ? (v as (n: string) => string)('Valeria') : String(v))).join(' | ');
  t.check('textos de la tienda en lib/copy.ts sin palabras prohibidas', !!flat && !BANNED_COPY.test(flat), flat);
  t.check('tuteo, sin voseo', !/\b(tenés|podés|querés|compartí|mirá|tocá|editá)\b/i.test(flat), flat);

  // ---- la página ----
  const page = src('app/t/[store].tsx');
  t.check('/t/<usuario> decide el dueño con isOwnerView y la tienda de la sesión', /isOwnerView\(/.test(page) && /getMyStore\(/.test(page));
  t.check('herramientas del dueño en OwnerTools, montadas solo si owner', /owner && mine \? <OwnerTools\b/.test(page) && !/AccountSheet|AdTemplateSheet|PayoutEntry|updateMyStore|setListingStatus/.test(page));
  t.check('botón de compartir siempre visible (no depende de owner)', /testID="share-store"/.test(page) && !/owner \? <PrimaryButton[^>]*share-store/.test(page));
  const tools = src('components/OwnerTools.tsx');
  t.check('OwnerTools: editar, Mi cuenta (WhatsApp y cobros), historial, plantilla y pausar', ['AccountSheet', 'AdTemplateSheet', "'/ventas'", 'updateMyStore', 'setListingStatus'].every((k) => tools.includes(k)));
  t.check('inputs de OwnerTools a 16 px o más', !/fontSize:\s*1[0-5]\b/.test(tools.split('TextInput').slice(1).join('')));
  const mi = src('app/mi-tienda.tsx');
  t.check('/mi-tienda ya no es otra pantalla: redirige a /t/<usuario>', /router\.replace\(myStoreHref\(/.test(mi) && !/StoreItems|PayoutEntry|ShareLink/.test(mi));
}
