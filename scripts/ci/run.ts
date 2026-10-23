// Runner único: `npm run test:ci`. SOLO TESTNET.
// Unit (sin red): JWT, PIN, auth de disputas. On-chain (testnet): fondeo/webhook, release, disputa.
// Sin secretos testnet: en CI falla; en local se saltan los on-chain (o TESTNET=skip para forzar).
import { baseEnv, SECRET_NAMES, testnet, type T } from './setup';

baseEnv();
const TESTS: { id: string; name: string; file: string; onchain: boolean }[] = [
  { id: '7', name: 'JWT aud/iss/exp/firma (+LOG_ONLY)', file: './t07-jwt.test.ts', onchain: false },
  { id: '4', name: 'PIN bloqueado tras 3 intentos', file: './t04-pin.test.ts', onchain: false },
  { id: '6a', name: 'Disputa: solo comprador, antes de liberar', file: './t06-dispute-auth.test.ts', onchain: false },
  { id: '8', name: 'Ownership por sub en todas las escrituras', file: './t08-ownership.test.ts', onchain: false },
  { id: '9', name: 'Vendedor nuevo sin trustline: error claro, activación validada', file: './t09-seller-wallet.test.ts', onchain: false },
  { id: '10', name: 'Liberación automática configurable (AUTO_RELEASE_MINUTES)', file: './t10-autorelease.test.ts', onchain: false },
  { id: '11', name: 'Activación wallet: errores con código + activación real testnet', file: './t11-activate.test.ts', onchain: false },
  { id: '12', name: 'Cavos: dispositivo sin llave (tras logout) y logout protegido', file: './t12-cavos-signer.test.ts', onchain: false },
  { id: '13', name: 'Sesión vencida: renovación con prueba de wallet + comprador nuevo', file: './t13-session.test.ts', onchain: false },
  { id: '14', name: 'Bind sub->wallet al iniciar sesión (solo token fresco)', file: './t14-bind-on-login.test.ts', onchain: false },
  { id: '15', name: 'Reintentos de red en CI (backoff, sin reenviar tx ya incluida)', file: './t15-ci-retry.test.ts', onchain: false },
  { id: '16', name: 'Timebounds cortos y reconstrucción solo tras expirar (sin dos tx vivas)', file: './t16-timebounds.test.ts', onchain: false },
  { id: '17', name: 'Montos: parcial no cuenta como pagado; vendedor solo recibe el monto', file: './t17-amounts.test.ts', onchain: false },
  { id: '19', name: 'Repro: token vencido de otra cuenta/billetera -> sin bucle, re-login, re-bind seguro', file: './t19-prod-relogin.test.ts', onchain: false },
  { id: '20', name: 'Re-link: solo 404 explícito, sin items activos, token fresco + nonce, auditoría', file: './t20-relink.test.ts', onchain: false },
  { id: '21', name: 'session_relogin_required: sin bucle ni logout, re-login + bind antes de actuar, bind en primer login', file: './t21-relogin-required.test.ts', onchain: false },
  { id: '22', name: 'Modo demo: apagado por defecto, sin puerta en prod, sin red al backend real', file: './t22-demo.test.ts', onchain: false },
  { id: '23', name: 'Redondeo USDC (sin ₡5 de más), stepper por estado real, links Stellar Expert', file: './t23-rounding-links.test.ts', onchain: false },
  { id: '25', name: 'Refresco vendedor: polling solo con pedidos no finales', file: './t25-refresh.test.ts', onchain: false },
  { id: '26', name: 'Comprador invitado: identidad por llave, ownership, sin login', file: './t26-guest.test.ts', onchain: false },
  { id: '27', name: 'Invitación de compra: comprador inicia, vendedor confirma, link reservado', file: './t27-invites.test.ts', onchain: false },
  { id: '28', name: 'Frescura: etiqueta "actualizado hace Xs"', file: './t28-freshness.test.ts', onchain: false },
  { id: '29', name: 'Educación: sin seguro/protegido/garantía + nota beta', file: './t29-learn-copy.test.ts', onchain: false },
  { id: '30', name: 'Sesión Cavos: PWA iOS, recarga, pestaña nueva, vencido en gracia, vencida, logout + errores traducidos', file: './t30-cavos-session.test.ts', onchain: false },
  { id: '31', name: 'Copy en tuteo: sin voseo en la UI ni en mensajes del API', file: './t31-tuteo.test.ts', onchain: false },
  { id: '32', name: 'Link en un paso: pedido sin categoría/marca/modelo/estado + validación de la pantalla', file: './t32-link-1-paso.test.ts', onchain: false },
  { id: '33', name: 'Tienda del vendedor + calificaciones (1-5, solo comprador, una vez, Entregado/Liberado)', file: './t33-ratings.test.ts', onchain: false },
  { id: '34', name: 'Vendedor nuevo activa sin fallas; cuenta cargando; wallet huérfana con salida clara', file: './t34-wallet-new-seller.test.ts', onchain: false },
  { id: '35', name: 'Performance: fuente de iconos recortada completa, polling sin re-render, splash con mascota', file: './t35-perf-assets.test.ts', onchain: false },
  { id: '36', name: 'Cuenta IBAN (mod-97, enmascarada) + perfil + push por estado + actualización segura', file: './t36-iban-push.test.ts', onchain: false },
  { id: '37', name: 'Misma cuenta en N dispositivos: passkey restaura y crea link con la misma dirección', file: './t37-multi-device.test.ts', onchain: false },
  { id: '38', name: 'Productos permanentes: dos compradores -> dos escrows, el producto sigue disponible', file: './t38-listings.test.ts', onchain: false },
  { id: '39', name: 'Teclado iOS: alto estable + encabezado compartido', file: './t39-keyboard-layout.test.ts', onchain: false },
  { id: '40', name: 'Regresión: pagar sin cuenta (push empaquetado; cambios de estado no dependen del push)', file: './t40-guest-pay-bundle.test.ts', onchain: false },
  { id: '41', name: 'Bugs de Neo: PIN bloqueado, invitación fail-closed, auto-invitación, reembolso, pedidos del vendedor', file: './t41-neo-bugs.test.ts', onchain: false },
  { id: '42', name: 'UTMs del landing: first-touch, super propiedades, initial_utm_* y app_opened', file: './t42-landing-utm.test.ts', onchain: false },
  { id: '43', name: 'photo_upload_failed con etapa (compress/sign/storage) y código', file: './t43-photo-failure-diagnostics.test.ts', onchain: false },
  { id: '44', name: 'Login: Google/Apple cuenta existente, código por correo, sesión inválida una vez', file: './t44-login-errors.test.ts', onchain: false },
  { id: '46', name: 'Foto de la tienda (solo el dueño, solo imagen propia) + 3 pestañas', file: './t46-store-photo-nav.test.ts', onchain: false },
  { id: '47', name: 'Universo animado (solo transform/opacity, estático con reducir movimiento) + Home', file: './t47-universe-home.test.ts', onchain: false },
  { id: '49', name: 'Comprar: invitar al vendedor desde un anuncio de Facebook (invitado, límites, link guardado, foto reutilizada)', file: './t49-buyer-facebook-invite.test.ts', onchain: false },
  { id: '45', name: 'Importar de Facebook: link solo FB (SSRF), parser OG real, precio a colones, timeout/tamaño', file: './t45-facebook-import.test.ts', onchain: false },
  { id: '1+5', name: 'Doble fondeo rechazado + webhook duplicado idempotente', file: './t01-funding.test.ts', onchain: true },
  { id: '2', name: 'Doble release rechazado', file: './t02-release.test.ts', onchain: true },
  { id: '3+6b', name: 'Release con disputa abierta rechazado + resolución', file: './t03-dispute-onchain.test.ts', onchain: true },
  { id: '24', name: 'On-chain: monto 7 decimales -> vendedor recibe ₡2 500 exactos', file: './t24-rounding-onchain.test.ts', onchain: true },
  { id: '18', name: 'Excedente on-chain: vendedor recibe solo el monto del pedido', file: './t18-excess-onchain.test.ts', onchain: true },
];

