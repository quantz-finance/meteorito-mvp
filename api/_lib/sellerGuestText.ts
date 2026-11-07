// Vendedor SIN cuenta (opción A, solo testnet): textos y reglas puras. Las usan la API y la app. Sin imports de Node.
// Ver docs/vendedor-sin-cuenta.md.
import { DEFAULT_PROTECTION_MIN, type DeliveryMode } from './agreement';

/** Aviso de beta visible ANTES de aceptar (texto exacto pedido; no cambiar sin revisión legal). */
export const SELLER_GUEST_BETA = 'Prueba en testnet: sin dinero real; no transferimos a tu banco.';
/** Qué comprobamos y qué no, explicado ANTES de aceptar. */
export const SELLER_GUEST_VERIFY = 'Para aceptar te mandamos un código de 6 dígitos a tu correo. Solo confirma que ese correo es tuyo y deja constancia de que aceptaste este acuerdo; no verifica tu identidad, no pedimos cédula ni tu cuenta bancaria real.';
/** Cómo cobra en esta prueba (cola IBAN simulada). */
export const SELLER_GUEST_PAYOUT = 'Simulación: el IBAN es un dato de ejemplo y no se usa para pagar.';
/** Excepción a "el pago se libera al vendedor / no queda en una cuenta de Meteorito" (texto exacto de la revisión de Harvey). */
export const SELLER_GUEST_EXCEPTION = 'En esta prueba, Meteorito opera el rol serviceProvider mediante su backend. Al liberarse, los tokens de prueba llegan a una wallet de la plataforma, no a la del vendedor. El cobro es simulado: no hay transferencia bancaria ni dinero real.';
/** La custodia hasta la liberación sigue igual que en el resto de Meteorito. */
export const SELLER_GUEST_CUSTODY = 'Hasta que se libera, el pago queda apartado en el contrato de escrow de Trustless Work (red de pruebas de Stellar), no en una cuenta de Meteorito, y solo se mueve según las reglas de esta venta.';

// ---- Privacidad del vendedor sin cuenta (migración 039; aviso en lib/legal.ts LEGAL.vendedor, ruta /legal/vendedor) ----
/** Consentimiento del tratamiento del correo (texto exacto; separado de la aceptación comercial). Cambiar el texto = subir la versión. */
export const SELLER_GUEST_CONSENT_TEXT = 'Autorizo el tratamiento de mi correo para verificar acceso y registrar mi aceptación, según el aviso de privacidad. No incluye publicidad.';
export const SELLER_GUEST_CONSENT_VERSION = 'vendedor-correo-v3';
/** Versión del aviso de privacidad para quien vende sin cuenta (LEGAL.vendedor). */
export const SELLER_NOTICE_VERSION = 'aviso-vendedor-2026-11-07-v3';
export const SELLER_NOTICE_UPDATED = '7 de noviembre de 2026';
/** Umbral de elegibilidad de la purga MANUAL; no es un plazo de eliminación automática ni agendada. */
export const SELLER_GUEST_RETENTION_DAYS = 90;
export const SELLER_GUEST_RECEIPT = 'Constancia de acuerdo y pago; no es factura fiscal.';
/** Prefijo del vendedor sin cuenta en seller_user_id: nunca coincide con un sub de Cavos ni con un comprador invitado. */
export const SELLER_GUEST_PREFIX = 'seller_guest:';
export const isSellerGuestSub = (s: unknown) => typeof s === 'string' && s.startsWith(SELLER_GUEST_PREFIX);
export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_DAYS = 60;

/** Plazo de protección que aplica al aceptar sin cuenta: el default del tipo de entrega (envío 7 días, cara a cara 24 h). */
export const guestProtection = (mode: DeliveryMode) => DEFAULT_PROTECTION_MIN[mode];
export function protectionText(mode: DeliveryMode): string {
  return mode === 'cara_a_cara'
    ? 'Cara a cara: cuando se vean, quien compra revisa el producto y te da su código. Si no confirma, el pago se libera solo 24 h después de pagar, salvo que abra un reclamo.'
    : "Envío: después de pagar marcas 'Ya lo envié' con la foto del paquete. El pago se libera cuando quien compra confirma o, si no reclama, 7 días después de tu envío.";
}
