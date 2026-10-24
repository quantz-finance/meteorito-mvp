// (68) Comprar → Invitar a un vendedor con el link de CUALQUIER marketplace (no solo Facebook): mismo detector de
// proveedores que "Importar de un link". Facebook y Walmart se leen (nombre, precio, foto); Mercado Libre, Amazon,
// Encuentra24… bloquean nuestros servidores: el link se acepta igual, sin error y SIN pedirlo, y va en la invitación.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { res } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import invites from '../../api/invites/index';
import { inviteShareMessage, sourceName } from '../../lib/inviteShare';
import { detectProvider, inviteCanRead, inviteDetectedLabel, inviteImportNotice, inviteMarketsLabel, INVITE_MARKETS, type ListingImport } from '../../lib/listingImport';

const call = async (h: any, o: { method?: string; body?: any; query?: any; guest?: string | null }) => {
  const r = res(); const rq: any = { method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}) }, body: o.body ?? {}, query: o.query ?? {} };
  await h(rq, r); return r;
};
const LINKS = {
  facebook: 'https://www.facebook.com/marketplace/item/443277198670299/',
  walmart: 'https://www.walmart.co.cr/bicicleta-montana-aro-29/p',
  mercadolibre: 'https://articulo.mercadolibre.com.mx/MLM-123456789-bicicleta-aro-29-_JM',
  amazon: 'https://www.amazon.com.mx/dp/B0CHX1W1XY',
  encuentra24: 'https://www.encuentra24.com/costa-rica-es/deportes-bicicletas/bicicleta-aro-29/12345678',
  aliexpress: 'https://es.aliexpress.com/item/1005006.html',
} as const;
const BANNED = /segur|garant|verificad|empresa|fintech|banco|billetera|proteg/i;
const VOSEO = /\b(tenés|podés|querés|pegá|tocá|escribí|mirá|copiá|abrí)\b/i;

