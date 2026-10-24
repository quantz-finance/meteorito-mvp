// (10) Ventana de liberación automática configurable: AUTO_RELEASE_MINUTES (default 10080 = 7 días). Fuera de producción
// (preview/CI/local) se aceptan plazos cortos; el mínimo de producción lo prueba t53.
import type { T } from './setup';
import { env, autoReleaseAt } from '../../api/_lib/env';
import { formatWindow, timeLeft } from '../../lib/autorelease';

export async function run(t: T) {
  const saved = { m: process.env.AUTO_RELEASE_MINUTES, h: process.env.AUTO_RELEASE_HOURS, v: process.env.VERCEL_ENV };
  process.env.VERCEL_ENV = 'preview';
  const set = (m?: string, h?: string) => {
    if (m === undefined) delete process.env.AUTO_RELEASE_MINUTES; else process.env.AUTO_RELEASE_MINUTES = m;
    if (h === undefined) delete process.env.AUTO_RELEASE_HOURS; else process.env.AUTO_RELEASE_HOURS = h;
  };
  try {
    const now = Date.parse('2026-10-12T12:00:00Z');
    set();
    t.check('default sin env = 10080 min', env.autoReleaseMinutes() === 10080);
    t.check('default: auto_release_at = +7 días', autoReleaseAt(now) === '2026-10-19T12:00:00.000Z', autoReleaseAt(now));
    set('10');
    t.check('override AUTO_RELEASE_MINUTES=10', env.autoReleaseMinutes() === 10 && autoReleaseAt(now) === '2026-10-12T12:10:00.000Z', autoReleaseAt(now));
    set(undefined, '2');
    t.check('compat AUTO_RELEASE_HOURS=2 -> 120 min', env.autoReleaseMinutes() === 120);
    set('30', '2');
    t.check('MINUTES gana sobre HOURS', env.autoReleaseMinutes() === 30);
    for (const bad of ['abc', '0', '-5', '999999']) { set(bad); t.check(`inválido "${bad}" -> default 10080`, env.autoReleaseMinutes() === 10080); }
    t.check('UI: formatWindow', formatWindow(1440) === '1 día' && formatWindow(10080) === '7 días' && formatWindow(9000) === '6 días 6 h' && formatWindow(10) === '10 min' && formatWindow(90) === '1 h 30 min');
    t.check('UI: timeLeft', timeLeft('2026-10-12T12:10:00Z', now) === '10 min' && timeLeft('2026-10-12T11:00:00Z', now) === 'menos de 1 min');
  } finally { set(saved.m, saved.h); if (saved.v === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved.v; }
}
