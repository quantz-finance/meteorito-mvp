// Textos legales BORRADOR (pendientes de revisión legal). Español neutro.
// Redacción prudente: describe lo que el código hace hoy (sin verificación de IMEI/iCloud, disputas resueltas por el equipo).
import { OTP_TTL_MIN, SELLER_GUEST_CUSTODY, SELLER_GUEST_EXCEPTION, SELLER_GUEST_RETENTION_DAYS, SELLER_NOTICE_UPDATED, SELLER_NOTICE_VERSION, SESSION_DAYS } from '../api/_lib/sellerGuestText';

export const CONTACT_EMAIL = 'team@meteorito.app';
export const LEGAL_UPDATED = '24 de octubre de 2026';
/** Responsable del tratamiento: SOLO los datos que ya están en este archivo. La dirección física no existe en el repo. */
export const CONTROLLER_NAME = 'Rolando Arguello Lizano';
export const CONTROLLER_ADDRESS = '[PENDIENTE: dirección física del responsable, Costa Rica]';
/** Excepción visible para quien vende sin cuenta (prueba): el pago NO llega a su wallet. */
export const SELLER_GUEST_EXCEPTION_LEGAL = 'Excepción (vendedor sin cuenta, prueba): ' + SELLER_GUEST_EXCEPTION;

