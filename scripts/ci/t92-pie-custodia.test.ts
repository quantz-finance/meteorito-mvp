// (92) Pie del producto (Neo): "Protección: 7 días…" se reemplaza por el texto EXACTO de custodia; "Meteorito no verifica
//      el producto" (aviso legal obligatorio) queda UNA sola vez en el pie; sin "Protección"/"7 días" como promesa de plazo
//      en la UI del comprador/vendedor (pantallas, componentes, copy, plantillas, correos). Admin y código interno quedan fuera.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { CUSTODY_NOTICE, CUSTODY_RELEASE, BETA_NOTICE } from '../../lib/rules';
import { agreementSummary, deliveryPhrase, PROTECTION_RANGE_ERROR } from '../../api/_lib/agreement';
import { adTemplate } from '../../lib/sellerTools';

const read = (f: string) => readFileSync(f, 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const BANNED = /(?<!\p{L})(segur[oa]s?|seguridad|garant\p{L}*|verificad[oa]s?|empresa\p{L}*|fintech|banco\p{L}*|billetera\p{L}*|proteg\p{L}*)(?!\p{L})/iu;
/** Literales visibles: strings sin comentarios. */
const literals = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\/\/[^'"`\n]*$/gm, '');

export async function run(t: T) {
  t.check('texto exacto aprobado (Neo)', CUSTODY_NOTICE === 'Pago en custodia (beta en testnet, sin dinero real): se libera con tu PIN de entrega, o por tiempo si no abres una disputa antes. Meteorito no verifica el producto.', CUSTODY_NOTICE);
  t.check('sin palabras prohibidas en el texto nuevo', !BANNED.test(CUSTODY_NOTICE) && !BANNED.test(PROTECTION_RANGE_ERROR));
  t.check('acuerdo sin "Protección" ni plazo', agreementSummary('envio', 10080) === 'Entrega: Envío' && agreementSummary('cara_a_cara', 1440) === 'Entrega: Cara a cara'
    && deliveryPhrase('envio') === 'entrega por envío' && deliveryPhrase('cara_a_cara') === 'entrega cara a cara');
  t.check('error de plazo (Vender) sin "protección"', PROTECTION_RANGE_ERROR === 'El plazo de liberación debe ser de 24 h a 30 días.');

  const pay = read('components/PayBox.tsx');
  const footer = pay.slice(pay.indexOf("if (order.status === 'creado'"), pay.indexOf('} else if (sinpe'));
  t.check('pie del producto: <BetaNotice custody> una vez y ningún otro aviso con "no verifica"', (footer.match(/<BetaNotice/g) ?? []).length === 1 && footer.includes('<BetaNotice from="pay" custody />'));
  const rl = read('components/RulesLink.tsx');
  t.check('custody muestra CUSTODY_NOTICE EN LUGAR de BETA_NOTICE (no ambos)', /\{custody \? CUSTODY_NOTICE : BETA_NOTICE\}/.test(rl));
  t.check('el aviso legal aparece una sola vez en el texto del pie', CUSTODY_NOTICE.split('Meteorito no verifica el producto').length === 2 && !CUSTODY_NOTICE.includes(BETA_NOTICE));
  t.check('hojas de pago y nota de liberación usan la misma frase (sin "7 días"/"24 h después")',
    (pay.match(/\$\{CUSTODY_RELEASE\}/g) ?? []).length >= 3 && !/7 días después del envío|24 h después del pago|Al pagar aceptas: \$\{agreement\}/.test(pay));
  t.check('frase de liberación = pedazo del texto exacto', CUSTODY_NOTICE.includes(CUSTODY_RELEASE));

  const ad = ['whatsapp', 'marketplace'].map((f) => adTemplate({ title: 'Bici', price_crc: 1000, link: 'x', delivery_mode: 'envio', protection_minutes: 10080 }, f as any)).join('\n');
  t.check('plantillas de anuncio sin "Protección" ni "7 días"', !/Protecci|7 días/.test(ad), ad);

  // Barrido de la UI visible (no admin, sin comentarios). Excepciones: nombre de ley (legal.ts), selector de plazo del vendedor,
  // extensión +1/+3/+7 días y la validez del link de acceso (otros significados), y las reglas detalladas (/como-funciona).
  const ui = [...walk('app'), ...walk('components'), 'lib/copy.ts', 'lib/sellerTools.ts', 'api/_lib/contactText.ts', 'api/_lib/push.ts', 'api/_lib/agreement.ts']
    .filter((f) => /\.(tsx?|ts)$/.test(f) && !/(^|\/)admin(\/|\.)/.test(f));
  const hits = ui.flatMap((f) => literals(read(f)).split('\n').filter((l) => /Protecci|protecci|desde el envío'|7 días (desde|después)/.test(l)).map((l) => `${f}: ${l.trim()}`));
  t.check('UI sin "Protección"/"protección" ni "7 días desde/después" como promesa de plazo', hits.length === 0, hits.join('\n'));
}
