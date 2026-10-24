// (49) Comprar → Invitar a un vendedor desde un anuncio de Facebook: el comprador INVITADO (sin cuenta) pega el link de
// Marketplace, se reutiliza import_facebook (con límite por llave y por IP), la invitación guarda el link original
// (migración 015, con caída limpia si no está aplicada) y la foto importada sirve para que el vendedor publique. Sin red.
import { Keypair } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { publicPrefix } from '../../api/_lib/photos';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import { __setFbFetchForTests, clientIp } from '../../api/_lib/fbimport';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import invites from '../../api/invites/index';
import create from '../../api/orders/create';
import { inviteShareMessage, showCategoryChip } from '../../lib/inviteShare';

const fx = (f: string) => readFileSync(new URL(`./fixtures/facebook/${f}`, import.meta.url), 'utf8');
const ITEM = 'https://www.facebook.com/marketplace/item/443277198670299/';
const key = (c: string) => c.repeat(64);
const call = async (h: any, o: { method?: string; body?: any; query?: any; guest?: string | null; tok?: string | null; ip?: string }) => {
  const r = res(); const rq: any = { method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.ip ? { 'x-forwarded-for': `${o.ip}, 10.0.0.1` } : {}) }, body: o.body ?? {}, query: o.query ?? {} };
  await h(rq, r); return r;
};
const signProof = (kp: Keypair, action: string, ref: string) => {
  const ts = Math.floor(Date.now() / 1000); const message = proofMessage(action, ref, kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};

export async function run(t: T) {
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }));
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  const seen: string[] = [];
  __setFbFetchForTests(async (url) => {
    seen.push(url);
    if (url.includes('fbcdn.net')) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response(fx('og-crc-mobile.html'), { status: 200, headers: { 'content-type': 'text/html' } });
  });
  try {
    // --- import_facebook sin cuenta (llave de invitado)
    let r = await call(store, { body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.1' });
    t.check('import_facebook sin sesión ni llave de invitado -> 401', r.code === 401, `${r.code}`);
    r = await call(store, { guest: key('1'), body: { action: 'import_facebook', url: 'https://evil.com/?u=facebook.com' }, ip: '203.0.113.1' });
    t.check('comprador invitado: link ajeno -> 400 fb_url_invalid y no se pide nada', r.code === 400 && r.body?.code === 'fb_url_invalid' && seen.length === 0, `${r.code} ${r.body?.code}`);
    r = await call(store, { guest: key('1'), body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.1' });
    t.check('comprador invitado importa el anuncio (título, precio, foto) sin crear nada', r.code === 200 && r.body?.result === 'success' && r.body?.price_crc === 18000 && /^data:image\/jpeg;base64,/.test(r.body?.photos?.[0] ?? '') && db.tables.orders.length === 0 && db.tables.invitations.length === 0, `${r.code} ${r.body?.error ?? r.body?.result}`);
    r = await call(store, { guest: key('1'), tok: 'basura', body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.1' });
    t.check('token Cavos malo + llave de invitado: se usa la llave (como el resto de acciones del comprador)', r.code === 200, `${r.code} ${r.body?.error}`);

    // --- límites: 8/min por llave y 12/min por IP (las llaves de invitado son gratis: el límite por IP es el que cuenta)
    for (let i = 0; i < 6; i++) await call(store, { guest: key('2'), body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.2' });
    r = await call(store, { guest: key('2'), body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.3' });
    t.check('misma llave, 7.ª/8.ª importación dentro del minuto -> todavía permitida', r.code === 200, `${r.code}`);
    r = await call(store, { guest: key('2'), body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.3' });
    t.check('8.ª importación permitida', r.code === 200, `${r.code}`);
    r = await call(store, { guest: key('2'), body: { action: 'import_facebook', url: ITEM }, ip: '203.0.113.4' });
    t.check('9.ª importación con la misma llave (aunque cambie la IP) -> 429 fb_rate_limited', r.code === 429 && r.body?.code === 'fb_rate_limited', `${r.code}`);
    const ip = '198.51.100.7'; let last = 0;
    for (let i = 0; i < 13; i++) last = (await call(store, { guest: 'c'.repeat(62) + i.toString(16).padStart(2, '0'), body: { action: 'import_facebook', url: ITEM }, ip })).code;
    t.check('llaves nuevas desde la misma IP: la 13.ª -> 429 (no se puede esquivar el límite generando llaves)', last === 429, `${last}`);
    r = await call(store, { guest: key('d'), body: { action: 'import_facebook', url: ITEM }, ip: '198.51.100.8' });
    t.check('otra IP no queda bloqueada por esa', r.code === 200, `${r.code}`);
    t.check('IP del cliente: primer valor de x-forwarded-for (x-vercel-forwarded-for tiene prioridad)', clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }) === '1.2.3.4'
      && clientIp({ headers: { 'x-vercel-forwarded-for': '5.6.7.8', 'x-forwarded-for': '1.2.3.4' } }) === '5.6.7.8' && clientIp({ headers: {} }) === null);
    r = await call(store, { tok: await token({ sub: 'seller-fb-49' }), body: { action: 'import_facebook', url: ITEM }, ip });
    t.check('el vendedor con sesión sigue importando como antes (no le aplica el límite por IP de invitados)', r.code === 200 && r.body?.result === 'success', `${r.code} ${r.body?.error}`);
    t.check('nunca se pidió nada fuera de facebook.com / CDN de FB', seen.every((u) => /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|fbcdn\.net)\//.test(u)));
  } finally { __setFbFetchForTests(null); }

  // --- la invitación guarda el link original del anuncio
  const KEY_A = key('a'); const buyer = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  const buyerPhoto = publicPrefix(buyer) + 'listing-55555555-5555-4555-8555-555555555555/0.jpg';
  const base = { op: 'create', title: 'Grutov 800 piezas Clips de retención', price_crc: 18000, photos: [buyerPhoto] };
  let r = await call(invites, { guest: KEY_A, body: { ...base, source_url: 'https://evil.com/marketplace/item/1/' } });
  t.check('source_url que no es de Facebook Marketplace -> 400', r.code === 400 && db.tables.invitations.length === 0, `${r.code}`);
  r = await call(invites, { guest: KEY_A, body: { ...base, source_url: `Mira esto ${ITEM.replace('https://', '')}` } });
  const code = r.body?.code as string;
  const row = db.tables.invitations.find((i: any) => i.code === code);
  t.check('crea la invitación con foto y link de FB normalizado (https://…)', r.code === 200 && row?.source_url === 'https://www.facebook.com/marketplace/item/443277198670299/' && row?.photos?.[0] === buyerPhoto, `${r.code} ${r.body?.error} ${row?.source_url}`);
  r = await call(invites, { method: 'GET', query: { code } });
  t.check('vista pública: título, precio, foto y link del anuncio (sin datos del comprador)', r.body?.title === base.title && r.body?.price_crc === 18000 && r.body?.photos?.[0] === buyerPhoto && r.body?.source_url === row.source_url && !JSON.stringify(r.body).includes('guest:'), JSON.stringify(r.body));
  r = await call(invites, { guest: KEY_A, body: { op: 'create', title: 'Silla', price_crc: 5000 } });
  t.check('sin link de FB sigue igual (source_url null)', r.code === 200 && (await call(invites, { method: 'GET', query: { code: r.body.code } })).body?.source_url === null);

  // Migración 015 sin aplicar: PostgREST no conoce la columna -> se crea igual, sin el link.
  const legacy = fakeDb(); const from0 = legacy.from;
  (legacy as any).from = (tb: string) => { const q = from0(tb); if (tb !== 'invitations') return q; const ins = q.insert; q.insert = (p: any) => (p && 'source_url' in p ? { then: (ok: any) => Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'source_url' column of 'invitations' in the schema cache" } }).then(ok) } : ins(p)); return q; };
  __setDbForTests(legacy as any);
  r = await call(invites, { guest: KEY_A, body: { ...base, source_url: ITEM } });
  t.check('sin migración 015: la invitación se crea igual (sin guardar el link)', r.code === 200 && legacy.tables.invitations.length === 1 && !('source_url' in legacy.tables.invitations[0]) && legacy.tables.invitations[0].photos?.length === 1, `${r.code} ${r.body?.error}`);
  __setDbForTests(db as any);
  const mig = readFileSync('supabase/migrations/015_invite_source_url.sql', 'utf8');
  t.check('migración 015: columna source_url en invitations, opcional y acotada', /alter table\s+(public\.)?invitations[^;]*add column if not exists source_url text/i.test(mig) && /check\s*\(/i.test(mig));

  // --- el vendedor publica usando la foto que importó el comprador (no tiene que volver a subirla)
  const seller = Keypair.random(); const tok = await token({ sub: 'seller49' });
  const body = (photos: string[]) => ({ proof: signProof(seller, 'create', 'new'), title: base.title, price_crc: 18000, photos, invite: code });
  r = await call(create, { tok, body: { ...body([publicPrefix(buyer) + 'otra/9.jpg']), invite: undefined } });
  t.check('fotos de la carpeta del comprador SIN invitación -> 400 (solo las propias)', r.code === 400 && db.tables.orders.length === 0, `${r.code}`);
  r = await call(create, { tok, body: body([publicPrefix(buyer) + 'otra/9.jpg']) });
  t.check('foto del comprador que no está en la invitación -> 400', r.code === 400 && db.tables.orders.length === 0, `${r.code}`);
  r = await call(create, { tok, body: body([buyerPhoto, publicPrefix('seller49') + 'listing-66666666-6666-4666-8666-666666666666/0.jpg']) });
  t.check('vendedor publica con la foto de la invitación (+ una propia) y la acepta', r.code === 200 && db.tables.orders[0]?.photos?.[0] === buyerPhoto && db.tables.invitations.find((i: any) => i.code === code)?.status === 'aceptada', `${r.code} ${r.body?.error}`);

  // --- mensaje para Messenger (tuteo, con el link y el precio)
  const msg = inviteShareMessage({ title: 'Bicicleta aro 29', price_crc: 185000, source_url: ITEM }, 'https://pago.meteorito.app/i/abcd1234');
  t.check('mensaje: menciona el anuncio de Facebook, el producto, el precio y el link', /Facebook/.test(msg) && msg.includes('Bicicleta aro 29') && msg.includes('₡185 000') && msg.endsWith('https://pago.meteorito.app/i/abcd1234'), msg);
  t.check('mensaje: explica la custodia en tuteo, sin voseo ni promesas prohibidas', /custodia/.test(msg) && !/(pod|ten|quer)és|tocá|aceptá|mirá|vos\b/i.test(msg) && !/segur|garant|protegid/i.test(msg), msg);
  const plain = inviteShareMessage({ title: 'Silla', price_crc: 5000, source_url: null }, 'https://pago.meteorito.app/i/x');
  t.check('sin link de FB: no menciona Facebook', !/Facebook/.test(plain) && plain.includes('Silla') && plain.includes('₡5 000'), plain);

  // --- vista del vendedor: el chip de categoría solo si dice algo
  t.check('chip de categoría oculto para "otro" / vacío; visible para una categoría real', !showCategoryChip('otro') && !showCategoryChip('Otro') && !showCategoryChip('') && !showCategoryChip(null) && showCategoryChip('celular'));
}
