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
  { id: '48', name: 'Vender: "Generar link" sin barra morada detrás (footer transparente)', file: './t48-vender-footer.test.ts', onchain: false },
  { id: '49', name: 'Comprar: invitar al vendedor desde un anuncio de Facebook (invitado, límites, link guardado, foto reutilizada)', file: './t49-buyer-facebook-invite.test.ts', onchain: false },
  { id: '50', name: 'Universo v2: estrellas que brillan + planetas discretos (ligero, sin eventos)', file: './t50-universe-planets.test.ts', onchain: false },
  { id: '51', name: 'Pago con tarjeta (Lendara): sesión, aprobado, KYC, vencido, demorado, idempotencia, montos', file: './t51-lendara-card.test.ts', onchain: false },
  { id: '52', name: 'Tarjeta in-app: Luhn/vencimiento/CVC, tarjeta->escenario, Lendara headless (token, 409, frío), card_pay', file: './t52-card-inapp.test.ts', onchain: false },
  { id: '53', name: 'Envío simple ("Ya lo envié" con foto de la cámara) + liberación segura (PIN/confirmación/7 días, mínimo en prod, disputa congela)', file: './t53-simple-shipping.test.ts', onchain: false },
  { id: '54', name: 'WhatsApp del vendedor: formato CR normalizado, solo el comprador y solo después de pagar', file: './t54-seller-phone.test.ts', onchain: false },
  { id: '55', name: 'Cómo funciona: reglas en un módulo, pantalla sin cuenta, accesos en pago/Vender/Home/Mi cuenta, tuteo', file: './t55-rules-section.test.ts', onchain: false },
  { id: '56', name: 'Aviso de beta: texto exacto en pago (antes de pagar), Vender, PIN y disputa; discreto, letra ≥12 px y AA en todos los temas (no quitar sin revisión legal); única excepción a "sin testnet"', file: './t56-beta-notice.test.ts', onchain: false },
  { id: '57', name: 'Plazo acordado (24 h-30 días) + cara a cara + extensión de mutuo acuerdo (tope 30 días, pendiente congela)', file: './t57-agreed-window.test.ts', onchain: false },
  { id: '58', name: 'Fotos solo cámara: token de un uso (propósito/pedido/5 min), envío con foto obligatoria, producto y disputa sin carrete, FB con su foto', file: './t58-camera-only.test.ts', onchain: false },
  { id: '63', name: 'Importar de un link: proveedores LatAm, SSRF estricto (DNS/IP privada, redirecciones), parsers con HTML real, precio sugerido, source_url', file: './t63-marketplace-import.test.ts', onchain: false },
  { id: '60', name: 'Feed de Comprar + buscador: vendedores con producto activo, filtro verificados/sin verificar/todos, cursor, sin datos privados, sin acentos', file: './t60-feed.test.ts', onchain: false },
  { id: '61', name: 'Perfil público del vendedor: verificado, ventas, reseñas, WhatsApp solo si elige mostrarlo, OG para compartir', file: './t61-seller-profile.test.ts', onchain: false },
  { id: '65', name: 'Herramientas del vendedor: plantilla de anuncio (link + acuerdo + custodia) e historial de ventas con resultado', file: './t65-seller-tools.test.ts', onchain: false },
  { id: '66', name: 'Una sola página de tienda: /t/<usuario> es Mi tienda; herramientas solo para el dueño; compartir siempre', file: './t66-store-page.test.ts', onchain: false },
  { id: '70', name: 'Última conexión solo con consentimiento: apagada por defecto, registro de cada cambio, sin rastro público al apagarla, rangos sin hora exacta, sin 023 no rompe', file: './t70-last-seen.test.ts', onchain: false },
  { id: '62', name: 'Reseñas: compra liberada, 1-5 + comentario opcional (280, sin links) + nombre corto, una por pedido', file: './t62-reviews.test.ts', onchain: false },
  { id: '64', name: 'WhatsApp en el perfil público: opt-in del vendedor, privado por defecto', file: './t64-whatsapp-public.test.ts', onchain: false },
  { id: '67', name: 'Feed: ventas cerradas de EJEMPLO (ficticias, iconito discreto, sin montos, flag, 1 de cada 6, respeta el filtro); reales solo con opt-in', file: './t67-feed-sales.test.ts', onchain: false },
  { id: '68', name: 'Comprar: invitar con el link de cualquier marketplace (lee FB/Walmart; ML/Amazon/Encuentra24 se aceptan sin pedirlos)', file: './t68-invite-any-marketplace.test.ts', onchain: false },
  { id: '69', name: 'Mis compras: botón en Comprar, compras de este dispositivo (guardadas al pagar + recuperación por PIN/pedido propio) y del servidor solo por llave/sesión, activas primero', file: './t69-mis-compras.test.ts', onchain: false },
  { id: '76', name: 'Seguir vendedores: cuenta o dispositivo, par único, anti-spam, privado (solo el número), push al publicar', file: './t76-follows.test.ts', onchain: false },
  { id: '77', name: 'Algoritmo del feed: puntaje determinístico con pesos documentados, diversidad, cursor estable, filtro/búsqueda, personalizado sin caché', file: './t77-feed-rank.test.ts', onchain: false },
  { id: '78', name: 'Bloque Patrocinado: solo patrocinios activos, identificable (Ley 7472), filtro/búsqueda, 1.ª página, sin montos, métricas, Promocionar sin cobro', file: './t78-sponsored.test.ts', onchain: false },
  { id: '79', name: 'Comprar en 3 pantallas (Feed por defecto, Pagar con link, Mis compras) con link propio e iconos arriba a la derecha', file: './t79-comprar-pantallas.test.ts', onchain: false },
  { id: '80', name: 'Chat comprador-vendedor: solo las dos partes (token + identidad), 1000 caracteres, idempotente, límite por minuto, leído/escribiendo, bloquear/reportar, push con enfriamiento, sin 025 no rompe', file: './t80-chat.test.ts', onchain: false },
  { id: '81', name: 'Chat en la app: tienda, producto antes de pagar y compra activa; bandejas con insignia sin pestaña nueva; compositor 16 px; eventos; privacidad para revisión legal', file: './t81-chat-ui.test.ts', onchain: false },
  { id: '82', name: 'Productos de ejemplo en Comprar: después de los reales, filtro y búsqueda, nunca en Patrocinado, tiendas de ejemplo, fotos en /public y pago imposible', file: './t82-feed-demo-products.test.ts', onchain: false },
  { id: '83', name: 'Panel de disputas: reglas (sin envío, envío sin prueba, 48 h sin respuesta), admin solo por servidor (no admin 404), decisión + resolución compartida con el script, auditoría, devolución al invitado, IA sin PII con caché, sin 027 degrada', file: './t83-disputes-admin.test.ts', onchain: false },
  { id: '84', name: 'Sesión vencida del vendedor: sin token vencido al SDK, re-login encima de la pantalla + reintento único, borrador persistente, misma pantalla, sin "recarga la página"', file: './t84-sesion-vencida.test.ts', onchain: false },
  { id: '85', name: 'Mis compras sin cuenta: toda Comprar pública, sin barra del vendedor, Volver y vacío amable', file: './t85-mis-compras-invitado.test.ts', onchain: false },
  { id: '86', name: 'Seguidores privados: la tienda y el API nunca dicen quién sigue (ni al dueño); solo el número, que no se toca; ventas cerradas en el feed siguen', file: './t86-followers-private.test.ts', onchain: false },
  { id: '87', name: 'Comprar › Siguiendo: solo las tiendas que sigues (cuenta o dispositivo), con filtro y búsqueda, sin ejemplos ni Patrocinado, vacío en tuteo; Para ti no cambia', file: './t87-feed-siguiendo.test.ts', onchain: false },
  { id: '93', name: 'Vender rediseñado: "Generar link" es un círculo grande (órbitas, onda al lanzar); misma validación y carga; solo transform/opacity; quieto con reducir movimiento', file: './t93-vender-orbita.test.ts', onchain: false },
  { id: '88', name: 'Volver del invitado sin historial: nunca a una ruta con login (va a Mis compras); bienvenida -> feed', file: './t88-volver-invitado.test.ts', onchain: false },
  { id: '89', name: 'Comprar › Buscar en un modalcito: lupa (4.º icono), input enfocado >= 16 px, mismo filtro y vistas, cerrar y limpiar, punto y chip', file: './t89-buscar-modal.test.ts', onchain: false },
  { id: '85', name: 'Comprador sin cuenta: avisos por WhatsApp/correo/cuenta con consentimiento, link de acceso firmado, vínculo con cuenta, avisos por estado con tope, sin 028 no rompe', file: './t85-contacto-comprador.test.ts', onchain: false },
  { id: '90', name: 'Neo: cripto solo testnet (mainnet nunca cuenta) + IBAN/SINPE como dato de ejemplo (nunca en base, logs ni PostHog)', file: './t90-neo-testnet-privacy.test.ts', onchain: false },
  { id: '89', name: 'Dónde cobrar (029): wallet Stellar con trustline o Cuenta IBAN con cola manual del admin, sin 029 como antes', file: './t89-cobro-wallet-iban.test.ts', onchain: false },
  { id: '88', name: 'Pago con cripto (USDC o XLM en Stellar): cotización con colchón y vencimiento, SEP-7, detección en Horizon, conversión XLM->USDC, de menos/de más/doble pago, invitado, cron', file: './t88-crypto-pay.test.ts', onchain: false },
  { id: '92', name: 'Animación de entrada única: fade + subida 10 px, 280 ms, escalonada 40 ms con tope (~0,5 s), se repite al enfocar, instantánea con reducir movimiento y en tests; toda la app', file: './t92-animacion-entrada.test.ts', onchain: false },
  { id: '90', name: 'Chat con el producto (estilo Messenger): botón siempre en la ficha, tarjeta en el hilo, bandeja del vendedor con el producto, sin 030 como antes', file: './t90-chat-producto.test.ts', onchain: false },
  { id: '90', name: 'Home: resumen real + Tus ventas + Tus compras en filas compactas (sin la UI del proceso), lo que te toca primero, sin scroll, sin función nueva', file: './t90-home.test.ts', onchain: false },
  { id: '91', name: 'Buscador privado: el texto nunca va a analítica, logs ni URLs (POST, solo largo y resultados)', file: './t91-busqueda-privada.test.ts', onchain: false },
  { id: '94', name: 'Redes en la tienda (031): usuario o link -> link https canónico de cada red, rechaza otros esquemas/dominios/largos', file: './t94-redes-tienda.test.ts', onchain: false },
  { id: '95', name: 'Modo de la app: Testnet (default) = solo reales; Datos de ejemplo = con ejemplos (por pedido, sin estado global); Mainnet próximamente y desactivado', file: './t95-datos-de-ejemplo.test.ts', onchain: false },
  { id: '92', name: 'Pie del producto: texto exacto de custodia (sin "Protección: 7 días"), aviso legal una vez, barrido de la UI', file: './t92-pie-custodia.test.ts', onchain: false },
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
