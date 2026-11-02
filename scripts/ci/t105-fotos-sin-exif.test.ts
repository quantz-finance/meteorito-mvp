// (105) Fotos sin metadatos (EXIF con GPS, XMP, IPTC, comentarios) del lado del servidor.
//  - stripMeta: JPEG/PNG/WebP con GPS (fixtures en fixtures/photos, generados con Pillow) -> sin GPS ni EXIF/XMP/comentario,
//    los segmentos de imagen idénticos (no recodifica) y la orientación se conserva en un EXIF mínimo de solo Orientation.
//  - storeImportedPhotos (import de anuncios): lo que se sube a Storage ya va limpio.
//  - scrubStoredPhotos (subidas firmadas desde el teléfono): descarga, limpia y sobrescribe (upsert) el mismo objeto;
//    ignora URLs ajenas, no reescribe si ya estaba limpio y nunca lanza si Storage falla.
//  - Las rutas que usan fotos de la cámara (envío, disputa, respuesta, publicar, invitación, foto de la tienda) lo llaman.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { detectImage, exifOrientation, stripImageMetadata } from '../../api/_lib/stripMeta';
import { storeImportedPhotos } from '../../api/_lib/capture';
import { bucketPath, scrubStoredPhotos } from '../../api/_lib/scrubPhotos';
import { publicPrefix } from '../../api/_lib/photos';

const fx = (f: string) => new Uint8Array(readFileSync(new URL(`./fixtures/photos/${f}`, import.meta.url)));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
/** Segmentos de un JPEG: [marcador, datos]. */
function jpegSegs(b: Uint8Array) {
  const out: [number, Uint8Array][] = []; let p = 2;
  while (p < b.length) {
    const m = b[p + 1]; if (m === 0xd9) break;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m === 0xda) { out.push([m, b.subarray(p)]); break; }
    out.push([m, b.subarray(p + 4, p + 2 + len)]); p += 2 + len;
  }
  return out;
}
/** Tags del IFD0 de un APP1 EXIF (big o little endian). */
function ifd0Tags(app1: Uint8Array): number[] {
  const t = app1.subarray(6); const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24) : (t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]);
  const ifd = u32(4); const n = u16(ifd);
  return Array.from({ length: n }, (_, i) => u16(ifd + 2 + i * 12));
}

