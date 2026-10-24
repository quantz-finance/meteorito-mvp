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
  filters: { confirmed: 'Identidad confirmada', unconfirmed: 'Sin confirmar', all: 'Todos' },
  feed: {
    latest: 'Lo más nuevo', results: 'Resultados', searchLabel: 'Buscar productos', searchPlaceholder: 'Buscar: PlayStation, bici, iPhone…',
    clear: 'Limpiar búsqueda', buy: 'Comprar',
    emptyConfirmedTitle: 'Todavía no hay vendedores con identidad confirmada',
    emptyConfirmedText: 'Aquí verás a los vendedores con identidad confirmada. Mientras tanto, mira todas las publicaciones: con cualquier vendedor tu pago queda en custodia hasta que recibas.',
    seeAll: 'Ver todos',
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
  myStore: { confirmIdentity: 'Confirma tu identidad' },
} as const;

/** Palabras que no pueden aparecer en el copy visible (feed, perfil y reseñas). */
export const BANNED_COPY = /\b(segur[oa]s?|garant[ií]as?|verificad[oa]s?|empresas?|fintech|bancos?|billeteras?)\b/i;
