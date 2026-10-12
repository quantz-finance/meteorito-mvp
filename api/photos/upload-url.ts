// POST /api/photos/upload-url (Bearer JWT Cavos)  { draftId: uuid, index: 0..3, mime, size }
// Devuelve una URL de subida firmada (Supabase Storage) para listings/<cavos sub>/<draftId>/<index>.<ext>.
// El bucket ya no acepta inserts anon (migración 005): esta es la única vía. Máx 4 por publicación (index 0..3,
// sin upsert), solo imágenes, ≤1 MB (el cliente comprime a <300 KB). Lectura pública sigue igual.
import { db, json, fail } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_MIME, publicPrefix, userDir } from '../_lib/photos';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { draftId, index, mime, size } = req.body ?? {};
    if (typeof draftId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) throw new HttpError(400, 'draftId inválido');
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PHOTOS) throw new HttpError(400, `máximo ${MAX_PHOTOS} fotos`);
    const ext = PHOTO_MIME[mime as string];
    if (!ext) throw new HttpError(415, 'solo imágenes JPEG, PNG o WebP');
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) throw new HttpError(413, 'foto demasiado grande (máx 1 MB)');
    const path = `${userDir(user.sub)}/${draftId.toLowerCase()}/${index}.${ext}`;
    const { data, error } = await db().storage.from('listings').createSignedUploadUrl(path);
    if (error) throw new HttpError(409, `no se pudo preparar la subida: ${error.message}`);
    return json(res, 200, { path, token: data.token, signedUrl: data.signedUrl, publicUrl: publicPrefix(user.sub) + `${draftId.toLowerCase()}/${index}.${ext}` });
  } catch (e) { return fail(res, e); }
}
