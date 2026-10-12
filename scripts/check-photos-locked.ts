// Chequeo post-deploy: el bucket 'listings' NO acepta subidas anónimas y /api/photos/upload-url exige token.
// Uso: EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... npx tsx scripts/check-photos-locked.ts [baseUrl]
//   baseUrl por defecto: https://pago.meteorito.app . Solo usa la anon key pública (la misma del cliente).
// Si una subida anónima llegara a pasar, intenta borrarla y falla con código 1.
import { createClient } from '@supabase/supabase-js';

const BASE = (process.argv[2] ?? 'https://pago.meteorito.app').replace(/\/$/, '');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) { console.error('Falta EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY'); process.exit(2); }

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); if (!ok) failed++; };
// JPEG mínimo válido (1x1)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

(async () => {
  if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = (await import('ws')).default; // Node 20
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const path = `check-anon/${Date.now()}.jpg`;
  const up = await sb.storage.from('listings').upload(path, JPEG, { contentType: 'image/jpeg', upsert: false });
  check('subida anónima a listings rechazada', !!up.error, up.error ? `${(up.error as any).statusCode ?? ''} ${up.error.message}` : `¡SUBIÓ! ${up.data?.path}`);
  if (!up.error) await sb.storage.from('listings').remove([path]).catch(() => {});

  const body = JSON.stringify({ draftId: '00000000-0000-4000-8000-000000000000', index: 0, mime: 'image/jpeg', size: 1000 });
  const r1 = await fetch(`${BASE}/api/photos/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  check('POST /api/photos/upload-url sin token -> 401', r1.status === 401, `${r1.status} ${(await r1.text()).slice(0, 120)}`);
  const r2 = await fetch(`${BASE}/api/photos/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x.y.z' }, body });
  check('POST /api/photos/upload-url con token basura -> 401', r2.status === 401, `${r2.status} ${(await r2.text()).slice(0, 120)}`);

  console.log(failed ? `\n${failed} FALLARON` : '\nTODO OK'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
