// Contenido educativo (onboarding / login / ayuda). Regla legal: NO usar seguro/protegido/garantía/garantizado (ni derivados).
// scripts/ci/t29-learn-copy.test.ts lo verifica. Mantener claro, breve y honesto sobre qué es testnet y quién controla qué.
export interface LearnItem { id: string; icon: string; title: string; summary: string; points: string[] }

export const BETA_NOTE = 'Versión beta de pruebas (testnet): no se mueve dinero real.';

export const LEARN: LearnItem[] = [
  {
    id: 'cavos', icon: 'key-outline', title: '¿Qué es tu cuenta Cavos?',
    summary: 'Entras con Google, Apple o correo y Cavos crea por ti una billetera en la red Stellar. No hay que escribir contraseñas ni frases secretas.',
    points: [
      'La llave de tu billetera se guarda en este dispositivo y navegador. Meteorito no la tiene.',
      'Si borras los datos del navegador o cambias de dispositivo, necesitas un respaldo (passkey) para recuperar el acceso.',
      'Para comprar con un link no necesitas cuenta: solo quien vende entra con Cavos.',
    ],
  },
  {
    id: 'quien', icon: 'git-compare-outline', title: '¿Quién controla qué?',
    summary: 'Tres partes, cada una con un rol distinto.',
    points: [
      'Tú: tu billetera y su llave. Nadie más firma por ti con ella.',
      'Cavos: el inicio de sesión y el servicio de billetera.',
      'Meteorito: crea el contrato de custodia, activa tu cuenta, paga las comisiones de red y, en esta beta, opera los roles de aprobar y liberar el pago. Por eso todavía no es 100 % sin intermediarios.',
    ],
  },
  {
    id: 'custodia', icon: 'lock-closed-outline', title: '¿Qué es la custodia en blockchain?',
    summary: 'El pago no va directo al vendedor: lo retiene un contrato (escrow) en la blockchain hasta que se cumplan las condiciones.',
    points: [
      'El comprador paga y el dinero queda retenido en el contrato. El vendedor aún no lo recibe.',
      'Cuando el comprador recibe y revisa el producto, da su PIN y se libera el pago. Si nadie reporta nada, se libera solo al vencer el plazo.',
      'Si hay un problema, se abre una disputa y el pago queda en pausa mientras el equipo la revisa.',
      'Cualquiera puede ver el contrato y sus movimientos en el explorador de Stellar (los links aparecen en cada pedido).',
    ],
  },
  {
    id: 'testnet', icon: 'flask-outline', title: 'Esto es una prueba (testnet)',
    summary: 'Meteorito corre en la red de pruebas de Stellar.',
    points: [
      'Los USDC de prueba no tienen valor y el SINPE Móvil es simulado.',
      'No uses dinero real ni llaves de la red principal.',
      'Es una beta: puede haber errores y los textos legales están en revisión.',
    ],
  },
];
