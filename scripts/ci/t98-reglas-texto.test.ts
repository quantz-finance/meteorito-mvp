// (98) Reglas con texto legal aprobado (lib/rules.ts LEGAL_RULES): texto EXACTO fijado aquí (como t56). No cambiar sin
//      revisión legal. Cubre:
//  - Copy exacto de cada regla, tuteo y sin palabras prohibidas (seguro, garantía, verificado, proteg*, empresa,
//    fintech, banco, billetera) en las reglas y en el copy nuevo de la UI y los avisos.
//  - Un solo lugar: el texto vive SOLO en lib/rules.ts y se renderiza desde ahí en /como-funciona, la hoja "Al pagar
//    aceptas" (método y SINPE, antes de pagar) y el acuerdo de la beta en Vender (antes de publicar).
//  - Versión por pedido: solo los pedidos con rules_version >= la de la regla la muestran (nada retroactivo).
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { CURRENT_RULES_VERSION, LEGAL_RULES, PAY_RULES_HEADING, RULES, SELLER_AGREEMENT_ACCEPT, SELLER_AGREEMENT_INTRO, SELLER_AGREEMENT_TITLE, currentLegalRules, legalRulesFor } from '../../lib/rules';
import { SHIP_REMINDER_TEXT } from '../../api/_lib/orderRules';
import { claimMessages, replyRuleMessages, shipRuleMessages } from '../../api/_lib/push';

/** Texto aprobado. EXACTO. */
export const APPROVED: Record<string, { version: number; title: string; text: string }> = {
  reembolso_sin_envio: { version: 1, title: 'Reembolso si no se envía',
    text: "Si quien vende no marca 'Ya lo envié' en 3 días, puedes cancelar y recibes todo tu pago de vuelta desde la custodia. Si no cancelas y pasan 2 días más sin envío, el reembolso se hace solo." },
  respuesta_48h: { version: 2, title: 'Respuesta de quien vende en 48 h',
    text: 'Si abres una disputa, quien vende tiene 48 h para responder. Mientras tanto, el pago sigue en custodia. Si no responde, se te reembolsa desde la custodia. Si responde, una persona del equipo revisa las dos versiones y decide.' },
  reclamo_30_dias: { version: 3, title: 'Reportes hasta 30 días después',
    text: 'Después de liberado el pago tienes 30 días para reportar un problema con la compra. Quien vende puede responder y el reporte queda en su historial. En esta etapa Meteorito no devuelve el pago, y tus derechos frente a quien vende se mantienen.' },
};
export const BANNED = /(?<!\p{L})(segur[oa]s?|garant\p{L}*|verificad[oa]s?|proteg\p{L}*|protecci\p{L}*|empresas?|fintech|bancos?|bancari\p{L}*|billeteras?)(?!\p{L})/iu;
const VOSEO = /(?<!\p{L})(pod|ten|quer|sab|pued|recib)(és|ás|ís)(?!\p{L})|(?<!\p{L})vos(?!\p{L})/iu;
const read = (f: string) => readFileSync(f, 'utf8');
/** Literales de texto de un archivo (sin comentarios). */
const literals = (src: string) => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  return [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((s) => /\p{L}{3}/u.test(s));
};

