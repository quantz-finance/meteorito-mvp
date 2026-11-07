// Vendedor SIN cuenta (opción A, solo testnet): textos y reglas puras. Las usan la API y la app. Sin imports de Node.
// Ver docs/vendedor-sin-cuenta.md.
import { DEFAULT_PROTECTION_MIN, type DeliveryMode } from './agreement';

/** Aviso de beta visible ANTES de aceptar (texto exacto pedido; no cambiar sin revisión legal). */
export const SELLER_GUEST_BETA = 'Prueba en testnet: sin dinero real; no transferimos a tu banco.';
/** Qué verificamos y qué no, explicado ANTES de aceptar. */
export const SELLER_GUEST_VERIFY = 'Para aceptar te mandamos un código de 6 dígitos a tu correo. Solo confirma que ese correo es tuyo y deja constancia de que aceptaste este acuerdo; no verifica tu identidad, no pedimos cédula ni tu cuenta bancaria real.';
/** Cómo cobra en esta prueba (cola IBAN simulada). */
export const SELLER_GUEST_PAYOUT = 'Cuenta bancaria (IBAN) · simulación. Al liberarse el pago, el USDC de testnet llega a la cuenta de Meteorito y queda anotado para revisión. No es una transferencia a tu banco.';
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
