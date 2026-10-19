// (31) Copy en tuteo: ningún texto de la UI/API usa voseo (podés, tenés, mirá, tocá, pedile, compartilo, vos…).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { T } from './setup';

const ROOT = new URL('../../', import.meta.url).pathname;
const DIRS = ['app', 'components', 'lib', 'constants', 'api'];
const EXTRA = ['app.config.ts'];
// Formas de voseo: presente (-ás/-és/-ís) e imperativo con tilde (-á/-é/-í), con o sin clítico, y "vos".
const L = '(?<!\\p{L})', R = '(?!\\p{L})'; // límites de palabra con Unicode (\\b no entiende á/é/í)
const VOSEO = new RegExp(L + '(?:' + [
  '(pod|ten|quer|sab|vend|compr|pag|necesit|recib|eleg|dec|escrib|pon|pued)(és|ás|ís)',
  // imperativo: -ar -> -á, -er -> -é, -ir -> -í (sin 'recibí', que también es pretérito: "Recibí y está bien")
  '(mir|toc|cre|cambi|copi|complet|cerr|inici|revis|confirm|pag|ingres|activ|esper|guard|and|prob|fij|avis|mand|cont|comprob|escane|sub|ingres|elimin|cancel|intent|verific)á',
  '(volv|pon|ten|hac|le|met|corr|respond)é',
  '(escrib|abr|compart|eleg|ven|dec|ped|eleg|segu|sal)í',
  '(pedi|comparti|conta|activa|deci|manda|avisa|escribi|revisa)(le|lo|la|los|las|nos|me)',
  'fijate',
  'vos',
].join('|') + ')' + R, 'iu');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|json)$/.test(n) ? [p] : []; });
}
export async function run(t: T) {
  t.check('detecta voseo (control)', ['Pedile al vendedor', 'compartilo por WhatsApp', 'podés pagar', 'Tocá aquí', 'contanos qué pasó', 'Activala', 'vos', 'volvé a entrar', 'escribí tu nota', 'Cambiá a la vista'].every((s) => VOSEO.test(s)));
  t.check('no marca tuteo (control)', !['Pídele al vendedor', 'compártelo por WhatsApp', 'puedes pagar', 'Toca aquí', 'cuéntanos qué pasó', 'Actívala', 'Recibí y está bien', 'cuando estés conforme', 'Ya pagué', 'Listo, lo guardé', 'probé', 'activate'].some((s) => VOSEO.test(s)));
  const files = [...DIRS.flatMap((d) => walk(join(ROOT, d))), ...EXTRA.map((f) => join(ROOT, f))];
  const hits: string[] = [];
  for (const f of files) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { const m = l.match(VOSEO); if (m) hits.push(`${relative(ROOT, f)}:${i + 1} «${m[0]}»`); });
  t.check(`sin voseo en ${files.length} archivos de UI/API`, hits.length === 0, hits.slice(0, 5).join(' · '));
}
