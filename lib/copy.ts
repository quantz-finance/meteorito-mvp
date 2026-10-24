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
  },
  sales: {
    example: 'Ejemplo',                      // etiqueta discreta: estas ventas son ficticias
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
    infoText: 'Estos vendedores pagaron para mostrar sus productos en este bloque. Lo demás del feed no es publicidad. Comprar un producto patrocinado funciona igual: tu pago queda en custodia hasta que recibas.',
    ok: 'Entendido',
    promote: 'Promocionar este producto',
    promoteText: 'Pronto podrás promocionar tus productos: aparecerán en el bloque Patrocinado de Comprar, donde los ven más compradores. Por ahora no se cobra nada y no tienes que hacer nada.',
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