type Doc = { title: string; updated?: string; version?: string; sections: { h: string; p: string[] }[] };
export type LegalDocId = 'privacidad' | 'terminos' | 'vendedor';
const BASE_LEGAL: Record<LegalDocId, Doc> = {
  privacidad: {
    title: 'Política de privacidad',
    updated: SELLER_NOTICE_UPDATED,
    sections: [
      { h: 'Quiénes somos', p: ['Meteorito es un proyecto de Rolando Arguello Lizano (Costa Rica). Quantz, la empresa que lo operará, aún no está constituida. Esta política explica qué datos tratamos y por qué, conforme a la Ley N.º 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales.'] },
      { h: 'Modo prueba (testnet)', p: ['Hoy Meteorito funciona en la red de pruebas de Stellar. No se mueve dinero real y los saldos no tienen valor.'] },
      { h: 'Inicio de sesión', p: ['Usamos Cavos para iniciar sesión con Google, Apple o correo. Cavos nos entrega un identificador de cuenta y tu correo. Tus llaves las custodia Cavos en tu dispositivo y su bóveda: Meteorito no tiene acceso a ellas.'] },
      { h: 'Pagos y escrow', p: ['Los pagos quedan apartados en un contrato de escrow de Trustless Work sobre la red Stellar. Los fondos no quedan en una cuenta de Meteorito, sino en el contrato; sin embargo, algunos roles del contrato (aprobar y liberar el pago, y resolver disputas) los opera Meteorito, por lo que no es un esquema sin intermediarios. El pago se libera cuando el vendedor ingresa el PIN que el comprador le entrega, cuando vence el plazo de liberación automática o cuando el equipo resuelve una disputa. Las transacciones en Stellar son públicas por naturaleza.', SELLER_GUEST_EXCEPTION_LEGAL] },
      { h: 'Datos que recopilamos', p: [
        'Cuenta: identificador de Cavos, correo y dirección de tu billetera de prueba.',
        'Publicaciones: categoría, marca, modelo, estado, precio, descripción, fotos e identificador del equipo (IMEI o número de serie) que tú ingresas.',
        'Fotos: se guardan en Supabase (almacenamiento) y se muestran en el link de venta.',
        'Pedidos y disputas: estados, fechas, motivo y evidencia que adjuntes.',
        // REVISIÓN LEGAL (Neo): línea del chat (025 + 026). 12 meses desde el último mensaje; con una disputa abierta no se borra y el
        // plazo cuenta desde que se resuelve (chat_purge_old, supabase/migrations/026_chat_retention_dispute.sql).
        'Mensajes del chat: el texto de los mensajes que intercambias con un vendedor o un comprador dentro de Meteorito, con su fecha y hora, si se leyeron y los reportes que hagas. Los guardamos para que puedan coordinar la compra, para revisar reportes de abuso o fraude y como evidencia si se abre una disputa. Solo ven la conversación las dos partes; el equipo de Meteorito la revisa únicamente si alguien la reporta o hay una disputa. Si compras sin cuenta, la conversación queda ligada a la llave de este dispositivo, no a tu nombre. Borramos cada conversación 12 meses después de su último mensaje. Si hay una disputa abierta, no la borramos y los 12 meses empiezan a contar cuando se resuelve.',
        // REVISIÓN LEGAL (Neo): línea NUEVA de avisos al comprador sin cuenta (028), propuesta pendiente de aprobación. Plazo propuesto: 90 días después de cerrar la compra.
        'Avisos de tu compra (opcional): si pagas sin cuenta y eliges recibir avisos, guardamos el número de WhatsApp o el correo que nos des, el texto que aceptaste, su versión y la fecha. Los usamos solo para avisarte sobre esa compra (pago, envío, plazo de liberación, liberación y disputas) y para enviarte un link que te devuelve el acceso a la compra desde otro dispositivo. No se los mostramos al vendedor. Los correos salen por Brevo y los mensajes de WhatsApp los envía el equipo de Meteorito. Si eliges crear una cuenta, ligamos la compra a tu cuenta de Cavos. Borramos el contacto 90 días después de que se cierre la compra, o antes si nos lo pides.',
        'Última conexión (opcional): si la enciendes, quienes ven tu tienda en Meteorito ven cuándo estuviste activo por última vez, de forma aproximada y sin hora exacta (por ejemplo, «En línea» o «Activo hace 3 h»), para que sepan si sueles estar disponible. Está apagada por defecto, registramos cuándo la enciendes o la apagas, y puedes apagarla cuando quieras en Mi cuenta; al apagarla dejamos de mostrarla y borramos la hora guardada.',
      ] },
      { h: 'Si vendes sin cuenta (prueba)', p: ['Si aceptas una invitación de compra sin crear cuenta, tratamos tu correo para mandarte el código, darte acceso a esa venta, recuperarlo y registrar tu aceptación. Tiene su propio aviso: «Aviso de privacidad para quien vende sin cuenta» (/legal/vendedor). Disociamos el correo ' + SELLER_GUEST_RETENTION_DAYS + ' días después de que se cierre la venta.'] },
      { h: 'Analítica de uso (PostHog)', p: [
        'Usamos PostHog para medir cómo se usa la app (pantallas vistas, pasos completados, errores) y para reportar métricas agregadas del negocio.',
        'No enviamos tu correo, teléfono, IMEI, dirección de billetera ni llaves. Te identificamos con un código seudónimo (un hash de tu identificador de cuenta). No grabamos tu pantalla ni tus sesiones. Los montos se registran en rangos o de forma no ligada a tu persona.',
        'Puedes desactivar la analítica en cualquier momento desde Mi cuenta > Analítica de uso.',
      ] },
      { h: 'Para qué usamos los datos', p: ['Para operar el pago en custodia, prevenir fraude, resolver disputas, mejorar la app y elaborar estadísticas agregadas. No vendemos tus datos.'] },
      { h: 'Tus derechos', p: ['Según la Ley 8968 tienes derecho de acceso, rectificación, cancelación y oposición (derechos ARCO), y a revocar tu consentimiento. Escríbenos a ' + CONTACT_EMAIL + '.'] },
      { h: 'Proveedores', p: ['Cavos (inicio de sesión y billetera), Trustless Work y Stellar (escrow), Supabase (base de datos y fotos), Vercel (hosting), PostHog (analítica) y Brevo (correos de avisos de compra y códigos para vender sin cuenta). Algunos procesan datos fuera de Costa Rica.'] },
      { h: 'Contacto', p: [CONTACT_EMAIL] },
    ],
  },
  terminos: {
    title: 'Términos de uso',
    updated: SELLER_NOTICE_UPDATED,
    sections: [
      { h: 'El servicio', p: ['Meteorito ofrece links de pago en custodia para compras entre personas: el pago queda apartado en escrow y se libera al vendedor cuando el comprador confirma la entrega.', SELLER_GUEST_EXCEPTION_LEGAL] },
      { h: 'Modo prueba', p: ['El servicio está en fase de pruebas en la testnet de Stellar. No uses Meteorito para operaciones con dinero real hasta que lo anunciemos.'] },
      { h: 'Escrow', p: ['Los fondos quedan en un contrato de escrow de Trustless Work en Stellar, no en una cuenta de Meteorito. Meteorito opera los roles del contrato que aprueban y liberan el pago, así que no es un esquema totalmente descentralizado. El PIN de entrega lo recibe el comprador y lo ingresa el vendedor para cobrar; si nadie reclama, el pago se libera automáticamente al vencer el plazo, o por resolución de una disputa.', SELLER_GUEST_EXCEPTION_LEGAL + ' ' + SELLER_GUEST_CUSTODY] },
      { h: 'Tus responsabilidades', p: ['Vendedores: publicar información veraz del producto (el IMEI o serie y el estado de iCloud son datos que declaras tú; Meteorito no los verifica) y no vender artículos robados o ilegales. Compradores: revisar el equipo al recibirlo y dar tu PIN solo cuando lo tengas en la mano y estés conforme.'] },
      { h: 'Disputas', p: ['Si algo sale mal antes de liberar el pago puedes abrir una disputa con evidencia. La disputa se registra en el contrato y el equipo de Meteorito la revisa y resuelve manualmente; no es una decisión automática.'] },
      { h: 'Limitación', p: ['Meteorito no es parte de la compraventa ni garantiza los productos ni el resultado de la operación; solo mantiene los fondos apartados en custodia (escrow) hasta la confirmación o resolución. Durante la fase de pruebas el servicio se ofrece "tal cual".'] },
      { h: 'Contacto', p: [CONTACT_EMAIL] },
    ],
  },
  // REVISIÓN LEGAL (Harvey, #155): aviso NUEVO para quien vende sin cuenta. Responsable y contacto: los mismos de la política;
  // la dirección física no existe en el repo (CONTROLLER_ADDRESS es un marcador pendiente).
  vendedor: {
    title: 'Aviso de privacidad para quien vende sin cuenta',
    updated: SELLER_NOTICE_UPDATED,
    version: SELLER_NOTICE_VERSION,
    sections: [
      { h: 'Responsable', p: [`${CONTROLLER_NAME} (Costa Rica), responsable del proyecto Meteorito, trata tus datos conforme a la Ley N.º 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales.`,
        `Dirección: ${CONTROLLER_ADDRESS}`, `Contacto: ${CONTACT_EMAIL}`] },
      { h: 'Cuándo aplica', p: ['Cuando abres el link de una invitación de compra y aceptas vender sin crear cuenta, en la prueba de Meteorito en la red de pruebas de Stellar (sin dinero real). Si entras con tu cuenta, aplica la Política de privacidad general.'] },
      { h: 'Qué datos tratamos', p: [
        'Tu correo: lo guardamos cifrado, junto con un valor derivado (HMAC) para encontrar tu venta sin leer el correo.',
        'Tu autorización: la versión de este aviso, la versión y el texto de la casilla que marcaste y la fecha y hora.',
        `Los códigos de acceso: solo un valor derivado del código (nunca el código), los intentos y la hora; vencen a los ${OTP_TTL_MIN} minutos.`,
        `Tu acceso a la venta: una cookie de este navegador con un identificador al azar; guardamos solo su hash y vence a los ${SESSION_DAYS} días.`,
        'Tu aceptación: el hash del acuerdo que aceptaste (producto, precio, entrega, plazo de reclamo, reglas y cobro simulado), su versión y la fecha.',
        'La venta: estado, fechas, las fotos de envío o de disputa que subas y tus respuestas a un reclamo.',
        'No te pedimos nombre, cédula, teléfono ni tu IBAN real.',
      ] },
      { h: 'Para qué los usamos', p: ['Para mandarte el código de un solo uso (OTP), darte acceso a esta venta, recuperar ese acceso desde otro navegador y dejar constancia de que aceptaste este acuerdo. Nada más: no los usamos para publicidad, no te mandamos boletines y no le mostramos tu correo a quien compra.'] },
      { h: 'Es necesario para este camino', p: ['Sin tu correo y sin marcar la casilla no podemos mandarte el código, así que no puedes aceptar sin cuenta. Puedes no darlo y entrar con tu cuenta.'] },
      { h: 'Proveedores y transferencias', p: ['Brevo envía el correo con el código. Supabase guarda la base de datos (con tu correo cifrado) y las fotos. Vercel aloja la app y el API. Algunos procesan datos fuera de Costa Rica. Las operaciones de la venta quedan en la red de pruebas de Stellar, que es pública, sin tu correo.'] },
      { h: 'Tus derechos', p: [`Según la Ley 8968 tienes derecho de acceso, rectificación, cancelación y oposición (derechos ARCO), y a revocar tu autorización. Escríbenos a ${CONTACT_EMAIL} desde el correo de la venta. Si revocas la autorización con una venta abierta, ya no podremos mandarte códigos de acceso para esa venta. También puedes acudir a la Agencia de Protección de Datos de los Habitantes (PRODHAB).`] },
      { h: 'Cuánto tiempo los guardamos', p: [
        `${SELLER_GUEST_RETENTION_DAYS} días después de que se cierra la venta (pago liberado, disputa resuelta o venta cancelada, sin un reclamo abierto) disociamos tu correo: lo borramos y cambiamos el valor de búsqueda por uno al azar, así que ya no se puede ligar la venta a tu correo. Si pediste un código y no llegaste a aceptar, lo hacemos ${SELLER_GUEST_RETENTION_DAYS} días después del último código. También borramos tus accesos y los códigos que no se usaron.`,
        'Después de eso, la constancia de la aceptación y la autorización quedan solo con hashes, versiones, fechas y datos de la venta, sin tu correo.',
        'Si nos lo pides, lo hacemos antes, siempre que no tengas una venta abierta.',
      ] },
      { h: 'Cómo se cobra en esta prueba', p: [SELLER_GUEST_EXCEPTION, SELLER_GUEST_CUSTODY] },
    ],
  },
};

export const LEGAL = BASE_LEGAL;
