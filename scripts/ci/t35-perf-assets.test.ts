// (35) Performance sin romper nada: todos los iconos usados están en la fuente recortada, el polling no re-renderiza
// si los datos no cambiaron, y el splash inicial trae la mascota con su estela (en el HTML, antes del JS). Sin red.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { keepIfSame } from '../../lib/refresh';
import { createStamp } from '../../lib/freshness';

const ROOT = join(__dirname, '../..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });

export async function run(t: T) {
  const gm = JSON.parse(readFileSync(join(ROOT, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'), 'utf8'));
  const kept = new Set<string>(JSON.parse(readFileSync(join(ROOT, 'assets/fonts/ionicons-app.json'), 'utf8')));
  const src = ['app', 'components', 'lib', 'constants'].flatMap((d) => walk(join(ROOT, d))).map((f) => readFileSync(f, 'utf8')).join('\n');
  const used = [...new Set([...src.matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]))].filter((n) => n in gm);
  const missing = used.filter((n) => !kept.has(n));
  t.check('iconos usados presentes en ionicons-app.woff2 (si falla: python3 scripts/build/subset-fonts.py)', missing.length === 0, missing.join(','));

  const a = [{ slug: 'x', status: 'enviado', amount: 1 }];
  t.check('polling: datos iguales -> misma referencia (sin re-render)', keepIfSame(a, JSON.parse(JSON.stringify(a))) === a);
  const b = [{ slug: 'x', status: 'liberado', amount: 1 }];
  t.check('polling: datos nuevos -> se actualiza', keepIfSame(a, b) === b);
  t.check('polling: primera carga', keepIfSame(null, a) === a);
  const st = createStamp(); let n = 0; const off = st.subscribe(() => n++);
  st.set(5); off(); st.set(6);
  t.check('marca "Actualizado hace" notifica solo a sus suscriptores', n === 1 && st.get() === 6);

  const html = readFileSync(join(ROOT, 'app/+html.tsx'), 'utf8');
  t.check('splash HTML: mascota + 3 llamas + preload + startup image iOS',
    /mascot\.webp/.test(html) && /trail-f1\.webp/.test(html) && /trail-f3\.webp/.test(html) && /rel="preload"/.test(html) && /apple-touch-startup-image/.test(html));
  const motion = readFileSync(join(ROOT, 'constants/motion.ts'), 'utf8');
  const kf = [...motion.matchAll(/@keyframes [^{]+\{(.*?\}\})/g)].map((m) => m[1]).join('');
  t.check('animaciones CSS solo transform/opacity', !/(?:^|[{;])(?:top|left|width|height|margin|filter|box-shadow)\s*:/.test(kf.replace(/--[a-z]+:[^;}]+/g, '')));
}
