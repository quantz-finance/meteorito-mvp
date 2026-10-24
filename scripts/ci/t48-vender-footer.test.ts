// (48) Vender: el botón "Generar link" va directo sobre el universo (sin la barra morada del footer fijo).
import type { T } from './setup';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

export async function run(t: T) {
  const ds = src('components/ds.tsx');
  const vender = src('app/(tabs)/vender.tsx');
  const bare = ds.match(/footerBare:\s*\{([^}]*)\}/)?.[1] ?? '';
  t.check('ds: estilo footerBare transparente (sin fondo morado)', /backgroundColor:\s*'transparent'/.test(bare), bare);
  t.check('ds: footerBare sin línea lila visible y mismo alto (borde transparente, no se quita)', /borderTopColor:\s*'transparent'/.test(bare) && !/borderTopWidth/.test(bare));
  t.check('ds: Screen pasa footerBare al StickyFooter', /footerBare\s*\?\s*:\s*boolean/.test(ds) && /<StickyFooter bare=\{footerBare\}>/.test(ds));
  const screens = [...vender.matchAll(/<Screen\b[^>]*footer=/g)].map((m) => m[0]);
  t.check('Vender: todas las pantallas con footer usan footerBare (formulario y link listo)', screens.length >= 2 && screens.every((x) => /\bfooterBare\b/.test(x)), `${screens.length}`);
  t.check('Vender: "Generar link" es el círculo (LaunchButton), sin fondo morado propio', /<LaunchButton label="Generar link"/.test(vender) && !/title="Generar link"/.test(vender));
}