export async function run(t: T) {
  /* ---------- Copy exacto ---------- */
  const ids = LEGAL_RULES.map((r) => r.id).sort().join();
  t.check('reglas legales: exactamente las aprobadas', ids === Object.keys(APPROVED).sort().join(), ids);
  for (const r of LEGAL_RULES) {
    const a = APPROVED[r.id];
    t.check(`"${r.title}": texto EXACTO aprobado`, !!a && r.text === a.text, r.text);
    t.check(`"${r.title}": título y versión ${a?.version}`, !!a && r.title === a.title && r.version === a.version);
  }
  t.check(`aviso día 2 a quien vende EXACTO: "${SHIP_REMINDER_TEXT}"`, SHIP_REMINDER_TEXT === "Te queda 1 día para marcar 'Ya lo envié'");
  t.check('versión vigente cubre todas las reglas legales', LEGAL_RULES.every((r) => r.version <= CURRENT_RULES_VERSION));

  /* ---------- Banned words + tuteo ---------- */
  const po = { seller_user_id: 's', buyer_user_id: 'b', title: 'Bici', slug: 'x' } as any;
  const push = [...(['reminder', 'cancel_buyer', 'cancel_auto'] as const).flatMap((k) => shipRuleMessages(po, k)), ...(['opened', 'replied', 'refund'] as const).flatMap((k) => replyRuleMessages(po, k)), ...(['opened', 'replied', 'resolved'] as const).flatMap((k) => claimMessages(po, k))].flatMap((m) => [m.title, m.body]);
  const ruleCopy = [...LEGAL_RULES.flatMap((r) => [r.title, r.text]), SELLER_AGREEMENT_TITLE, SELLER_AGREEMENT_INTRO, SELLER_AGREEMENT_ACCEPT, PAY_RULES_HEADING, SHIP_REMINDER_TEXT, ...push];
  const hit = ruleCopy.find((s) => BANNED.test(s));
  t.check('reglas, acuerdo y avisos: sin palabras prohibidas', !hit, hit);
  const vos = ruleCopy.find((s) => VOSEO.test(s));
  t.check('reglas, acuerdo y avisos: tuteo', !vos, vos);
  t.check('detector de palabras prohibidas (control)', ['pago seguro', 'Garantía', 'vendedor verificado', 'protegido', 'Protección', 'la empresa', 'una fintech', 'tu banco', 'billetera'].every((s) => BANNED.test(s)) && !BANNED.test('custodia') && !BANNED.test('Meteorito no verifica el producto'));
  const UI = ['components/LegalRules.tsx', 'components/PayBox.tsx', 'components/SellerActions.tsx', 'components/DisputeSheet.tsx', 'components/SellerDisputeReply.tsx', 'lib/ruleTimes.ts', 'lib/rulesAck.ts',
    'api/_lib/shipRefund.ts', 'api/_lib/replyRule.ts', 'api/_lib/orderRules.ts',
    'components/ClaimCard.tsx', 'components/SellerClaimReply.tsx', 'components/SellerBits.tsx', 'lib/claims.ts', 'api/_lib/claims.ts', 'lib/copy.ts'];
  for (const f of UI) {
    const bad = literals(read(f)).find((s) => BANNED.test(s));
    t.check(`${f}: copy sin palabras prohibidas`, !bad, bad);
  }

  /* ---------- Un solo lugar + dónde se renderiza ---------- */
  const files = ['app/como-funciona.tsx', 'app/p/[slug].tsx', 'app/(tabs)/vender.tsx', 'app/(tabs)/pedidos.tsx', 'components/PayBox.tsx', 'components/SellerActions.tsx', 'components/LegalRules.tsx', 'lib/demo.ts', 'lib/demoAdmin.ts', 'lib/legal.ts', 'components/DisputeSheet.tsx', 'components/SellerDisputeReply.tsx', 'api/_lib/push.ts', 'api/_lib/shipRefund.ts', 'api/_lib/replyRule.ts', 'api/_lib/disputeAdmin.ts',
    'components/ClaimCard.tsx', 'components/SellerClaimReply.tsx', 'api/_lib/claims.ts', 'lib/claims.ts'];
  for (const r of LEGAL_RULES) {
    const copies = files.filter((f) => read(f).includes(r.text.slice(0, 40)));
    t.check(`"${r.title}": el texto vive solo en lib/rules.ts (no copiado a mano)`, !copies.length, copies.join(', '));
  }
  t.check('/como-funciona: incluye cada regla legal (desde RULES)', LEGAL_RULES.every((l) => RULES.some((r) => r.id === l.id && r.text === l.text && r.title === l.title)) && /RULES\.map/.test(read('app/como-funciona.tsx')));
  const pay = read('components/PayBox.tsx');
  const method = pay.slice(pay.indexOf("visible={sheet === 'method'"), pay.indexOf('<CardSheet'));
  const sinpe = pay.slice(pay.indexOf("visible={sheet === 'sinpe'"));
  t.check('"Al pagar aceptas" (método): reglas del pedido antes de pagar', /legalRulesFor\(order\)/.test(pay) && /\{legal\}/.test(method) && method.indexOf('{legal}') > method.indexOf('payAcceptText'), method.slice(0, 80));
  t.check('"Al pagar aceptas" (SINPE): reglas del pedido antes de "Ya pagué"', /\{legal\}/.test(sinpe.slice(0, sinpe.indexOf('</Sheet>'))));
  t.check('LegalRuleRows renderiza título y texto de lib/rules.ts', /r\.title/.test(read('components/LegalRules.tsx')) && /r\.text/.test(read('components/LegalRules.tsx')));
  const vend = read('app/(tabs)/vender.tsx');
  const sub = vend.slice(vend.indexOf('async function submit'));
  t.check('acuerdo de la beta en Vender: hoja con las reglas ANTES de publicar (needsRulesAck antes de createOrder)', /<SellerAgreementSheet/.test(vend) && sub.indexOf('needsRulesAck()') > 0 && sub.indexOf('needsRulesAck()') < sub.indexOf('createOrder('), String(sub.indexOf('needsRulesAck()')));
  t.check('Vender manda la versión aceptada (rules_ack) al crear', /rules_ack/.test(vend));
  t.check('acuerdo de la beta: reglas vigentes; cara a cara sin la regla de envío', currentLegalRules('envio').some((r) => r.id === 'reembolso_sin_envio') && !currentLegalRules('cara_a_cara').some((r) => r.id === 'reembolso_sin_envio'));

  const ds = read('components/DisputeSheet.tsx'), sr = read('components/SellerDisputeReply.tsx');
  t.check("al abrir una disputa (v2): la regla de 48 h a la vista desde lib/rules.ts", /legalRule\('respuesta_48h'\)/.test(ds) && /LegalRuleRows/.test(ds));
  t.check("quien vende al responder (v2): cuenta regresiva de las 48 h", /seller-reply-countdown/.test(sr) && /leftLabel\(st\.deadline/.test(sr));

  const cc = read('components/ClaimCard.tsx'), slugPage = read('app/p/[slug].tsx'), scr = read('components/SellerClaimReply.tsx'), feed = read('api/_lib/feed.ts');
  t.check('después de liberado (v3): la regla de 30 días a la vista desde lib/rules.ts al reportar', /legalRule\('reclamo_30_dias'\)/.test(cc) && /LegalRuleRows/.test(cc) && /<ClaimCard/.test(slugPage) && /claimRuleApplies\(order\)/.test(slugPage));
  t.check('quien vende ve el reporte y puede responder antes de que cuente', /seller-claim-countdown/.test(scr) && /counts_at/.test(scr) && /<SellerClaimReply/.test(read('app/(tabs)/pedidos.tsx')));
  t.check('historial público: solo el conteo por estado (claimSummary), nunca el texto', /claimSummary\(sub\)/.test(feed) && !/description/.test(read('api/_lib/claims.ts').slice(read('api/_lib/claims.ts').indexOf('export async function claimSummary'))));

  /* ---------- Versión por pedido ---------- */
  t.check('pedido anterior (rules_version 0/ausente): no ve reglas nuevas', !legalRulesFor({ rules_version: 0 }).length && !legalRulesFor({}).length && !legalRulesFor(null).length);
  t.check('pedido v1 con envío: ve solo "Reembolso si no se envía"', legalRulesFor({ rules_version: 1, delivery_mode: 'envio' }).map((r) => r.id).join() === 'reembolso_sin_envio');
  t.check('pedido v1 cara a cara: ninguna', !legalRulesFor({ rules_version: 1, delivery_mode: 'cara_a_cara' }).length);
  t.check('pedido v2 con envío: las dos', legalRulesFor({ rules_version: 2, delivery_mode: 'envio' }).map((r) => r.id).join() === 'reembolso_sin_envio,respuesta_48h');
  t.check('pedido v2 cara a cara: solo la de 48 h', legalRulesFor({ rules_version: 2, delivery_mode: 'cara_a_cara' }).map((r) => r.id).join() === 'respuesta_48h');
  t.check('pedido v3 con envío: las tres', legalRulesFor({ rules_version: 3, delivery_mode: 'envio' }).map((r) => r.id).join() === 'reembolso_sin_envio,respuesta_48h,reclamo_30_dias');
  t.check('pedido v3 cara a cara: 48 h y 30 días', legalRulesFor({ rules_version: 3, delivery_mode: 'cara_a_cara' }).map((r) => r.id).join() === 'respuesta_48h,reclamo_30_dias');
  t.check('pedido v2: sin la regla de 30 días (no retroactivo)', !legalRulesFor({ rules_version: 2, delivery_mode: 'envio' }).some((r) => r.id === 'reclamo_30_dias'));
}
