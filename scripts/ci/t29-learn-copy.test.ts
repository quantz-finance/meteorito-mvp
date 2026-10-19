// (29) Regla legal (Chuck): el contenido educativo y de invitaciones no usa seguro/protegido/garantía/garantizado (ni derivados) y mantiene la nota beta.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { BETA_NOTE, LEARN } from '../../lib/learn';

const BANNED = /\b(segur[oa]s?|seguridad|proteg\w*|garant\w*)\b/i;
export async function run(t: T) {
  const text = [BETA_NOTE, ...LEARN.flatMap((l) => [l.title, l.summary, ...l.points])];
  t.check('lib/learn.ts sin palabras prohibidas', text.every((s) => !BANNED.test(s)), text.find((s) => BANNED.test(s)));
  t.check('cubre Cavos, quién controla qué, custodia y testnet', ['cavos', 'quien', 'custodia', 'testnet'].every((id) => LEARN.some((l) => l.id === id)));
  t.check('nota beta presente y menciona testnet', /beta/i.test(BETA_NOTE) && /testnet/i.test(BETA_NOTE));
  const files = ['components/LearnSheet.tsx', 'components/Welcome.tsx', 'components/HelpSheet.tsx', 'components/PayBox.tsx', 'app/i/nueva.tsx', 'app/i/[code].tsx', 'lib/freshness.ts', 'components/Freshness.tsx'];
  for (const f of files) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const strings: string[] = [...(src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? []), ...(src.match(/>[^<>{}\n]+</g) ?? [])];
    const bad = strings.filter((s) => BANNED.test(s.replace(/['"`]/g, ' ')) && !/shield-checkmark/.test(s));
    t.check(`${f}: textos sin palabras prohibidas`, bad.length === 0, bad[0]);
  }
}
