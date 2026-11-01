// "Cómo funciona Meteorito": las reglas en UN solo lugar. La pantalla /como-funciona, los resúmenes de una línea
// (pago y Vender) y el tour guiado (lib/tour.ts) leen de aquí. Lenguaje simple, en tuteo.
// Reglas con texto legal APROBADO (LEGAL_RULES): rigen solo para pedidos creados con su versión (orders.rules_version,
// api/_lib/orderRules.ts) y se muestran desde aquí en /como-funciona, la hoja "Al pagar aceptas" (antes de pagar) y el
// acuerdo de la beta en Vender (antes de publicar). Texto EXACTO fijado por scripts/ci/t98-reglas-texto.test.ts.
import type { IconName } from '@/components/ds';
import { startTour } from './tour';
import { CLAIM_DAYS, CURRENT_RULES_VERSION, RULE_VERSION, SELLER_REPLY_RULE_HOURS, SHIP_AUTO_REFUND_EXTRA_DAYS, SHIP_DAYS, rulesVersionOf } from '../api/_lib/orderRules';

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
  sellerShipDays: SHIP_DAYS,
  /** Días extra sin envío ni cancelación para que el reembolso se haga solo. */
  autoRefundExtraDays: SHIP_AUTO_REFUND_EXTRA_DAYS,
  /** Horas que tiene el vendedor para responder una disputa con pruebas. */
  sellerReplyHours: SELLER_REPLY_RULE_HOURS,
  /** Días después de la liberación en los que el comprador todavía puede reportar un problema. */
  claimDays: CLAIM_DAYS,
} as const;
const C = RULES_CONFIG;

export const RULES_ROUTE = '/como-funciona' as const;
export const RULES_TITLE = 'Cómo funciona Meteorito';
export const RULES_INTRO = 'Son las mismas reglas para quien compra y para quien vende. Léelas una vez y compra o vende con calma.';

/* ---------- Reglas con texto legal aprobado (EXACTO: no editar sin revisión legal) ---------- */
export type LegalRuleId = 'reembolso_sin_envio' | 'respuesta_48h' | 'reclamo_30_dias';
export interface LegalRule { id: LegalRuleId; version: number; icon: IconName; title: string; text: string;
  /** Solo pedidos con envío (cara a cara no tiene paso de envío). */
  shippingOnly?: boolean }
/** Reembolso si no se envía (v1). */
export const SHIP_REFUND_RULE = "Si quien vende no marca 'Ya lo envié' en 3 días, puedes cancelar y recibes todo tu pago de vuelta desde la custodia. Si no cancelas y pasan 2 días más sin envío, el reembolso se hace solo.";
/** Respuesta del vendedor en 48 h (v2). */
export const DISPUTE_REPLY_RULE = 'Si abres una disputa, quien vende tiene 48 h para responder. Mientras tanto, el pago sigue en custodia. Si no responde, se te reembolsa desde la custodia. Si responde, una persona del equipo revisa las dos versiones y decide.';
/** Período de reclamo de 30 días (v3). */
export const CLAIM_RULE = 'Después de liberado el pago tienes 30 días para reportar un problema con la compra. Quien vende puede responder y el reporte queda en su historial. En esta etapa Meteorito no devuelve el pago, y tus derechos frente a quien vende se mantienen.';
export const LEGAL_RULES: LegalRule[] = [
  { id: 'reembolso_sin_envio', version: RULE_VERSION.shipRefund, icon: 'arrow-undo-outline', title: 'Reembolso si no se envía', text: SHIP_REFUND_RULE, shippingOnly: true },
  { id: 'respuesta_48h', version: RULE_VERSION.sellerReply, icon: 'chatbubbles-outline', title: 'Respuesta de quien vende en 48 h', text: DISPUTE_REPLY_RULE },
  { id: 'reclamo_30_dias', version: RULE_VERSION.claims, icon: 'flag-outline', title: 'Reportes hasta 30 días después', text: CLAIM_RULE },
];
export const legalRule = (id: LegalRuleId) => LEGAL_RULES.find((r) => r.id === id)!;
/** Reglas vigentes al publicar (acuerdo de la beta en Vender): las de la versión actual. */
export const currentLegalRules = (mode?: string | null) => LEGAL_RULES.filter((r) => r.version <= CURRENT_RULES_VERSION && !(r.shippingOnly && mode === 'cara_a_cara'));
/** Reglas que rigen para ESTE pedido (su versión y su tipo de entrega). Pedidos viejos (versión 0): ninguna. */
export const legalRulesFor = (o: { rules_version?: number | null; delivery_mode?: string | null } | null | undefined) =>
  LEGAL_RULES.filter((r) => rulesVersionOf(o) >= r.version && !(r.shippingOnly && o?.delivery_mode === 'cara_a_cara'));