export async function run(t: T) {
  // --- detección: mismo providers.ts que Vender; solo se intenta leer donde funciona
  const d = (u: string) => detectProvider(u)!;
  t.check('detecta Facebook, Walmart, Mercado Libre, Amazon, Encuentra24 y AliExpress', Object.entries(LINKS).every(([id, u]) => d(u)?.id === id), JSON.stringify(Object.values(LINKS).map((u) => d(u)?.id)));
  t.check('se intenta leer Facebook, Walmart y tiendas genéricas', inviteCanRead(d(LINKS.facebook)) && inviteCanRead(d(LINKS.walmart)) && inviteCanRead(d('https://tienda.example.com/producto/1')));
  t.check('NO se pide Mercado Libre, Amazon, Encuentra24 ni AliExpress (bloquean nuestros servidores)', ['mercadolibre', 'amazon', 'encuentra24', 'aliexpress'].every((k) => !inviteCanRead(d((LINKS as any)[k]))));
  t.check('al pegar: "Anuncio de {proveedor}" sin error; solo promete leer donde funciona',
    inviteDetectedLabel(d(LINKS.mercadolibre)) === 'Anuncio de Mercado Libre: tú escribes el nombre y el precio.'
    && inviteDetectedLabel(d(LINKS.facebook)) === 'Anuncio de Facebook: llenamos el nombre, el precio y la foto.'
    && inviteDetectedLabel(d(LINKS.walmart)).startsWith('Anuncio de Walmart: llenamos')
    && inviteDetectedLabel(d('https://www.tienda.example.com/p/1')) === 'Anuncio de tienda.example.com'
    && !/llenamos|leemos|importamos/i.test(inviteDetectedLabel(d(LINKS.amazon))), inviteDetectedLabel(d(LINKS.mercadolibre)));

  // --- aviso después de pegar
  const ok: ListingImport = { result: 'success', provider: 'walmart', provider_name: 'Walmart', source_url: LINKS.walmart, title: 'Bici', price_crc: 185000, price_source: { amount: 185000, currency: 'CRC' }, converted: false, description: null, photos: ['data:image/jpeg;base64,AA'], missing: [] };
  const n1 = inviteImportNotice(d(LINKS.walmart), ok);
  t.check('leído: "Importado de Walmart" y ajustar el precio acordado', n1.title === 'Importado de Walmart' && /Ajusta el precio/.test(n1.body), JSON.stringify(n1));
  const n2 = inviteImportNotice(d(LINKS.mercadolibre), null);
  t.check('proveedor que no se lee: "Anuncio de Mercado Libre", sin error, el link va al vendedor', n2.title === 'Anuncio de Mercado Libre' && /vendedor verá el link/.test(n2.body) && !/No pudimos|error/i.test(n2.title + n2.body), JSON.stringify(n2));
  const n3 = inviteImportNotice(d(LINKS.facebook), { ...ok, provider: 'facebook', provider_name: 'Facebook', result: 'failed', title: null, price_crc: null, photos: [], missing: ['title', 'price', 'photos'] });
  t.check('Facebook privado o borrado: mismo aviso neutro (no bloquea la invitación)', n3.title === 'Anuncio de Facebook' && !/No pudimos/.test(n3.title), JSON.stringify(n3));
  const n4 = inviteImportNotice(d('https://tienda.example.us/p/1'), { ...ok, provider: 'web', provider_name: 'tienda.example.us', converted: true, price_source: { amount: 300, currency: 'USD' } });
  t.check('precio en otra moneda: se dice que es sugerido', /US\$300/.test(n4.body) && /confírmalo/.test(n4.body), n4.body);
  t.check('marketplaces de la hoja: Facebook, Mercado Libre, Amazon y más (iconos)', INVITE_MARKETS.length === 5 && inviteMarketsLabel === 'Facebook, Mercado Libre, Amazon y más');

  // --- la invitación acepta el link de cualquier marketplace (incluso los que no se leen) y rechaza lo que no es un link público
  const db = fakeDb(); __setDbForTests(db as any);
  const G = 'e'.repeat(64);
  const base = { op: 'create', title: 'Bicicleta aro 29', price_crc: 150000 };
  for (const [id, u] of Object.entries(LINKS)) {
    const r = await call(invites, { guest: G, body: { ...base, source_url: u } });
    const row = db.tables.invitations.find((i: any) => i.code === r.body?.code);
    t.check(`invitación con link de ${id}: se guarda normalizado`, r.code === 200 && row?.source_url === u, `${r.code} ${r.body?.error} ${row?.source_url}`);
  }
  let r = await call(invites, { guest: G, body: { ...base, source_url: 'Mira: articulo.mercadolibre.com.mx/MLM-1-bici-_JM' } });
  t.check('link pegado con texto alrededor y sin https://', r.code === 200 && db.tables.invitations.at(-1)?.source_url === 'https://articulo.mercadolibre.com.mx/MLM-1-bici-_JM', `${r.code}`);
  const before = db.tables.invitations.length;
  for (const bad of ['http://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.1/x', 'javascript:alert(1)', 'hola', 'https://user:pw@tienda.com/x', 'https://' + 'a'.repeat(1000) + '.com/']) {
    r = await call(invites, { guest: G, body: { ...base, source_url: bad } });
    t.check(`source_url inválido (${bad.slice(0, 30)}) -> 400 import_url_invalid`, r.code === 400 && r.body?.code === 'import_url_invalid', `${r.code} ${r.body?.code}`);
  }
  t.check('ninguna invitación creada con links inválidos', db.tables.invitations.length === before);

  // --- vista del vendedor y mensaje para Messenger/WhatsApp con el proveedor correcto
  t.check('nombre del proveedor para el vendedor', sourceName(LINKS.mercadolibre) === 'Mercado Libre' && sourceName(LINKS.amazon) === 'Amazon' && sourceName('https://www.tienda.example.com/p') === 'tienda.example.com' && sourceName(null) === null);
  const msg = inviteShareMessage({ title: 'Bicicleta aro 29', price_crc: 150000, source_url: LINKS.mercadolibre }, 'https://pago.meteorito.app/i/abcd1234');
  t.check('mensaje: "vi tu anuncio … en Mercado Libre"', msg.includes('vi tu anuncio de Bicicleta aro 29 en Mercado Libre') && !/Facebook/.test(msg), msg);
  t.check('mensaje con link de Facebook sigue diciendo Facebook Marketplace', inviteShareMessage({ title: 'X', price_crc: 5000, source_url: LINKS.facebook }, 'l').includes('en Facebook Marketplace'));

  // --- pantallas: usan import_listing (no import_facebook), copy en tuteo y sin palabras prohibidas, aviso de beta intacto
  const nueva = readFileSync('app/i/nueva.tsx', 'utf8'); const code = readFileSync('app/i/[code].tsx', 'utf8'); const comprar = readFileSync('app/(tabs)/comprar.tsx', 'utf8');
  t.check('el formulario importa con import_listing (proveedores) y no solo Facebook', /importFromLinkAsBuyer/.test(nueva) && !/checkFacebookUrl|importFromFacebookAsBuyer/.test(nueva));
  t.check('Comprar y el formulario dicen "Importar de un link"', /title="Importar de un link"/.test(comprar) && /Importar de un link/.test(nueva) && !/Importar de Facebook/.test(comprar + nueva));
  t.check('el vendedor ve "Ver anuncio en {proveedor}"', /Ver anuncio en \{where\}/.test(code) && !/Ver anuncio en Facebook/.test(code));
  const copy = [inviteDetectedLabel(d(LINKS.amazon)), inviteDetectedLabel(d(LINKS.facebook)), n1.body, n2.body, inviteMarketsLabel, msg,
    ...[...nueva.matchAll(/>([^<>{}]*[a-záéíóú][^<>{}]*)</g)].map((m) => m[1]), ...[...nueva.matchAll(/(?:title|placeholder|accessibilityLabel)="([^"]+)"/g)].map((m) => m[1])].join(' | ');
  t.check('copy nuevo sin palabras prohibidas', !BANNED.test(copy), copy.match(BANNED)?.[0]);
  t.check('copy nuevo en tuteo (sin voseo)', !VOSEO.test(copy), copy.match(VOSEO)?.[0]);
  t.check('sin emojis en el formulario', !/\p{Extended_Pictographic}/u.test(nueva));
}
