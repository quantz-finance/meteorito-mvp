import type { T } from './setup';
import { agoLabel, isStale } from '../../lib/freshness';
import { POLL_MS } from '../../lib/refresh';

export async function run(t: T) {
  const now = 1_000_000;
  t.check('sin dato -> Actualizando…', agoLabel(null, now) === 'Actualizando…');
  t.check('<5 s -> ahora', agoLabel(now - 2000, now) === 'Actualizado ahora');
  t.check('12 s -> hace 12 s', agoLabel(now - 12_000, now) === 'Actualizado hace 12 s');
  t.check('3 min', agoLabel(now - 180_000, now) === 'Actualizado hace 3 min');
  t.check('2 h', agoLabel(now - 2 * 3600_000, now) === 'Actualizado hace 2 h');
  t.check('stale tras 3 ciclos de polling', !isStale(now - POLL_MS * 2, POLL_MS, now) && isStale(now - POLL_MS * 3 - 1, POLL_MS, now));
}
