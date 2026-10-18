// Textos legales BORRADOR (pendientes de revisión legal). Español neutro.
// Redacción prudente: describe lo que el código hace hoy (sin verificación de IMEI/iCloud, disputas resueltas por el equipo).
export const QUANTZ_URL = 'https://quantz.finance';
export const CONTACT_EMAIL = 'team@meteorito.app';
export const LEGAL_UPDATED = '12 de octubre de 2026';

type Doc = { title: string; sections: { h: string; p: string[] }[] };
const BASE_LEGAL: Record<'privacidad' | 'terminos', Doc> = {
  privacidad: {
    title: 'Política de privacidad',
    sections: [
      { h: 'Quiénes somos', p: ['Meteorito es un producto de Quantz (quantz.finance), con sede en Costa Rica. Esta política explica qué datos tratamos y por qué, conforme a la Ley N.º 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales.'] },
      { h: 'Modo prueba (testnet)', p: ['Hoy Meteorito funciona en la red de pruebas de Stellar. No se mueve dinero real y los saldos no tienen valor.'] },
      { h: 'Inicio de sesión', p: ['Usamos Cavos para iniciar sesión con Google, Apple o correo. Cavos nos entrega un identificador de cuenta y tu correo. Tus llaves las custodia Cavos en tu dispositivo y su bóveda: Meteorito no tiene acceso a ellas.'] },
      { h: 'Pagos y escrow', p: ['Los pagos quedan apartados en un contrato de escrow de Trustless Work sobre la red Stellar. Los fondos no quedan en una cuenta de Meteorito, sino en el contrato; sin embargo, algunos roles del contrato (aprobar y liberar el pago, y resolver disputas) los opera Meteorito, por lo que no es un esquema sin intermediarios. El pago se libera cuando el vendedor ingresa el PIN que el comprador le entrega, cuando vence el plazo de liberación automática o cuando el equipo resuelve una disputa. Las transacciones en Stellar son públicas por naturaleza.'] },
      { h: 'Datos que recopilamos', p: [
        'Cuenta: identificador de Cavos, correo y dirección de tu billetera de prueba.',
        'Publicaciones: categoría, marca, modelo, estado, precio, descripción, fotos e identificador del equipo (IMEI o número de serie) que tú ingresas.',
        'Fotos: se guardan en Supabase (almacenamiento) y se muestran en el link de venta.',
        'Pedidos y disputas: estados, fechas, motivo y evidencia que adjuntes.',
      ] },
      { h: 'Analítica de uso (PostHog)', p: [
        'Usamos PostHog para medir cómo se usa la app (pantallas vistas, pasos completados, errores) y para reportar métricas agregadas del negocio.',
        'No enviamos tu correo, teléfono, IMEI, dirección de billetera ni llaves. Te identificamos con un código seudónimo (un hash de tu identificador de cuenta). No grabamos tu pantalla ni tus sesiones. Los montos se registran en rangos o de forma no ligada a tu persona.',
        'Puedes desactivar la analítica en cualquier momento desde Mi cuenta > Analítica de uso.',
      ] },
      { h: 'Para qué usamos los datos', p: ['Para operar el pago seguro, prevenir fraude, resolver disputas, mejorar la app y elaborar estadísticas agregadas. No vendemos tus datos.'] },
      { h: 'Tus derechos', p: ['Según la Ley 8968 tienes derecho de acceso, rectificación, cancelación y oposición (derechos ARCO), y a revocar tu consentimiento. Escríbenos a ' + CONTACT_EMAIL + '.'] },
      { h: 'Proveedores', p: ['Cavos (inicio de sesión y billetera), Trustless Work y Stellar (escrow), Supabase (base de datos y fotos), Vercel (hosting) y PostHog (analítica). Algunos procesan datos fuera de Costa Rica.'] },
      { h: 'Contacto', p: [CONTACT_EMAIL + ' · quantz.finance'] },
    ],
  },
  terminos: {
    title: 'Términos de uso',
    sections: [
      { h: 'El servicio', p: ['Meteorito ofrece links de "Pagá seguro" para compras entre personas: el pago queda apartado en escrow y se libera al vendedor cuando el comprador confirma la entrega.'] },
      { h: 'Modo prueba', p: ['El servicio está en fase de pruebas en la testnet de Stellar. No uses Meteorito para operaciones con dinero real hasta que lo anunciemos.'] },
      { h: 'Escrow', p: ['Los fondos quedan en un contrato de escrow de Trustless Work en Stellar, no en una cuenta de Meteorito. Meteorito opera los roles del contrato que aprueban y liberan el pago, así que no es un esquema totalmente descentralizado. El PIN de entrega lo recibe el comprador y lo ingresa el vendedor para cobrar; si nadie reclama, el pago se libera automáticamente al vencer el plazo, o por resolución de una disputa.'] },
      { h: 'Tus responsabilidades', p: ['Vendedores: publicar información veraz del producto (el IMEI o serie y el estado de iCloud son datos que declarás vos; Meteorito no los verifica) y no vender artículos robados o ilegales. Compradores: revisar el equipo al recibirlo y dar tu PIN solo cuando lo tengas en la mano y estés conforme.'] },
      { h: 'Disputas', p: ['Si algo sale mal antes de liberar el pago puedes abrir una disputa con evidencia. La disputa se registra en el contrato y el equipo de Meteorito la revisa y resuelve manualmente; no es una decisión automática.'] },
      { h: 'Limitación', p: ['Meteorito no es parte de la compraventa ni garantiza los productos. Durante la fase de pruebas el servicio se ofrece "tal cual".'] },
      { h: 'Contacto', p: [CONTACT_EMAIL + ' · quantz.finance'] },
    ],
  },
};

export const LEGAL = BASE_LEGAL;
