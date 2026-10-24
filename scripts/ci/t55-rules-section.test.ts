// (55) "Cómo funciona Meteorito": reglas en un solo módulo (lib/rules.ts) con valores reutilizables, pantalla pública
//      (sin cuenta), accesos visibles (Mi cuenta, Home, pago antes de pagar y Vender) y copy en tuteo, sin voseo. Sin red.
import { existsSync, readFileSync } from 'node:fs';
import type { T } from './setup';
import { PAY_SUMMARY, RULES, RULES_CONFIG, RULES_ROUTE, SELL_SUMMARY, TOUR } from '../../lib/rules';

const read = (f: string) => readFileSync(f, 'utf8');
const VOSEO = /(?<!\p{L})(?:(pod|ten|quer|sab|vend|compr|pag|necesit|recib|eleg|dec|escrib|pon|pued)(és|ás|ís)|(mir|toc|revis|confirm|pag|guard|esper|cancel|report)á|vos)(?!\p{L})/iu;
const BANNED = /\b(segur[oa]s?|seguridad|proteg\w*|garant\w*)\b/i; // regla legal (t29)

export async function run(t: T) {
  t.check('valores en un solo lugar: 7 días, 3 días, 48 h, 30 días',
    RULES_CONFIG.autoReleaseDays === 7 && RULES_CONFIG.sellerShipDays === 3 && RULES_CONFIG.sellerReplyHours === 48 && RULES_CONFIG.claimDays === 30);
  const ids = RULES.map((r) => r.id).join();
  t.check('7 reglas en orden', ids === 'custodia,envio,codigo,liberacion,problemas,reclamos,contacto', ids);
  t.check('cada regla con icono, título y texto', RULES.every((r) => r.icon && r.title.length > 3 && r.text.length > 20));
  const all = [PAY_SUMMARY, SELL_SUMMARY, ...RULES.flatMap((r) => [r.title, r.text, ...(r.points ?? [])])].join(' | ');
  t.check('los textos usan las constantes (7 días, 3 días, 48 h, 30 días)', /7 días del envío/.test(all) && /3 días/.test(all) && /48 h/.test(all) && /30 días/.test(all));
  t.check('cubre: custodia, "Ya lo envié", código, disputa congela, IA + persona, WhatsApp',
    /custodia/.test(all) && /Ya lo envié/.test(all) && /código de entrega/i.test(all) && /congela/.test(all) && /IA/.test(all) && /una persona decide/.test(all) && /WhatsApp/.test(all));
  t.check('copy en tuteo, sin voseo', !VOSEO.test(all), all.match(VOSEO)?.[0]);
  t.check('sin palabras prohibidas por la regla legal (seguro/protegido/garantía)', !BANNED.test(all), all.match(BANNED)?.[0]);
  t.check('resúmenes de una línea', PAY_SUMMARY === 'Tu dinero queda en custodia hasta que recibas tu compra.' && SELL_SUMMARY === 'El pago se libera con el código de entrega o a los 7 días.');
  t.check('tour guiado: solo un hook apagado', TOUR.enabled === false);

  t.check('pantalla /como-funciona existe y lee lib/rules', RULES_ROUTE === '/como-funciona' && existsSync('app/como-funciona.tsx') && /from '@\/lib\/rules'/.test(read('app/como-funciona.tsx')));
  const screen = read('app/como-funciona.tsx');
  t.check('funciona sin cuenta (no usa sesión ni API) y es ruta pública', !/useAuth|requireCavos|api\(|guestApi|fetch\(/.test(screen) && /segments\[0\] === 'como-funciona'/.test(read('app/_layout.tsx')));
  t.check('botón "Ver recorrido" detrás de TOUR.enabled', /TOUR\.enabled/.test(screen) && /Ver recorrido/.test(screen));
  const pay = read('app/p/[slug].tsx'), sell = read('app/(tabs)/vender.tsx'), home = read('app/(tabs)/pedidos.tsx'), acct = read('components/AccountSheet.tsx');
  t.check('pago: resumen + "Ver reglas" solo antes de pagar', /unpaid\s*\?\s*<RulesHint[^>]*text=\{PAY_SUMMARY\}/.test(pay));
  t.check('Vender: resumen + "Ver reglas" al crear el link', /<RulesHint[^>]*SELL_SUMMARY/.test(sell));
  t.check('Home y Mi cuenta: enlace "Cómo funciona"', /<RulesLink/.test(home) && /<RulesLink/.test(acct));
  const hint = read('components/RulesLink.tsx');
  t.check('RulesHint/RulesLink llevan a /como-funciona con icono y "Ver reglas"', /RULES_ROUTE/.test(hint) && /Ver reglas/.test(hint) && /Cómo funciona/.test(hint) && /<Icon/.test(hint));
}
