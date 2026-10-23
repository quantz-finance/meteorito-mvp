// (43) photo_upload_failed con etapa/código (antes solo {context, index}: no se distinguía sesión vencida de HEIC o Storage). Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { photoFailureProps, tagPhotoError } from '../../lib/photoError';

export async function run(t: T) {
  const sess = tagPhotoError('sign', Object.assign(new Error('Tu sesión venció. Vuelve a iniciar sesión…'), { status: 401, code: 'session_relogin_required' }));
  t.check('sesión vencida al pedir la URL firmada -> stage sign + código + 401', JSON.stringify(photoFailureProps(sess)) === JSON.stringify({ stage: 'sign', code: 'session_relogin_required', http_status: 401, mime: null }));
  const heic = Object.assign(tagPhotoError('compress', new TypeError('decode failed')), { photoMime: 'image/heic' });
  const ph = photoFailureProps(heic);
  t.check('falla al comprimir (HEIC) -> stage compress, mime', ph.stage === 'compress' && ph.mime === 'image/heic' && ph.code === 'TypeError');
  const st = Object.assign(tagPhotoError('storage', new Error('x')), { code: 'storage_413', status: 413 });
  t.check('Storage rechaza (tamaño) -> stage storage, 413', photoFailureProps(st).stage === 'storage' && photoFailureProps(st).http_status === 413);
  t.check('la primera etapa se conserva', photoFailureProps(tagPhotoError('storage', tagPhotoError('sign', new Error('a')))).stage === 'sign');
  t.check('nunca manda el mensaje crudo', !JSON.stringify(photoFailureProps(sess)).includes('venció'));
  t.check('no-Error y null no rompen', photoFailureProps(null).stage === 'unknown' && photoFailureProps('x').code === 'unknown');
  const v = readFileSync(new URL('../../app/(tabs)/vender.tsx', import.meta.url), 'utf8');
  t.check('vender.tsx manda etapa y código en photo_upload_failed', /track\('photo_upload_failed', \{[^}]*\.\.\.photoFailureProps\(e\)/.test(v));
  const p = readFileSync(new URL('../../lib/photos.ts', import.meta.url), 'utf8');
  t.check('photos.ts etiqueta compress / sign / storage', ["tagPhotoError('compress'", "tagPhotoError('sign'", "tagPhotoError('storage'"].every((s) => p.includes(s)));
}
