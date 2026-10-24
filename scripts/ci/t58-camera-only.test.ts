// (58) Fotos "solo cámara" (decisión de Rolando: la subida de fotos queda blindada):
//  - Prueba de envío OBLIGATORIA y solo con la cámara de la app; "Ya lo envié" deshabilitado sin foto.
//  - Producto nuevo (Vender e invitación del comprador) y disputa: solo cámara. Excepción: foto del anuncio de Facebook.
//  - Servidor: token de captura de un uso (propósito, pedido, dueño, 5 min). Sin token, vencido, reutilizado, de otro
//    propósito o de otra persona -> no hay firma de subida. Ship/create/invites/dispute solo aceptan fotos de esas carpetas.
//  - Evidencia del envío con {captured_at, token_id, purpose} dentro del hash.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { publicPrefix } from '../../api/_lib/photos';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __resetCaptureForTests, capturePath, captureUrl, readCaptureToken, signCaptureToken } from '../../api/_lib/capture';
import { evidenceHash, __setChainForTests } from '../../api/_lib/escrow';
import { __setFbFetchForTests } from '../../api/_lib/fbimport';
import { classifyCameraError, cameraHelp, crStamp, stampLines } from '../../lib/capture';

const ROOT = join(__dirname, '../..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const KEY = 'e'.repeat(64);
const GUEST = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
const call = async (h: any, o: { body?: any; guest?: string | null; tok?: string | null }) => {
  const r = res(); const rq: any = { method: 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: {} };
  await h(rq, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const warn = console.warn, errl = console.error; console.warn = () => {}; console.error = () => {};
  try {
    const up = (await import('../../api/photos/upload-url')).default;
    const seller = await token({ sub: 'seller-58' });
    const order = { id: '58585858-5858-4585-8585-585858585858', slug: 'cam058', status: 'fondeado', seller_user_id: 'seller-58', buyer_user_id: GUEST,
      seller_address: 'GSELLER', contract_id: 'CNOTUSED', amount_usdc: 1, sp_mode: 'seller' };
    const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...order }); __resetCaptureForTests();

    /* ---------- 1) Token de captura y firma de subida ---------- */
    let r = await call(up, { tok: seller, body: { action: 'capture_token', purpose: 'listing', ref: 'new' } });
    const lt = r.body;
    t.check('capture_token listing -> token firmado, código corto y vigencia de 5 min', r.code === 200 && typeof lt?.token === 'string' && /^P-[0-9A-F]{6}$/.test(lt.code) && Date.parse(lt.exp) - Date.parse(lt.now) === 5 * 60_000, `${r.code} ${JSON.stringify(r.body)}`);
    for (const purpose of ['listing', 'ship', 'dispute']) {
      r = await call(up, { tok: seller, guest: KEY, body: { purpose, mime: 'image/jpeg', size: 1000 } });
      t.check(`firma sin token para ${purpose} -> 401 capture_token_required`, r.code === 401 && r.body?.code === 'capture_token_required', `${r.code} ${r.body?.code}`);
    }
    r = await call(up, { tok: seller, body: { purpose: 'listing', capture_token: lt.token, mime: 'image/jpeg', size: 1000 } });
    const claims = readCaptureToken(lt.token)!;
    t.check('firma con token válido -> ruta propia del token (listing-<id>/0.jpg)', r.code === 200 && r.body?.path === `seller-58/listing-${claims.id}/0.jpg` && r.body?.publicUrl === captureUrl(claims), `${r.code} ${r.body?.path}`);
    r = await call(up, { tok: seller, body: { purpose: 'listing', capture_token: lt.token, mime: 'image/jpeg', size: 1000 } });
    t.check('mismo token otra vez -> 409 capture_token_used', r.code === 409 && r.body?.code === 'capture_token_used', `${r.code} ${r.body?.code}`);
    __resetCaptureForTests(); db.objects.add(capturePath(claims));
    r = await call(up, { tok: seller, body: { purpose: 'listing', capture_token: lt.token, mime: 'image/jpeg', size: 1000 } });
    t.check('token cuya foto ya está en Storage (otra instancia) -> 409 capture_token_used', r.code === 409 && r.body?.code === 'capture_token_used', `${r.code}`);
    const old = signCaptureToken({ p: 'listing', ref: 'new', sub: 'seller-58' }, Date.now() - 6 * 60_000).token;
    r = await call(up, { tok: seller, body: { purpose: 'listing', capture_token: old, mime: 'image/jpeg', size: 1000 } });
    t.check('token vencido (6 min) -> 410 capture_token_expired', r.code === 410 && r.body?.code === 'capture_token_expired', `${r.code} ${r.body?.code}`);
    const lt2 = (await call(up, { tok: seller, body: { action: 'capture_token', purpose: 'listing', ref: 'new' } })).body.token;
    r = await call(up, { tok: seller, body: { purpose: 'ship', capture_token: lt2, mime: 'image/jpeg', size: 1000 } });
    t.check('token de listing usado para ship -> 403 capture_wrong_purpose', r.code === 403 && r.body?.code === 'capture_wrong_purpose', `${r.code} ${r.body?.code}`);
    r = await call(up, { tok: await token({ sub: 'otro-58' }), body: { purpose: 'listing', capture_token: lt2, mime: 'image/jpeg', size: 1000 } });
    t.check('token de otra persona -> 403', r.code === 403 && r.body?.code === 'capture_wrong_owner', `${r.code} ${r.body?.code}`);
    r = await call(up, { tok: seller, body: { purpose: 'listing', capture_token: lt2.slice(0, -3) + 'AAA', mime: 'image/jpeg', size: 1000 } });
    t.check('token alterado -> 403 capture_token_invalid', r.code === 403 && r.body?.code === 'capture_token_invalid', `${r.code}`);
    r = await call(up, { guest: KEY, body: { as: 'guest', draftId: '55555555-5555-4555-8555-555555555555', index: 0, mime: 'image/jpeg', size: 1000 } });
    t.check('invitado por la vía vieja (sin cámara) -> 403 camera_required', r.code === 403 && r.body?.code === 'camera_required', `${r.code} ${r.body?.code}`);
    r = await call(up, { tok: await token({ sub: 'otro-58' }), body: { action: 'capture_token', purpose: 'ship', ref: 'cam058' } });
    t.check('token de envío solo para el vendedor del pedido', r.code === 403, `${r.code}`);
    db.tables.orders[0].delivery_mode = 'cara_a_cara';
    r = await call(up, { tok: seller, body: { action: 'capture_token', purpose: 'ship', ref: 'cam058' } });
    t.check('cara a cara: no hay token de envío (409 face_to_face)', r.code === 409 && r.body?.code === 'face_to_face', `${r.code} ${r.body?.code}`);
    delete db.tables.orders[0].delivery_mode;

    /* ---------- 2) "Ya lo envié": foto obligatoria de la cámara ---------- */
    const ship = (await import('../../api/escrow/ship')).default;
    __setChainForTests({ changeMilestoneStatusXdr: async (_c: string, _a: string, _s: string, ev: string) => ({ unsignedTransaction: 'XDR:' + ev }) as any });
    r = await call(ship, { tok: seller, body: { slug: 'cam058' } });
    t.check('ship sin foto -> 400 ship_photo_required y no cambia nada', r.code === 400 && r.body?.code === 'ship_photo_required' && !db.tables.orders[0].ship_evidence, `${r.code} ${r.body?.code}`);
    r = await call(ship, { tok: seller, body: { slug: 'cam058', evidence: { photo: publicPrefix('seller-58') + '0b6f1f0a-1111-4222-8333-444455556666/0.jpg' } } });
    t.check('ship con foto vieja (carrete, sin token) -> 400', r.code === 400 && r.body?.code === 'ship_photo_required', `${r.code} ${r.body?.code}`);
    const st = (await call(up, { tok: seller, body: { action: 'capture_token', purpose: 'ship', ref: 'cam058' } })).body;
    const sc = readCaptureToken(st.token)!;
    const ev = { photo: captureUrl(sc), capture_token: st.token, captured_at: new Date().toISOString(), note: 'CR123' };
    r = await call(ship, { tok: seller, body: { slug: 'cam058', evidence: ev } });
    t.check('token válido pero la foto no se subió -> 400 ship_photo_missing', r.code === 400 && r.body?.code === 'ship_photo_missing', `${r.code} ${r.body?.code}`);
    db.objects.add(capturePath(sc));
    r = await call(ship, { tok: seller, body: { slug: 'cam058', evidence: { ...ev, captured_at: new Date(Date.now() + 3600_000).toISOString() } } });
    t.check('captured_at fuera de la vigencia del token -> 400 capture_time_invalid', r.code === 400 && r.body?.code === 'capture_time_invalid', `${r.code} ${r.body?.code}`);
    r = await call(ship, { tok: seller, body: { slug: 'cam058', evidence: ev } });
    const o = db.tables.orders[0];
    t.check('ship con foto de la cámara -> 200, evidencia {captured_at, token_id, purpose} hasheada', r.code === 200 && o.ship_evidence?.photo === ev.photo && o.ship_evidence?.token_id === sc.id
      && o.ship_evidence?.purpose === 'ship' && o.ship_evidence?.captured_at === ev.captured_at && o.ship_evidence?.note === 'CR123' && o.ship_evidence_hash === evidenceHash(o.ship_evidence) && r.body?.unsignedXdr === 'XDR:' + o.ship_evidence_hash, `${r.code} ${r.body?.error} ${JSON.stringify(o.ship_evidence)}`);
    const other = signCaptureToken({ p: 'ship', ref: 'otro01', sub: 'seller-58' });
    db.objects.add(capturePath(other.claims));
    db.tables.orders[0] = { ...order };
    r = await call(ship, { tok: seller, body: { slug: 'cam058', evidence: { photo: captureUrl(other.claims), capture_token: other.token, captured_at: new Date().toISOString() } } });
    t.check('foto de envío de OTRO pedido -> 400 capture_wrong_ref', r.code === 400 && r.body?.code === 'capture_wrong_ref', `${r.code} ${r.body?.code}`);

    /* ---------- 3) Producto nuevo e invitación: cámara o Facebook ---------- */
    const { listingPhotoOk } = await import('../../api/_lib/capture');
    t.check('producto: foto vieja (draftId) -> no aceptada', !listingPhotoOk(publicPrefix('seller-58') + '44444444-4444-4444-8444-444444444444/0.jpg', 'seller-58'));
    t.check('producto: foto de la cámara (listing-) y de Facebook (fb-) -> aceptadas; de envío (ship-) no',
      listingPhotoOk(captureUrl(claims), 'seller-58') && listingPhotoOk(publicPrefix('seller-58') + 'fb-44444444-4444-4444-8444-444444444444/0.jpg', 'seller-58') && !listingPhotoOk(captureUrl(sc), 'seller-58'));
    const invites = (await import('../../api/invites/index')).default;
    r = await call(invites, { guest: KEY, body: { op: 'create', title: 'Bici de montaña', price_crc: 50000, photos: [publicPrefix(GUEST) + '55555555-5555-4555-8555-555555555555/0.jpg'] } });
    t.check('invitación con foto del carrete (vía vieja) -> 400 camera_required', r.code === 400 && r.body?.code === 'camera_required', `${r.code} ${r.body?.code}`);
    const gt = (await call(up, { guest: KEY, body: { action: 'capture_token', purpose: 'listing', ref: 'new', as: 'guest' } })).body.token;
    r = await call(invites, { guest: KEY, body: { op: 'create', title: 'Bici de montaña', price_crc: 50000, photos: [captureUrl(readCaptureToken(gt)!)] } });
    t.check('invitación con foto de la cámara del invitado -> 200', r.code === 200, `${r.code} ${r.body?.error}`);

    /* ---------- 4) Import de Facebook: sigue usando la foto del anuncio (guardada por el servidor) ---------- */
    const store = (await import('../../api/store/index')).default;
    __setFbFetchForTests(async (url) => url.includes('fbcdn.net')
      ? new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      : new Response(readFileSync(new URL('./fixtures/facebook/og-crc-mobile.html', import.meta.url), 'utf8'), { status: 200, headers: { 'content-type': 'text/html' } }));
    r = await call(store, { tok: seller, body: { action: 'import_facebook', url: 'https://www.facebook.com/marketplace/item/443277198670299/' } });
    const fbUrl = r.body?.photo_urls?.[0];
    t.check('import FB: foto como data URL + copia guardada por el servidor (fb-<uuid>) aceptada en el producto', r.code === 200 && /^data:image\/jpeg/.test(r.body?.photos?.[0] ?? '') && listingPhotoOk(fbUrl, 'seller-58') && [...db.objects].some((p) => fbUrl?.endsWith(p.slice(p.indexOf('/') + 1))), `${r.code} ${fbUrl}`);
    __setFbFetchForTests(null);

    /* ---------- 5) Disputa: solo fotos de la cámara de ESTE pedido ---------- */
    const dispute = (await import('../../api/escrow/dispute')).default;
    __setChainForTests({ releaseGuard: async () => ({ disputed: false, released: false }) as any } as any);
    db.tables.orders[0] = { ...order };
    r = await call(dispute, { guest: KEY, body: { slug: 'cam058', reason: 'no_llego', evidence: [publicPrefix(GUEST) + '55555555-5555-4555-8555-555555555555/0.jpg'] } });
    t.check('disputa con foto sin token (carrete) -> 400 camera_required', r.code === 400 && r.body?.code === 'camera_required', `${r.code} ${r.body?.code}`);
    const dt = (await call(up, { guest: KEY, body: { action: 'capture_token', purpose: 'dispute', ref: 'cam058' } })).body;
    t.check('comprador invitado obtiene token de disputa de su pedido', !!dt?.token && dt.code === 'CAM058', JSON.stringify(dt));
    r = await call(up, { guest: 'f'.repeat(64), body: { action: 'capture_token', purpose: 'dispute', ref: 'cam058' } });
    t.check('otro navegador no obtiene token de disputa -> 403', r.code === 403, `${r.code}`);
    r = await call(dispute, { guest: KEY, body: { slug: 'cam058', reason: 'no_llego', evidence: [captureUrl(readCaptureToken(lt2)!)], captures: [lt2] } });
    t.check('disputa con token de otro propósito -> 400', r.code === 400 && r.body?.code === 'capture_wrong_purpose', `${r.code} ${r.body?.code}`);

    /* ---------- 6) Cliente: sin carrete ni input de archivo; "Ya lo envié" bloqueado sin foto ---------- */
    for (const f of ['components/SellerActions.tsx', 'components/DisputeSheet.tsx', 'app/(tabs)/vender.tsx', 'app/i/nueva.tsx', 'components/CameraCapture.tsx']) {
      const s = src(f);
      t.check(`${f}: sin galería ni input de archivo`, !/ImagePicker|launchImageLibrary|launchCamera|type=["']file|'file'|capture=|<input/.test(s), f);
    }
    const cam = src('components/CameraCapture.tsx');
    t.check('CameraCapture: getUserMedia con cámara trasera + token de captura + marca de fecha', /getUserMedia/.test(cam) && /facingMode: \{ ideal: 'environment' \}/.test(cam) && /requestCaptureToken/.test(cam) && /drawStamp/.test(cam) && /canvasToJpeg/.test(cam));
    t.check('CameraCapture: estados sin cámara (denegado/ocupada) y cámara simulada solo en demo', /camera-denied/.test(cam) && /DEMO_ENABLED/.test(cam) && /classifyCameraError/.test(cam));
    t.check('PostHog: camera_opened / camera_captured / camera_denied con etapa, sin la imagen',
      ['camera_opened', 'camera_captured', 'camera_denied'].every((e) => new RegExp(`track\\('${e}', \\{ stage: purpose`).test(cam)) && ![...cam.matchAll(/track\('camera_[a-z]+', \{([^}]*)\}/g)].some((m) => /blob|uri|url|shot|dataUrl/i.test(m[1].replace(/kb: Math.round\(blob.size \/ 1024\)/, ''))));
    const sa = src('components/SellerActions.tsx');
    t.check('"Ya lo envié" deshabilitado sin la foto de la cámara', /title="Ya lo envié"[^>]*disabled=\{!canShip\(photo\)\}/.test(sa) && /CameraCapture visible=\{camOpen\} purpose="ship"/.test(sa) && !/opcional\)'?\}?<\/Text>\s*<\/Pressable>\s*<\/View>/.test(sa) && !/Foto del paquete o comprobante \(opcional\)/.test(sa));
    t.check('cara a cara: SellerActions sin paso de envío ni cámara', /status === 'fondeado' && faceToFace/.test(sa));
    t.check('Vender e invitación: el import de Facebook usa photo_urls del servidor', /photo_urls/.test(src('app/(tabs)/vender.tsx')) && /photo_urls/.test(src('app/i/nueva.tsx')));

    /* ---------- 7) Marca en la foto y textos del permiso ---------- */
    t.check('crStamp: hora de Costa Rica (UTC-6)', crStamp(Date.parse('2026-10-24T06:15:07Z')) === '24/10/2026 00:15:07', crStamp(Date.parse('2026-10-24T06:15:07Z')));
    t.check('marca: fecha CR + código del pedido', stampLines(Date.parse('2026-10-24T18:00:00Z'), 'CAM058').join(' | ') === '24/10/2026 12:00:00 CR | Meteorito · CAM058');
    t.check('errores de cámara: denegado / ocupada / sin cámara', classifyCameraError({ name: 'NotAllowedError' }) === 'denied' && classifyCameraError({ name: 'NotReadableError' }) === 'busy' && classifyCameraError({ name: 'NotFoundError' }) === 'nocamera');
    const d1 = cameraHelp('denied', { ios: true, standalone: false }), d2 = cameraHelp('denied', { ios: true, standalone: true });
    t.check('permiso denegado: "Necesitamos tu cámara para tomar la foto" + cómo activarla en Safari y en la app de inicio',
      d1.title === 'Necesitamos tu cámara para tomar la foto' && /Safari/.test(d1.body) && /aA/.test(d1.body) && /Ajustes/.test(d2.body));
  } finally { console.warn = warn; console.error = errl; __setChainForTests(null); }
}
