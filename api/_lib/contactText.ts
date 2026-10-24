// Avisos al comprador por WhatsApp / correo / cuenta: textos y validaciones PURAS (sin node:*), compartidas con el cliente.
// Reglas: tuteo, sin emojis, sin palabras vetadas (ver scripts/ci/t85-contacto-comprador.test.ts).
export const CONTACT_CONSENT_VERSION = 'contacto-v1-2026-10-24';
export const CONTACT_CONSENT_TEXT = 'Acepto que Meteorito use este contacto solo para avisarme sobre esta compra.';
export const CONTACT_CHANNELS = ['whatsapp', 'email', 'account'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
/** Copia de lib/rules BETA_NOTICE (el servidor no importa lib/; t85 verifica que sean iguales). */
export const BETA_NOTICE_TEXT = 'Beta en testnet, sin dinero real. Meteorito no verifica el producto.';
export const DEFAULT_COUNTRY_CODE = '+506';
/** Vida del link de acceso que viaja en cada aviso, y del permiso que deja en el dispositivo que lo abre. */
export const ACCESS_LINK_DAYS = 7;
export const ACCESS_GRANT_DAYS = 120;

/** +CC y número -> E.164 (+50688887777) o null. Costa Rica: 8 dígitos. Resto: 6..14 dígitos y 15 en total como máximo. */
export function normalizePhone(cc: unknown, num: unknown): string | null {
  const c = String(cc ?? '').replace(/[^\d]/g, '');
  let n = String(num ?? '').replace(/[^\d]/g, '');
  if (!/^\d{1,3}$/.test(c) || c.startsWith('0')) return null;
  if (n.startsWith(c) && n.length > 8 && String(num ?? '').trim().startsWith('+')) n = n.slice(c.length); // pegaron +506... en el número
  if (c === '506') return /^[2-8]\d{7}$/.test(n) ? `+506${n}` : null;
  if (!/^\d{6,14}$/.test(n) || c.length + n.length > 15) return null;
  return `+${c}${n}`;
}
export function normalizeEmail(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return e.length <= 254 && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) ? e : null;
}
export const maskPhone = (e164: string) => `${e164.slice(0, e164.length - 8 >= 2 ? e164.length - 8 : 2)} •••• ${e164.slice(-4)}`;
export function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}${'•'.repeat(Math.min(4, Math.max(1, u.length - 1)))}@${d}`;
}

export type NoticeKind = 'acceso' | 'pagado' | 'enviado' | 'por_liberar' | 'liberado' | 'disputa' | 'resuelto';
/** Estado del pedido -> aviso. 'por_liberar' lo dispara el cron (menos de 24 h para la liberación automática). */
export const NOTICE_BY_STATUS: Record<string, NoticeKind> = { fondeado: 'pagado', enviado: 'enviado', liberado: 'liberado', en_disputa: 'disputa', resuelto: 'resuelto' };

export interface NoticeOrder { slug: string; status?: string; brand?: string | null; model?: string | null }
const itemName = (o: NoticeOrder) => (`${o.brand ?? ''} ${o.model ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 60)) || 'tu compra';

const HEAD: Record<NoticeKind, (it: string) => [string, string]> = {
  acceso: (it) => ['Tu acceso a tu compra en Meteorito', `Guardamos este contacto para avisarte sobre ${it}. Con el link de abajo vuelves a tu compra desde cualquier teléfono.`],
  pagado: (it) => ['Tu pago quedó en custodia', `Tu pago de ${it} quedó apartado. Te avisamos cuando el vendedor lo envíe.`],
  enviado: (it) => ['Tu compra va en camino', `El vendedor marcó ${it} como enviado. Cuando lo recibas y esté bien, confírmalo en tu compra.`],
  por_liberar: (it) => ['El pago se libera en menos de 24 h', `Si algo no está bien con ${it}, repórtalo antes de que venza el plazo. Si todo está bien, no tienes que hacer nada.`],
  liberado: (it) => ['Compra completada', `El pago de ${it} se liberó al vendedor. Gracias por comprar con Meteorito.`],
  disputa: (it) => ['Recibimos tu reporte', `Abriste una disputa por ${it}. El equipo la revisa y te avisamos cuando haya una resolución.`],
  resuelto: (it) => ['Tu disputa tiene una resolución', `Ya hay una resolución para ${it}. Ábrela en tu compra.`],
};

/** Las tres formas de seguir la compra: van en TODOS los avisos. */
export function followUpLines(link: string): string[] {
  return [
    `Con tu link de acceso (vale ${ACCESS_LINK_DAYS} días; cada aviso trae uno nuevo): ${link}`,
    'Por WhatsApp: agrega tu número en la página de tu compra y te escribimos por ahí.',
    'Con una cuenta: toca "Crear cuenta" en la página de tu compra y la verás en cualquier teléfono.',
  ];
}

export interface Notice { subject: string; text: string; html: string; whatsapp: string }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Texto del aviso (correo y WhatsApp). Puro: se prueba sin red. `beta` = aviso de beta vigente (lib/constants BETA_NOTICE). */
export function buildNotice(kind: NoticeKind, o: NoticeOrder, link: string, beta: string): Notice {
  const [subject, lead] = HEAD[kind](itemName(o));
  const ways = followUpLines(link);
  const foot = `${beta} Recibes este mensaje porque lo pediste al pagar. Para dejar de recibirlos, responde "baja".`;
  const text = [lead, '', 'Sigue tu compra como prefieras:', ...ways.map((w) => `- ${w}`), '', foot].join('\n');
  const whatsapp = [`Meteorito: ${subject}.`, lead, `Tu compra: ${link}`, 'También puedes crear una cuenta desde ese link para verla en cualquier teléfono.'].join(' ');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#111;max-width:520px">`
    + `<p style="font-size:18px;font-weight:700;margin:0 0 8px">${esc(subject)}</p><p>${esc(lead)}</p>`
    + `<p><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Abrir mi compra</a></p>`
    + `<p style="margin:16px 0 4px;font-weight:600">Sigue tu compra como prefieras:</p><ul style="padding-left:18px;margin:0">`
    + `<li>Con tu link de acceso: vale ${ACCESS_LINK_DAYS} días y cada aviso trae uno nuevo.</li><li>${esc(ways[1])}</li><li>${esc(ways[2])}</li></ul>`
    + `<p style="color:#666;font-size:13px;margin-top:20px">${esc(foot)}</p></div>`;
  return { subject, text, html, whatsapp };
}

/** Link de WhatsApp para que el EQUIPO le escriba al comprador (no hay API de envío): wa.me con el texto listo. */
export const waLink = (e164: string, text: string) => `https://wa.me/${e164.replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`;
