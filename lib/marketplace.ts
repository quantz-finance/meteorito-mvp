// Marketplace (feed de publicaciones, buscador, filtro de identidad confirmada y tiendas de otros vendedores): oculto en la
// UI. La app tiene dos secciones: Comprar (el comprador crea el link para el vendedor) y Vender. El código sigue aquí y las
// URLs directas (/p/<slug>, /t/<tienda>) siguen funcionando; solo nada las enlaza desde la navegación principal.
// Para volver a mostrarlo: true (y los tests del feed vuelven a correr).
export const MARKETPLACE_VISIBLE = false as boolean;
