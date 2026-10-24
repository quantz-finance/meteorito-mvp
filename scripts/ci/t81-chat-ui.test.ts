// (81) Chat en la app: entradas (tienda, producto antes de pagar, compra activa de los dos lados), bandejas con
//      insignia sin pestaña nueva, pantalla de conversación (letra 16 px, respuestas rápidas, aviso suave de pagar
//      dentro, eventos), copy en tuteo sin palabras prohibidas y línea de privacidad marcada para revisión legal.
import { existsSync, readFileSync } from 'node:fs';
import type { T } from './setup';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { LEGAL } from '../../lib/legal';

const read = (f: string) => readFileSync(f, 'utf8');

export async function run(t: T) {
  const K = COPY.chat;
  const strings = (o: any): string[] => Object.values(o).flatMap((v: any) => typeof v === 'string' ? [v] : typeof v === 'function' ? [String(v('Valeria')), String(v(1)), String(v(3))] : Array.isArray(v) ? v.flat().map(String) : strings(v));
  const all = strings(K);
  t.check('copy del chat sin palabras prohibidas', all.every((x) => !BANNED_COPY.test(x) && !/\b(pronto|regulad[oa]|proteg\w*)\b/i.test(x)), all.filter((x) => BANNED_COPY.test(x)).join(' | '));
  t.check('copy del chat en tuteo (sin voseo)', all.every((x) => !/\b(vos|tenés|podés|querés|escribí|tocá|mirá|pagá|preguntale|escribile)\b/i.test(x)), all.join(' | '));
  t.check('respuestas rápidas exactas', JSON.stringify(K.quick) === JSON.stringify(['¿Sigue disponible?', '¿Haces envíos?', '¿Precio final?']));
  t.check('aviso suave exacto', K.payInside === 'Para que tu compra quede en custodia, paga dentro de Meteorito.');

  // Entradas
  const store = read('app/t/[store].tsx');
  t.check('/t/<usuario>: "Enviar mensaje" solo si no es el dueño, ligado a la tienda', /\{!owner(?: && !p\.demo)? \? <ChatButton as="buyer" target=\{\{ store_slug: p\.store_slug \}\} source="store"/.test(store));
  const ficha = read('app/p/[slug].tsx');
  t.check('/p/<slug>: "Preguntar al vendedor" solo antes de pagar, con tienda + producto', /seller && \(order\.status === 'creado' \|\| order\.status === 'escrow_creado'\) \? <AskSellerButton storeSlug=\{seller\.store_slug\} itemSlug=\{order\.slug\}/.test(ficha));
  t.check('/p/<slug>: chat de la compra solo pagado + en el dispositivo del comprador', /canShowContact\(order\.status\) && isBuyerDevice\(order\.slug\) \? <OrderChatCard slug=\{order\.slug\}/.test(ficha));
  const btn = read('components/ChatButton.tsx');
  t.check('el botón se oculta sin chat (025) y para el dueño', /if \(!available\) return null/.test(btn) && /isOwnerView\(auth, mineSlug, storeSlug\)\) return null/.test(btn));
  const home = read('app/(tabs)/pedidos.tsx');
  t.check('Home: chat del pedido para el vendedor (con comprador) y bandeja con insignia en el encabezado', /open\.status !== 'creado' \? <SellerOrderChat slug=\{open\.slug\} onOpen=/.test(home) && /<SellerInboxButton \/>/.test(home));
  t.check('Mis compras: fila "Tus mensajes" y punto en el icono de Mis compras', /<BuyerInboxRow \/>/.test(read('app/(tabs)/comprar/compras.tsx')) && /compras-unread/.test(read('components/ComprarNav.tsx')));
  const tabs = read('app/(tabs)/_layout.tsx');
  t.check('sin pestaña nueva: siguen 3 (Vender, Comprar, Home)', (tabs.match(/<Tabs\.Screen\b/g) ?? []).filter((x) => x).length <= 4 && !/mensajes|chat/.test(tabs));
  const lay = read('app/_layout.tsx');
  t.check('/chat y /mensajes visibles sin cuenta (comprador invitado)', /segments\[0\] === 'chat'/.test(lay) && /segments\[0\] === 'mensajes'/.test(lay));

  // Pantallas
  t.check('pantallas: app/chat.tsx y app/mensajes.tsx', existsSync('app/chat.tsx') && existsSync('app/mensajes.tsx'));
  const chat = read('app/chat.tsx');
  t.check('compositor a 16 px o más', /input: \{[^}]*fontSize: (1[6-9]|2\d)/.test(chat));
  t.check('eventos chat_opened, chat_message_sent y chat_quick_reply', ['chat_opened', 'chat_message_sent', 'chat_quick_reply'].every((e) => chat.includes(`track('${e}'`)));
  t.check('analítica sin el texto de los mensajes', !/track\('chat_message_sent', \{[^}]*\b(body|text|t)\s*[:,}]/.test(chat));
  t.check('aviso de pagar dentro solo antes de pagar y si se comparte contacto', /chat-pay-inside/.test(chat) && /sharesContact/.test(chat) && /paid/.test(chat));
  t.check('respuestas rápidas solo para el comprador', /role === 'buyer'/.test(chat) && /chat-quick/.test(chat));
  t.check('el token va en el query (/chat?c=), nunca en la ruta', /\/chat\?c=\$\{token\}/.test(read('lib/chat.ts')) && !existsSync('app/chat/[token].tsx'));
  t.check('animaciones solo transform/opacity', !/m-(dot|msg)[^}]*\b(width|height|top|left|margin)\s*:/.test(read('constants/motion.ts')));

  // Privacidad (para revisión legal)
  const legal = read('lib/legal.ts');
  const line = JSON.stringify(LEGAL.privacidad);
  t.check('privacidad: línea del chat marcada para revisión legal (Neo)', /REVISIÓN LEGAL \(Neo\)[^\n]*chat/.test(legal) && /Mensajes del chat/.test(line) && /12 meses/.test(line));
  t.check('privacidad: retención en pausa con disputa abierta (12 meses desde la resolución)', /Borramos cada conversación 12 meses después de su último mensaje\. Si hay una disputa abierta, no la borramos y los 12 meses empiezan a contar cuando se resuelve\./.test(line));
  t.check('privacidad: sin "quedan en este dispositivo" (los mensajes se guardan en el servidor)', !/quedan en este dispositivo/.test(JSON.stringify(K)));
  // Copy final aprobado (Neo): avisos que sí existen, reporte sin aviso a la otra parte, bloqueo con compra o disputa.
  t.check('copy final: bandeja vacía, primer mensaje, reporte y bloqueo', K.inboxEmptyBuyer === 'Escríbele a un vendedor desde su tienda o un producto. Tus conversaciones aparecen aquí.'
    && K.first('Valeria') === 'Escríbele a Valeria. Su respuesta aparecerá aquí.' && K.firstSeller === 'Escríbele al comprador. Su respuesta aparecerá aquí.'
    && K.reportText === 'Cuéntanos qué pasa. El equipo de Meteorito lo revisa. No le avisamos que la reportaste.'
    && K.blockLocked === 'No puedes bloquear mientras haya una compra en curso o una disputa abierta. Si hay un problema, repórtalo.' && !/avisamos cuando respond/i.test(JSON.stringify(all)));
  t.check('pantalla: con compra o disputa, Bloquear queda deshabilitado con la explicación (el servidor también lo rechaza)', /testID="chat-block-locked"/.test(chat) && /K\.blockLocked/.test(chat) && /state\.blocked \|\| canBlock/.test(chat));
  t.check('la línea legal no usa palabras prohibidas', !BANNED_COPY.test(legal.split('\n').find((l) => l.includes('Mensajes del chat')) ?? ''));
}