(async () => {
  const N = process.env.TESTNET === 'skip' ? null : testnet();
  if (!N && process.env.CI && process.env.TESTNET !== 'skip') { console.error(`Faltan secretos testnet: ${SECRET_NAMES.join(', ')}`); process.exit(1); }
  if (N) { // Preflight (solo claves públicas): saldo de la tesorería testnet que fondea los escrows de prueba
    const pub = N.pub('TESTNET_TREASURY_SECRET');
    try {
      const j: any = await (await fetch(`https://horizon-testnet.stellar.org/accounts/${pub}`)).json();
      const usdc = Number((j.balances ?? []).find((x: any) => x.asset_code === 'USDC')?.balance ?? 0);
      console.log(`[preflight] tesorería testnet ${pub} USDC=${usdc}`);
      if (usdc < 20) console.log(`[preflight] AVISO: la tesorería necesita USDC testnet (≥20) para los tests on-chain: envía USDC testnet a ${pub}`);
    } catch (e: any) { console.log(`[preflight] no se pudo leer el saldo de ${pub}: ${e?.message ?? e}`); }
  }
  const summary: string[] = []; let failed = 0;
  for (const tc of TESTS) {
    if (tc.onchain && !N) { summary.push(`SKIP  (${tc.id}) ${tc.name} — sin secretos testnet`); continue; }
    console.log(`\n== (${tc.id}) ${tc.name}`);
    let pass = 0, fail = 0;
    const t: T = { check(name, ok, detail = '') { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; } };
    try { const m = await import(tc.file); await m.run(t, N); }
    catch (e: any) { console.log(`  FAIL  excepción: ${String(e?.message ?? e).slice(0, 400)}`); fail++; }
    failed += fail;
    summary.push(`${fail ? 'FAIL' : 'PASS'}  (${tc.id}) ${tc.name} — ${pass}/${pass + fail}`);
  }
  console.log('\n==== Resumen\n' + summary.join('\n'));
  process.exit(failed ? 1 : 0);
})();