/** Acuerdo de la beta para vender (hoja antes de publicar). */
export const SELLER_AGREEMENT_TITLE = 'Antes de publicar';
export const SELLER_AGREEMENT_INTRO = 'Estas reglas rigen para las ventas que publiques desde ahora. Quien compra las ve antes de pagar.';
export const SELLER_AGREEMENT_ACCEPT = 'Acepto y publico';
/** Hoja "Al pagar aceptas": encabezado de las reglas del pedido. */
export const PAY_RULES_HEADING = 'Reglas de esta compra';
export { CURRENT_RULES_VERSION };

export interface Rule { id: string; icon: IconName; title: string; text: string; points?: string[] }
export const RULES: Rule[] = [
  { id: 'custodia', icon: 'lock-closed', title: 'Pago en custodia',
    text: 'Cuando el comprador paga, el dinero queda apartado en un contrato y nadie lo toca hasta que se cumple el trato.' },
  { id: 'envio', icon: 'paper-plane', title: 'Envío',
    text: 'Al crear el link, el vendedor elige cara a cara o envío. Con envío, toca "Ya lo envié" y puede adjuntar una foto del paquete o del comprobante. Cara a cara no hay paso de envío.' },
  { id: 'codigo', icon: 'key', title: 'Código de entrega',
    text: 'Con envío, el comprador ve su código cuando el pedido va en camino. Cara a cara, lo ve apenas paga y se lo da al vendedor cuando revisa el producto. Con ese código se libera el pago.' },
  { id: 'liberacion', icon: 'timer-outline', title: 'Liberación automática',
    // Texto final aprobado por Neo. Verificado con el código: envío 7 días por defecto (DEFAULT_PROTECTION_MIN), de 24 h a 30 días;
    // cualquiera de las dos partes puede pedir la extensión (api/escrow/confirm.ts). No quitar "aunque todavía no te haya llegado el producto".
    text: `Liberación por tiempo: quien vende elige el plazo (${C.minWindowHours} h, 3 días, ${C.autoReleaseDays} días u otro de hasta ${C.maxWindowDays} días; por defecto, ${C.autoReleaseDays} días), que empieza a contar cuando marca el pedido como enviado. Ese plazo se puede extender. El pago puede liberarse desde ${C.minWindowHours} h después de marcado el envío, aunque todavía no te haya llegado el producto. Si algo no cuadra, abre la disputa antes de que se cumpla el plazo: con la disputa abierta, el pago queda en pausa, no se libera solo y se revisa a mano.`,
    points: [
      `El vendedor elige el plazo al crear el link, de ${C.minWindowHours} h a ${C.maxWindowDays} días. El comprador lo ve antes de pagar.`,
      `Cualquiera de los dos puede pedir ${C.extensionDays.join(', ').replace(/, (\d+)$/, ' o $1')} días más; el otro acepta o rechaza. Nunca más de ${C.maxWindowDays} días desde el pago.`,
      'Mientras una extensión espera respuesta, el pago no se libera solo (hasta 24 h).',
    ] },
  ...LEGAL_RULES.filter((r) => r.id === 'reembolso_sin_envio').map((r) => ({ id: r.id, icon: r.icon, title: r.title, text: r.text })),
  { id: 'problemas', icon: 'alert-circle', title: 'Problemas o disputas',
    text: 'El comprador puede reportar un problema antes de que se libere el pago. Eso congela el dinero.',
    points: [
      'Si el vendedor no envió nada y no llegó, el dinero se le devuelve al comprador.',
      'Al abrir la disputa cuentas tu versión y tomas fotos con la cámara.',
      'Si las versiones son distintas, el equipo revisa el caso con ayuda de IA y una persona decide.',
    ] },
  ...LEGAL_RULES.filter((r) => r.id === 'respuesta_48h').map((r) => ({ id: r.id, icon: r.icon, title: r.title, text: r.text })),
  ...LEGAL_RULES.filter((r) => r.id === 'reclamo_30_dias').map((r) => ({ id: r.id, icon: r.icon, title: r.title, text: r.text })),
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

/** Tour guiado (lib/tour.ts + components/Tour.tsx): activo. "Ver recorrido" en Cómo funciona y Mi cuenta. */
export const TOUR: { enabled: boolean; start: (() => void) | null } = { enabled: true, start: () => startTour('button') };
