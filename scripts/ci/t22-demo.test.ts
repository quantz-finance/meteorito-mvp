// (22) Modo demo: apagado por defecto, sin puerta en prod y sin llamadas al backend de producción.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { DEMO_ENABLED, DEMO_BLOCKED_HOSTS, DEMO_BUYER, DEMO_SELLER, demoContractId, demoEnabled, demoTxHash } from '../../lib/demo';

const root = join(__dirname, '../..');
const LEGAL_SRC = readFileSync(join(root, 'lib/legal.ts'), 'utf8');

export async function run(t: T) {
  // Apagado por defecto
  t.check('DEMO_ENABLED es false sin la variable (en este proceso)', process.env.EXPO_PUBLIC_DEMO_MODE === undefined ? DEMO_ENABLED === false : true);
  for (const v of [undefined, '', '0', 'false', 'no', 'on', 'yes', '2']) t.check(`demoEnabled(${JSON.stringify(v)}) = false`, demoEnabled(v) === false);
  for (const v of ['1', 'true', 'TRUE', ' 1 ']) t.check(`demoEnabled(${JSON.stringify(v)}) = true en host de pruebas`, demoEnabled(v, 'localhost') === true);
  // Sin puerta en prod: aunque la variable esté puesta, los dominios de producción lo desactivan
  t.check('prod (pago.meteorito.app) nunca activa demo, ni con la variable', ['pago.meteorito.app', 'PAGO.METEORITO.APP', 'meteorito.app'].every((h) => demoEnabled('1', h) === false));
  t.check('lista de hosts bloqueados incluye el dominio de producción', DEMO_BLOCKED_HOSTS.includes('pago.meteorito.app'));
  t.check('.env.example no activa el demo', !/^EXPO_PUBLIC_DEMO_MODE=(1|true)/im.test(readFileSync(join(root, '.env.example'), 'utf8')));
  t.check('vercel.json no activa el demo', !/DEMO_MODE/.test(readFileSync(join(root, 'vercel.json'), 'utf8')));
  t.check('el texto legal ya no promete un árbitro automatizado', !LEGAL_SRC.includes('apoyo de un árbitro automatizado'));
  // Datos de ejemplo con forma Stellar
  t.check('direcciones demo con formato G… de 56 chars', /^G[A-Z2-7]{55}$/.test(DEMO_SELLER.address) && /^G[A-Z2-7]{55}$/.test(DEMO_BUYER.address), `${DEMO_SELLER.address.length}/${DEMO_BUYER.address.length}`);
  t.check('hash/contrato de ejemplo con formato y deterministas', /^[0-9a-f]{64}$/.test(demoTxHash('a')) && demoTxHash('a') === demoTxHash('a') && demoTxHash('a') !== demoTxHash('b') && /^C[A-Z2-7]{55}$/.test(demoContractId('a')));

  // Flujo completo con DEMO=1 y fetch prohibido (proceso hijo, el flag se inlinea al cargar el módulo)
  const r = spawnSync(join(root, 'node_modules/.bin/tsx'), [join(__dirname, 'demo-child.ts')], { cwd: root, encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_DEMO_MODE: '1', EXPO_PUBLIC_SUPABASE_URL: 'https://prod.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'x' } });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '));
  let o: any = null; try { o = JSON.parse(line!.slice(7)); } catch { /* */ }
  t.check('el proceso demo corre y devuelve resultado', !!o && !o.crash, o?.crash ?? (r.stderr ?? '').slice(0, 300));
  if (!o || o.crash) return;
  t.check('con la variable, demo activo', o.enabled === true);
  t.check('CERO llamadas de red en todo el flujo', Array.isArray(o.fetchCalls) && o.fetchCalls.length === 0, JSON.stringify(o.fetchCalls));
  t.check('Supabase bloqueado en demo (aunque haya credenciales)', o.supabase === 'blocked');
  t.check('(1) vendedor crea link -> creado', o.afterCreate === 'creado' && /^demo\d\d$/.test(o.slug));
  t.check('(2) comprador paga -> fondeado, PIN de 6 dígitos devuelto una vez, sin filtrarse en el pedido público', o.status2 === 'fondeado' && o.pinLen === 6 && o.pinLeak === false);
  t.check('(2) contrato y comprobante con formato Stellar', o.contractLen === 56 && o.fundedTxLen === 64);
  t.check('(3) sin foto de la cámara no se marca enviado (ship_photo_required)', o.shipNoPhoto === 'ship_photo_required', String(o.shipNoPhoto));
  t.check('(3) vendedor marca enviado con la foto de la cámara (token de un uso)', o.status3 === 'enviado');
  t.check('(4) PIN incorrecto rechazado; PIN correcto libera con comprobante', o.badPin === 'bad_pin' && o.status4 === 'liberado' && o.releasedTxLen === 64);
  t.check('(4) saldo del vendedor sube con el cobro', Number(o.balance) > 120, o.balance);
  t.check('(5) disputa abierta', o.status5 === 'en_disputa');
  t.check('monto USDC = CRC / tasa', o.amount === 500, String(o.amount));
  t.check('los textos legales no mencionan árbitro automatizado', o.legalArbiter === false);
}
