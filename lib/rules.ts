// "Cómo funciona Meteorito": las reglas en UN solo lugar. La pantalla /como-funciona, los resúmenes de una línea
// (pago y Vender) y, más adelante, el tour guiado leen de aquí. Lenguaje simple, en tuteo.
// Algunas capas (cancelar a los 3 días, 48 h para responder, reclamos a 30 días) llegan en PRs siguientes:
// sus valores viven en RULES_CONFIG para cambiarlos en un solo lugar.
import type { IconName } from '@/components/ds';

export const RULES_CONFIG = {
  /** Días tras el envío para liberar el pago si el comprador no da el código ni reporta un problema. */
  autoReleaseDays: 7,
  /** Cara a cara: horas desde el pago (default) para liberar si el comprador no da el código ni reporta un problema. */
  faceToFaceHours: 24,
  /** Plazo que el vendedor puede acordar al crear el link: de 24 h a 30 días (validado en el servidor). */
  minWindowHours: 24,
  maxWindowDays: 30,
  /** Extensión de mutuo acuerdo: días que se pueden pedir; el total desde el pago nunca pasa de maxWindowDays. */
  extensionDays: [1, 3, 7],
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
    text: 'Al crear el link, el vendedor elige cara a cara o envío. Con envío, toca "Ya lo envié" y puede adjuntar una foto del paquete o del comprobante. Cara a cara no hay paso de envío.' },
  { id: 'codigo', icon: 'key', title: 'Código de entrega',
    text: 'Con envío, el comprador ve su código cuando el pedido va en camino. Cara a cara, lo ve apenas paga y se lo da al vendedor cuando revisa el producto. Con ese código se libera el pago.' },
  { id: 'liberacion', icon: 'timer-outline', title: 'Liberación automática',
    // Texto aprobado por Neo, ajustado al código: plazos 24 h/3/7 días u otro hasta 30; cara a cara cuenta desde el pago
    // (24 h por defecto); el mínimo en producción es 24 h (nunca "poco después" del envío).
    text: `Liberación por tiempo: quien vende elige el plazo (${C.minWindowHours} h, 3 días, ${C.autoReleaseDays} días u otro hasta ${C.maxWindowDays} días; por defecto, ${C.autoReleaseDays} días) y empieza a contar cuando marca el pedido como enviado (cara a cara, desde el pago; por defecto, ${C.faceToFaceHours} h). Ese plazo se puede extender. En la beta, la liberación por tiempo puede pasar desde ${C.minWindowHours} h después de que quien vende marca el pedido como enviado. Si algo no cuadra, abre la disputa antes de que se cumpla el plazo: con la disputa abierta, el pago queda en pausa, no se libera solo y se revisa a mano.`,
    points: [
      `El vendedor elige el plazo al crear el link, de ${C.minWindowHours} h a ${C.maxWindowDays} días. El comprador lo ve antes de pagar.`,
      `Cualquiera de los dos puede pedir ${C.extensionDays.join(', ').replace(/, (\d+)$/, ' o $1')} días más; el otro acepta o rechaza. Nunca más de ${C.maxWindowDays} días desde el pago.`,
      'Mientras una extensión espera respuesta, el pago no se libera solo (hasta 24 h).',
    ] },
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
    text: 'Después de pagar, el comprador puede escribirle al vendedor por WhatsApp para coordinar el envío o la entrega.' },
];

/** Resumen de una línea en /p/<slug> antes de pagar. */
export const PAY_SUMMARY = 'Tu dinero queda en custodia hasta que recibas tu compra.';
/** Resumen de una línea en Vender al crear el link. */
export const SELL_SUMMARY = 'El pago se libera con el código de entrega o al terminar el plazo que elijas.';

/** Aviso de beta (texto EXACTO, aprobado por Rolando): "línea discreta donde importa" (pago antes del botón, Vender,
 *  hoja del PIN y hoja de disputa), nunca como banner en todas las pantallas. Es la ÚNICA mención de "testnet" permitida
 *  en la UI: los e2e que prohíben etiquetas de prueba quitan exactamente esta constante antes de revisar (e2e/helpers.ts). */
export const BETA_NOTICE = 'Beta en testnet, sin dinero real. Meteorito no verifica el producto.';
export const BETA_NOTICE_LINK = 'Ver cómo funciona';
/** Cómo se libera el pago en custodia (texto aprobado por Neo, sin plazo prometido). Va en el pie del producto y, en pedazos,
 *  en las hojas de pago y la nota de liberación. */
export const CUSTODY_RELEASE = 'se libera con tu PIN de entrega, o por tiempo si no abres una disputa antes';
/** Pie del producto antes de pagar (texto EXACTO aprobado por Neo): reemplaza "Protección: 7 días…" y al aviso de beta en
 *  ese lugar, para que "Meteorito no verifica el producto" (aviso legal obligatorio) aparezca UNA sola vez. Como BETA_NOTICE,
 *  es una excepción permitida a la regla "sin testnet" de los e2e (e2e/helpers.ts). */
export const CUSTODY_NOTICE = `Pago en custodia (beta en testnet, sin dinero real): ${CUSTODY_RELEASE}. Meteorito no verifica el producto.`;

/** Hook del tour guiado (PR siguiente). Apagado: la pantalla no muestra "Ver recorrido" hasta que exista. */
export const TOUR: { enabled: boolean; start: (() => void) | null } = { enabled: false, start: null };