export async function run(t: T) {
  // --- JPEG con GPS, XMP con GPS, comentario y Orientation=6 ---
  const jpg = fx('gps-exif.jpg');
  const before = jpegSegs(jpg);
  const exifIn = before.find(([m, d]) => m === 0xe1 && Buffer.from(d.subarray(0, 4)).toString('latin1') === 'Exif');
  t.check('fixture JPEG trae EXIF con GPS (0x8825), XMP y comentario', !!exifIn && ifd0Tags(exifIn[1]).includes(0x8825) && has(jpg, 'GPSLatitude') && has(jpg, 'secret comment'));
  const r = stripImageMetadata(jpg);
  const after = jpegSegs(r.bytes);
  t.check('JPEG: changed y detectado', r.changed && r.format === 'jpeg' && detectImage(r.bytes) === 'jpeg', JSON.stringify(r.removed));
  const app1s = after.filter(([m]) => m === 0xe1);
  t.check('JPEG: sin bloque GPS (0x8825) ni otras etiquetas EXIF', app1s.length === 1 && JSON.stringify(ifd0Tags(app1s[0][1])) === JSON.stringify([0x0112]), app1s.map(([, d]) => ifd0Tags(d).join(',')).join(' | '));
  t.check('JPEG: orientación conservada (6)', exifOrientation(app1s[0][1]) === 6);
  t.check('JPEG: sin XMP, comentario, marca ni modelo', !has(r.bytes, 'GPSLatitude') && !has(r.bytes, 'xmpmeta') && !has(r.bytes, 'secret comment') && !has(r.bytes, 'FakeCam') && !has(r.bytes, 'GPS-1') && !after.some(([m]) => m === 0xfe || m === 0xed));
  const imgSegs = (s: [number, Uint8Array][]) => s.filter(([m]) => !(m >= 0xe1 && m <= 0xef) && m !== 0xfe).map(([m, d]) => m + ':' + Buffer.from(d).toString('hex')).join('|');
  t.check('JPEG: tablas, SOF y datos de imagen idénticos (no recodifica)', imgSegs(before) === imgSegs(after));
  t.check('JPEG: termina en EOI', r.bytes[r.bytes.length - 2] === 0xff && r.bytes[r.bytes.length - 1] === 0xd9);
  const again = stripImageMetadata(r.bytes);
  t.check('JPEG: idempotente (ya limpio -> sin cambios)', !again.changed && again.bytes.length === r.bytes.length);
  // --- PNG y WebP ---
  const png = fx('gps-exif.png'); const rp = stripImageMetadata(png);
  t.check('PNG: quita eXIf/tEXt/iTXt (GPS/XMP)', has(png, 'eXIf') && rp.changed && !has(rp.bytes, 'eXIf') && !has(rp.bytes, 'tEXt') && !has(rp.bytes, 'iTXt') && !has(rp.bytes, 'lat 9.93') && has(rp.bytes, 'IDAT') && has(rp.bytes, 'IEND'), JSON.stringify(rp.removed));
  const webp = fx('gps-exif.webp'); const rw = stripImageMetadata(webp);
  const riff = rw.bytes[4] | (rw.bytes[5] << 8) | (rw.bytes[6] << 16) | (rw.bytes[7] << 24);
  t.check('WebP: quita EXIF/XMP, ajusta tamaño RIFF y banderas VP8X', has(webp, 'EXIF') && rw.changed && !has(rw.bytes, 'EXIF') && !has(rw.bytes, 'XMP ') && riff === rw.bytes.length - 8 && (Buffer.from(rw.bytes.subarray(12, 16)).toString() !== 'VP8X' || (rw.bytes[20] & 0x0c) === 0), JSON.stringify(rw.removed));
  const junk = new TextEncoder().encode('no soy una imagen');
  t.check('formato desconocido / dañado: se devuelve igual', !stripImageMetadata(junk).changed && !stripImageMetadata(jpg.subarray(0, 40)).changed);

  // --- Import: lo que llega a Storage ya va limpio ---
  const uploaded: { path: string; body: Uint8Array; opts: any }[] = [];
  const storage = (objects: Map<string, Uint8Array>, fail = false) => ({ from: (_b: string) => ({
    upload: async (path: string, body: Uint8Array, opts: any) => { if (fail) throw new Error('boom'); uploaded.push({ path, body: new Uint8Array(body), opts }); objects.set(path, new Uint8Array(body)); return { data: { path }, error: null }; },
    download: async (path: string) => { if (fail) return { data: null, error: { message: 'boom' } }; const b = objects.get(path); return b ? { data: new Blob([Buffer.from(b)]), error: null } : { data: null, error: { message: 'not found' } }; },
  }) });
  const objs = new Map<string, Uint8Array>();
  const urls = await storeImportedPhotos(storage(objs), [`data:image/jpeg;base64,${Buffer.from(jpg).toString('base64')}`], 'seller_1', 1_048_576, 'https://www.facebook.com/marketplace/item/123456789/');
  t.check('import: guarda la foto', typeof urls[0] === 'string' && uploaded.length === 1, JSON.stringify(urls));
  t.check('import: bytes subidos sin GPS/XMP/comentario', uploaded.length === 1 && !has(uploaded[0].body, 'GPSLatitude') && !has(uploaded[0].body, 'secret comment') && !jpegSegs(uploaded[0].body).some(([m, d]) => m === 0xe1 && ifd0Tags(d).includes(0x8825)) && uploaded[0].opts?.upsert === false);

  // --- Subidas firmadas: scrub posterior ---
  const pre = publicPrefix('seller_1');
  const camUrl = `${pre}listing-3f2b1c4d-1111-2222-3333-444455556666/0.jpg`;
  t.check('bucketPath: URL nuestra -> ruta; ajena / traversal -> null', bucketPath(camUrl) === 'seller_1/listing-3f2b1c4d-1111-2222-3333-444455556666/0.jpg' && bucketPath('https://evil.example/x/y/0.jpg') === null && bucketPath(`${pre}../otro/0.jpg`) === null);
  const objs2 = new Map<string, Uint8Array>([[bucketPath(camUrl)!, jpg]]);
  uploaded.length = 0;
  const res = await scrubStoredPhotos(storage(objs2), [camUrl, camUrl, 'https://evil.example/a/b/0.jpg']);
  t.check('scrub: sobrescribe el objeto limpio con upsert (una vez por URL)', res[bucketPath(camUrl)!] === 'stripped' && uploaded.length === 1 && uploaded[0].opts?.upsert === true && uploaded[0].opts?.contentType === 'image/jpeg', JSON.stringify(res));
  const stored = objs2.get(bucketPath(camUrl)!)!;
  t.check('scrub: el objeto en Storage ya no tiene GPS', !has(stored, 'GPSLatitude') && !jpegSegs(stored).some(([m, d]) => m === 0xe1 && ifd0Tags(d).includes(0x8825)));
  uploaded.length = 0;
  const res2 = await scrubStoredPhotos(storage(objs2), [camUrl]);
  t.check('scrub: ya limpio -> no reescribe', res2[bucketPath(camUrl)!] === 'clean' && uploaded.length === 0);
  let threw = false;
  try { await scrubStoredPhotos(storage(objs2, true), [camUrl]); await scrubStoredPhotos(undefined, [camUrl]); await scrubStoredPhotos({ from: () => ({}) }, [camUrl]); } catch { threw = true; }
  t.check('scrub: Storage falla / sin download -> no lanza', !threw);

  // --- Los handlers que usan fotos de la cámara llaman al scrub ---
  const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  for (const f of ['api/escrow/ship.ts', 'api/escrow/dispute.ts', 'api/_lib/disputeAdmin.ts', 'api/orders/create.ts', 'api/invites/index.ts', 'api/store/index.ts'])
    t.check(`${f} limpia metadatos de las fotos subidas`, /await scrubStoredPhotos\(db\(\)\.storage, /.test(src(f)));
  t.check('capture.ts limpia las fotos importadas antes de subir', /stripImageMetadata\(raw\)/.test(src('api/_lib/capture.ts')));
}
