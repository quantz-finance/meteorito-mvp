// (25) Refresco del vendedor: se sigue consultando mientras haya pedidos no finales.
import type { T } from './setup';
import { isFinalStatus, needsPolling, POLL_MS } from '../../lib/refresh';

export async function run(t: T) {
  t.check('liberado/resuelto/cancelado son finales', ['liberado', 'resuelto', 'cancelado'].every(isFinalStatus));
  t.check('enviado/fondeado/en_disputa no son finales', ['enviado', 'fondeado', 'en_disputa', 'entregado'].every((s) => !isFinalStatus(s)));
  t.check('pedido enviado -> hay polling', needsPolling([{ status: 'liberado' }, { status: 'enviado' }]));
  t.check('todos finales / vacío / null -> sin polling', !needsPolling([{ status: 'liberado' }]) && !needsPolling([]) && !needsPolling(null));
  t.check('intervalo entre 5 y 10 s', POLL_MS >= 5000 && POLL_MS <= 10000);
  // Home sin botón "Actualizar" (era de pruebas): se actualiza sola al enfocar, con polling y al volver a la pestaña.
  const home = (await import('node:fs')).readFileSync('app/(tabs)/pedidos.tsx', 'utf8');
  t.check('Home: sin botón Actualizar', !/label="Actualizar"/.test(home) && !/icon="refresh"/.test(home));
  t.check('Home: carga al enfocar y refresca sola (useFocusEffect + useOrdersRefresh)', /useFocusEffect\(useCallback\(\(\) => \{ load\(\); \}/.test(home) && /useOrdersRefresh\(silentRefresh, orders\)/.test(home));
}
