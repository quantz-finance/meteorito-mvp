// Textos visibles del feed de Comprar, el perfil público del vendedor y las reseñas. PROVISIONALES: centralizados aquí
// para cambiarlos fácil tras la revisión de copy. En el código el campo sigue llamándose `verified`.
// Prohibido en el copy visible (lo revisa t60): "seguro", "garantía", "verificado" como garantía, "empresa", "fintech",
// "banco", "billetera".
export const COPY = {
  identity: {
    badge: 'Identidad confirmada',            // accesibilidad del check junto al nombre
    unconfirmed: 'Identidad sin confirmar',   // nota sutil en el perfil
    ogSuffix: 'identidad confirmada',         // título de la vista previa al compartir: "Valeria (identidad confirmada)"
  },
  filters: { confirmed: 'Identidad confirmada', unconfirmed: 'Sin confirmar' }, // dos mitades iguales; sin "Todos"
  feed: {
    latest: 'Para ti', results: 'Resultados', searchLabel: 'Buscar productos', searchPlaceholder: 'Buscar: PlayStation, bici, iPhone…',
    clear: 'Limpiar búsqueda', buy: 'Comprar',
    emptyConfirmedTitle: 'Todavía no hay vendedores con identidad confirmada',
    emptyConfirmedText: 'Aquí verás a los vendedores con identidad confirmada. Mientras tanto, mira las de Sin confirmar: con cualquier vendedor tu pago queda en custodia hasta que recibas.',
    seeUnconfirmed: 'Ver Sin confirmar', seeConfirmed: 'Ver Identidad confirmada',
    searchOther: (label: string) => `Buscar en ${label}`,
    // Vistas del feed: Para ti (el feed con el algoritmo, por defecto) y Siguiendo (solo las tiendas que sigues).
    forYou: 'Para ti', following: 'Siguiendo', viewsLabel: 'Qué publicaciones ver',
    followingEmptyTitle: 'Aún no sigues tiendas',
    followingEmptyText: 'Cuando sigas una, sus publicaciones aparecen aquí.',
    suggestedStores: 'Tiendas para empezar',
    followingNoneTitle: 'Nada nuevo de las tiendas que sigues',
    followingNoneText: (label: string) => `Las tiendas que sigues no tienen publicaciones en ${label}.`,
    seeForYou: 'Ver Para ti',
  },
  sales: {
    sheetTitle: 'Es un ejemplo',
    sheetText: 'Así se verán las ventas cerradas en el feed. Los nombres y el producto son ficticios: esta venta no ocurrió.',
    sheetOk: 'Entendido',
  },
  profile: {
    escrowNote: 'Con cualquier vendedor, tu pago queda en custodia hasta que recibas.',
    salesDone: (n: number) => (n === 1 ? 'venta completada' : 'ventas completadas'),
    outcomesTitle: 'Cómo salieron sus ventas',
    noIssues: (n: number) => `${n} sin problemas`,
    disputesResolved: (n: number) => `${n} con disputa resuelta`,
    disputesOpen: (n: number) => `${n} en disputa`,
    noSalesYet: 'Todavía no tiene ventas completadas.',
    reviewsCount: (n: number) => `${n} reseña${n === 1 ? '' : 's'} de compras liberadas`,
    reviewBy: (name: string | null) => (name ? `${name} · compra liberada` : 'Compra liberada'),
    noReviews: 'Todavía no tiene reseñas. Solo quien compró y recibió (pago liberado) puede dejar una.',
  },
  ficha: { seeProfile: 'Ver perfil del vendedor', soldBy: (name: string) => `Vendido por ${name}` },
  // Productos y tiendas de EJEMPLO del feed (api/_lib/demoProducts.ts, FEED_DEMO_PRODUCTS): ficticios, nunca se pagan.
  // Señal SUTIL: un iconito (i) discreto que abre un popup chico; nada de etiquetas "Ejemplo" ni avisos grandes.
  demoProducts: {
    cardLabel: (title: string, price: string) => `Ejemplo. ${title}, ${price}`, // solo lector de pantalla
    info: {
      iconLabel: 'Producto de ejemplo',
      title: 'Producto de ejemplo',
      body: 'Lo pusimos para mostrarte cómo se ve el feed. No está a la venta.',
      ok: 'Entendido',
    },
    storeInfo: {
      iconLabel: 'Tienda de ejemplo',
      title: 'Tienda de ejemplo',
      body: 'La pusimos para mostrarte cómo se ve una tienda. Sus productos no están a la venta.',
      ok: 'Entendido',
    },
    productTitle: 'Producto',
    productNote: 'Es de ejemplo: no se puede pagar.',
    payDisabled: 'Pago desactivado',
    seeStore: 'Ver la tienda',
    gone: 'Este ejemplo ya no está disponible.',
    reviewBy: (name: string | null) => `${name ?? 'Comprador'} · reseña de ejemplo`,
  },
  review: {
    title: '¿Cómo te fue con el vendedor?',
    pickHint: 'Toca de 1 a 5 estrellas. Solo puedes dejar una reseña por compra.',
    commentPlaceholder: 'Cuéntales a otros compradores cómo te fue (opcional)', commentLabel: 'Comentario, opcional',
    namePlaceholder: 'Tu nombre (opcional), ej. María R.', nameLabel: 'Tu nombre, opcional',
    publicNote: 'Tu reseña es pública en el perfil del vendedor con tu nombre corto (ej. "María R."). Sin links.',
    submit: 'Publicar reseña', thanks: '¡Gracias por tu reseña!', thanksText: 'Ayuda a otros compradores a elegir con confianza.',
    seeProfile: 'Ver el perfil del vendedor', failed: 'No pudimos guardar tu reseña.',
  },
  whatsappPublic: {
    label: 'Mostrar en mi perfil público', a11y: 'Mostrar mi WhatsApp en mi perfil público',
    on: 'Cualquiera que vea tu perfil puede escribirte por WhatsApp.', off: 'Tu perfil público no lo muestra.',
  },
  follow: {
    follow: 'Seguir', following: 'Siguiendo',
    a11yFollow: (name: string) => `Seguir a ${name}`, a11yUnfollow: (name: string) => `Dejar de seguir a ${name}`,
    followers: (n: number) => (n === 1 ? 'seguidor' : 'seguidores'),
    done: (name: string) => `Ahora sigues a ${name}. Verás primero lo nuevo que publique.`,
    privateNote: 'Solo se muestra cuántos te siguen, nunca quiénes.',
  },
  // Publicidad identificable (Ley 7472): siempre con la etiqueta "Patrocinado" y en su propio bloque.
  sponsored: {
    label: 'Patrocinado',
    a11y: (title: string) => `Patrocinado: ${title}`,
    infoA11y: 'Qué significa Patrocinado',
    infoTitle: 'Productos patrocinados',
    infoText: 'Estos vendedores pagaron para mostrar sus productos en este bloque. Lo demás del feed no es publicidad. Comprar un producto patrocinado funciona igual: el pago queda en custodia y se libera con tu PIN de entrega, o por tiempo si no abres una disputa antes. Que sea patrocinado no significa que Meteorito verifique el producto.',
    ok: 'Entendido',
    promote: 'Promocionar este producto',
    promoteText: 'Todavía no puedes promocionar tus productos. Por ahora no se cobra nada y no tienes que hacer nada.',
  },
  // Plantilla de anuncio e historial de ventas (lib/sellerTools.ts). Copy final aprobado por Neo.
  adTemplate: {
    title: 'Plantilla de anuncio', copy: 'Copiar anuncio', copied: 'Anuncio copiado',
    custody: 'Pago en custodia con Meteorito (beta en testnet, sin dinero real): el pago queda en un contrato de escrow en Stellar y se libera cuando quien compra da su PIN de entrega, o por tiempo si no abre una disputa antes. Meteorito no verifica el producto.',
    payHere: (link: string) => `Paga aquí, sin crear cuenta: ${link}`,
  },
  salesHistory: {
    title: 'Historial de ventas', subtitle: 'Tus ventas con su estado y lo que cobraste.',
    cobrado: 'Cobrado', parcial: 'Cobro parcial', reembolsado: 'Reembolsado', cancelado: 'Sin venta', disputaResuelta: 'Disputa resuelta', enCurso: 'En curso',
  },
  // Vender → Importar de un link. El error no nombra al proveedor (api/_lib/importers/providers.ts IMPORT_FAILED es el mismo texto; t65 lo revisa).
  importLink: {
    title: 'Importar de un link', label: 'Pega el link de tu anuncio',
    failed: 'Todavía no podemos leer ese link. Tómale foto a tu anuncio y súbela.',
  },
  myStore: { confirmIdentity: 'Confirma tu identidad' },
  activity: {
    online: 'En línea',
    min: (n: number) => `Activo hace ${n} min`,
    hours: (n: number) => `Activo hace ${n} h`,
    yesterday: 'Activo ayer',
    days: (n: number) => `Activo hace ${n} días`,
    toggle: 'Mostrar mi última conexión',
    // Consentimiento (Ley 8968): apagado por defecto. Si cambia algún texto, sube LAST_SEEN_TEXT_VERSION (api/_lib/activity.ts).
    toggleOn: 'Quienes ven tu tienda en Meteorito ven cuándo estuviste activo por última vez (aproximado, sin hora exacta). Puedes apagarlo cuando quieras.',
    toggleOff: 'Apagado: nadie ve cuándo estuviste activo.',
    inviteTitle: 'Tu última conexión',
    invite: 'Mostrar a quienes ven tu tienda en Meteorito cuándo estuviste activo por última vez (aproximado, sin hora exacta). Puedes apagarlo cuando quieras en Mi cuenta.',
    inviteDone: 'Listo',
  },
  // Chat comprador-vendedor (texto solo, v1). Tuteo; sin seguro/garantía/verificado/empresa/fintech/banco/billetera/proteg* (t80).
  chat: {
    send: 'Enviar mensaje', sendA11y: (name: string) => `Enviar mensaje a ${name}`,
    askSeller: 'Preguntar al vendedor',
    orderBuyer: 'Chatear con el vendedor', orderSeller: 'Chatear con el comprador',
    orderHint: 'Coordina la entrega o pregunta lo que necesites. Todo queda en esta compra.',
    title: 'Mensajes', inboxSeller: 'Mensajes de compradores', inboxBuyer: 'Tus mensajes',
    inboxEmpty: 'Todavía no tienes conversaciones.',
    inboxEmptySeller: 'Cuando un comprador te escriba desde tu tienda, un producto o una compra, lo verás aquí.',
    inboxEmptyBuyer: 'Escríbele a un vendedor desde su tienda o un producto. Tus conversaciones aparecen aquí.',
    unreadA11y: (n: number) => (n === 1 ? '1 conversación sin leer' : `${n} conversaciones sin leer`),
    you: 'Tú: ',
    placeholder: 'Escribe un mensaje', inputA11y: 'Mensaje', sendBtn: 'Enviar',
    quick: ['¿Sigue disponible?', '¿Haces envíos?', '¿Precio final?'] as readonly string[],
    quickKeys: ['disponible', 'envios', 'precio'] as readonly string[],
    quickA11y: 'Respuestas rápidas',
    first: (name: string) => `Escríbele a ${name}. Su respuesta aparecerá aquí.`,
    firstSeller: 'Escríbele al comprador. Su respuesta aparecerá aquí.',
    about: 'Sobre', order: 'Compra', see: 'Ver',
    typing: 'Escribiendo…',
    sending: 'Enviando', sent: 'Enviado', read: 'Leído', failed: 'No se envió. Toca para reintentar.',
    today: 'Hoy', yesterday: 'Ayer', older: 'Ver mensajes anteriores',
    payInside: 'Para que tu compra quede en custodia, paga dentro de Meteorito.',
    itemGone: 'Este producto ya no está disponible',
    count: (n: number, max: number) => `${n}/${max}`,
    options: 'Opciones de la conversación',
    report: 'Reportar', reportTitle: 'Reportar conversación', reportText: 'Cuéntanos qué pasa. El equipo de Meteorito lo revisa. No le avisamos que la reportaste.',
    reasons: [['spam', 'Spam o publicidad'], ['abuso', 'Insultos o acoso'], ['fraude', 'Intento de estafa'], ['otro', 'Otra cosa']] as readonly (readonly [string, string])[],
    reportDetail: 'Detalle (opcional)', reportSend: 'Enviar reporte', reported: 'Gracias. Recibimos tu reporte.',
    block: 'Bloquear conversación', unblock: 'Desbloquear',
    // Mismo texto que CHAT_BLOCK_LOCKED (api/_lib/chatText.ts): compra en curso o disputa abierta entre los dos.
    blockLocked: 'No puedes bloquear mientras haya una compra en curso o una disputa abierta. Si hay un problema, repórtalo.',
    blockedSeller: 'Bloqueaste esta conversación. Nadie puede escribir.', blockedBuyer: 'El vendedor cerró esta conversación.',
    blockedToast: 'Conversación bloqueada', unblockedToast: 'Conversación desbloqueada',
    seeItem: 'Ver producto', seeOrder: 'Ver compra',
    loadError: 'No pudimos cargar la conversación. Revisa tu conexión.',
    notFound: 'Esta conversación no existe o no es tuya.',
    unavailable: 'El chat todavía no está disponible. Intenta más tarde.',
    openError: 'No pudimos abrir el chat. Intenta de nuevo.',
  },
  store: {
    share: 'Compartir perfil', shareMine: 'Compartir mi tienda',
    linkCopied: 'Link copiado',
    shareText: (name: string) => `Mira el perfil de ${name} en Meteorito: compras sin crear cuenta y con el pago en custodia.`,
    shareMineText: 'Mira lo que vendo en mi tienda de Meteorito:',
    ownerTitle: 'Tu tienda', ownerHint: 'Así ven tu tienda tus compradores. Solo tú ves esta sección.',
    edit: 'Editar nombre o usuario', account: 'Mi cuenta', accountHint: 'Cobros, WhatsApp, correo y sesión',
    manageHint: 'Toca un producto para pausarlo o copiar su anuncio',
    paused: 'En pausa',
    ownerEmpty: 'Todavía no tienes productos disponibles. Crea un link y aparece aquí.',
  },
} as const;

/** Palabras que no pueden aparecer en el copy visible (feed, perfil y reseñas). */
export const BANNED_COPY = /\b(segur[oa]s?|garant[ií]as?|verificad[oa]s?|empresas?|fintech|bancos?|billeteras?)\b/i;
