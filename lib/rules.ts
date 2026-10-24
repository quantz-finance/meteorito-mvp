// "Cómo funciona Meteorito": las reglas en UN solo lugar. La pantalla /como-funciona, los resúmenes de una línea
// (pago y Vender) y, más adelante, el tour guiado leen de aquí. Lenguaje simple, en tuteo.
// Algunas capas (cancelar a los 3 días, 48 h para responder, reclamos a 30 días) llegan en PRs siguientes:
// sus valores viven en RULES_CONFIG para cambiarlos en un solo lugar.
import type { IconName } from '@/components/ds';

export const RULES_CONFIG = {
  /** Días tras el envío para liberar el pago si el comprador no da el código ni reporta un problema. */
  autoReleaseDays: 7,
  /** Días que tiene el vendedor para enviar antes de que el comprador pueda cancelar y recibir su reembolso. */
  sellerShipDays: 3,
  /** Horas que tiene el vendedor para responder una disputa con pruebas. */
  sellerReplyHours: 48,
  /** Días después de la liberación en los que el comprador todavía puede reportar un problema. */
  claimDays: 30,
} as const;
const C = RULES_CONFIG;

export const RULES_ROUTE = '/como-funciona' as const;
export const RULES_TITLE = 'Cómo funciona Meteorito';
export const RULES_INTRO = 'Son las mismas reglas para quien compra y para quien vende. Léelas una vez y compra o vende con calma.';

export interface Rule { id: string; icon: IconName; title: string; text: string; points?: string[] }
export const RULES: Rule[] = [
  { id: 'custodia', icon: 'lock-closed', title: 'Pago en custodia',
    text: 'Cuando el comprador paga, el dinero queda apartado en un contrato y nadie lo toca hasta que se cumple el trato.' },
  { id: 'envio', icon: 'paper-plane', title: 'Envío',
    text: 'El vendedor toca "Ya lo envié" y puede adjuntar una foto del paquete o del comprobante.' },
  { id: 'codigo', icon: 'key', title: 'Código de entrega',
    text: 'El comprador ve su código cuando el pedido va en camino. Al recibirlo, se lo da al vendedor: con ese código se libera el pago.' },
  { id: 'liberacion', icon: 'timer-outline', title: 'Liberación automática',
    text: `Si el comprador no da el código ni reporta un problema, el pago se libera al vendedor a los ${C.autoReleaseDays} días del envío.` },
  { id: 'problemas', icon: 'alert-circle', title: 'Problemas o disputas',
    text: 'El comprador puede reportar un problema antes de que se libere el pago. Eso congela el dinero.',
    points: [
      'Si el vendedor no envió nada y no llegó, el dinero se le devuelve al comprador.',
      `Si el vendedor no envía en ${C.sellerShipDays} días, el comprador puede cancelar y recibir su reembolso.`,
      `El vendedor tiene ${C.sellerReplyHours} h para responder con pruebas. Si no responde, se le da la razón al comprador.`,
      'Si las versiones son distintas, el equipo revisa el caso con ayuda de IA y una persona decide.',
    ] },
  { id: 'reclamos', icon: 'ribbon-outline', title: `Reclamos hasta ${C.claimDays} días después`,
    text: `Hasta ${C.claimDays} días después de la liberación, el comprador puede reportar un problema. El vendedor recibe el aviso y el caso cuenta en su calificación. El dinero ya no se congela.` },
  { id: 'contacto', icon: 'logo-whatsapp', title: 'Contacto',
    text: 'Después de pagar, el comprador puede escribirle al vendedor por WhatsApp para coordinar el envío.' },
];

/** Resumen de una línea en /p/<slug> antes de pagar. */
export const PAY_SUMMARY = 'Tu dinero queda en custodia hasta que recibas tu compra.';
/** Resumen de una línea en Vender al crear el link. */
export const SELL_SUMMARY = `El pago se libera con el código de entrega o a los ${C.autoReleaseDays} días.`;

/** Aviso de beta (texto EXACTO, aprobado por Rolando): "línea discreta donde importa" (pago antes del botón, Vender,
 *  hoja del PIN y hoja de disputa), nunca como banner en todas las pantallas. Es la ÚNICA mención de "testnet" permitida
 *  en la UI: los e2e que prohíben etiquetas de prueba quitan exactamente esta constante antes de revisar (e2e/helpers.ts). */
export const BETA_NOTICE = 'Beta en testnet, sin dinero real. Meteorito no verifica el producto.';
export const BETA_NOTICE_LINK = 'Ver cómo funciona';

/** Hook del tour guiado (PR siguiente). Apagado: la pantalla no muestra "Ver recorrido" hasta que exista. */
export const TOUR: { enabled: boolean; start: (() => void) | null } = { enabled: false, start: null };
