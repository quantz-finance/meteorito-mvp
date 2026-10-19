// Refresco de pedidos del vendedor: lógica pura (testeable sin React).
export const FINAL_STATUSES = ['liberado', 'resuelto', 'cancelado'] as const;
export const POLL_MS = 7000; // ~5-10 s mientras haya pedidos no finales

export const isFinalStatus = (s: string) => (FINAL_STATUSES as readonly string[]).includes(s);

/** Hay que seguir consultando si algún pedido aún puede cambiar de estado. */
export const needsPolling = (orders: { status: string }[] | null | undefined) =>
  !!orders && orders.some((o) => !isFinalStatus(o.status));
