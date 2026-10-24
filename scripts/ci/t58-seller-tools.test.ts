// (58) Herramientas del vendedor: plantilla de anuncio (WhatsApp / Facebook o Marketplace) con el link y el acuerdo de
//      entrega, e historial de ventas con estado, resultado y total cobrado. Sin funciones Vercel nuevas (usa /api/store
//      action 'orders') y sin palabras prohibidas en el copy nuevo.
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import {
  AD_COPIED, AD_COPY, AD_CUSTODY, AD_FORMATS, AD_HINT, AD_TITLE, adTemplate, collectedOf, HISTORY_EMPTY, HISTORY_TITLE,
  historyTotals, OUTCOME_LABEL, salesHistory, shortDate, totalsLine, type HistoryOrder,
} from '../../lib/sellerTools';

const read = (f: string) => readFileSync(f, 'utf8');
const BANNED = /\bsegur[oa]s?\b|garant[ií]a|verificad[oa] como garant|\bempresa\b|fintech|\bbanco\b|billetera|proteg/i;
const VOSEO = /\b(ten[eé]s|pod[eé]s|quer[eé]s|copi[aá]|peg[aá]|sab[eé]s|mand[aá]|toc[aá])\b/i;

export async function run(t: T) {
  const link = 'https://pago.meteorito.app/p/abc123';
  const base = { title: 'iPhone 13', price_crc: 250000, link, description: 'Batería 89 %. Con caja.' };
  const wF2F = adTemplate({ ...base, delivery_mode: 'cara_a_cara', protection_minutes: 1440 }, 'whatsapp');
  t.check('WhatsApp: título, precio, acuerdo cara a cara, custodia y link', wF2F === ['iPhone 13 por ₡250 000.', 'Entrega: Cara a cara · Protección: 24 h', AD_CUSTODY, `Paga aquí, sin crear cuenta: ${link}`].join('\n'), wF2F);
  const mEnv = adTemplate({ ...base, delivery_mode: null, protection_minutes: null }, 'marketplace');
  t.check('Marketplace: descripción, acuerdo por defecto (envío, 7 días desde el envío) en viñetas, custodia y link',
    mEnv.includes('iPhone 13 · ₡250 000') && mEnv.includes('Batería 89 %. Con caja.') && mEnv.includes('- Entrega: Envío') && mEnv.includes('- Protección: 7 días desde el envío') && mEnv.includes(`- ${AD_CUSTODY}`) && mEnv.trim().endsWith(link), mEnv);
  const m3 = adTemplate({ ...base, description: 'x'.repeat(900), delivery_mode: 'envio', protection_minutes: 3 * 1440 }, 'marketplace');
  t.check('Marketplace: plazo elegido (3 días) y descripción recortada a 500', m3.includes('- Protección: 3 días desde el envío') && !m3.includes('x'.repeat(501)));
  t.check('sin descripción ni título: no deja huecos', !adTemplate({ ...base, title: ' ', description: null }, 'marketplace').includes('\n\n\n') && adTemplate({ ...base, title: '' }, 'whatsapp').startsWith('Artículo por'));
  t.check('formatos: WhatsApp y Facebook o Marketplace', AD_FORMATS.map((f) => f.label).join('|') === 'WhatsApp|Facebook o Marketplace');

  // Historial
  const o = (slug: string, status: string, extra: Partial<HistoryOrder> = {}): HistoryOrder => ({ slug, brand: 'Apple', model: slug, price_crc: 100000, status, created_at: `2026-10-0${slug.length}T10:00:00Z`, ...extra });
  const rows = salesHistory([
    o('a', 'creado'), o('lst', 'creado', { kind: 'listing' }),
    o('bb', 'liberado', { released_at: '2026-10-20T10:00:00Z' }),
    o('ccc', 'resuelto', { resolution: { buyerPct: 100 }, resolved_at: '2026-10-21T10:00:00Z' }),
    o('dddd', 'resuelto', { resolution: { buyerPct: 30 }, resolved_at: '2026-10-22T10:00:00Z' }),
    o('eeeee', 'fondeado'), o('ffffff', 'cancelado'), o('ggggggg', 'resuelto', { resolution: null }),
  ]);
  t.check('historial: sin links sin pagar ni productos permanentes', rows.length === 6 && !rows.some((r) => r.slug === 'a' || r.slug === 'lst'));
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  t.check('resultado: liberado = Cobrado (precio completo)', by.bb.outcomeLabel === 'Cobrado' && by.bb.collected === 100000);
  t.check('resultado: reembolso total = Reembolsado al comprador, ₡0', by.ccc.outcomeLabel === 'Reembolsado al comprador' && by.ccc.collected === 0);
  t.check('resultado: reparto 30 % al comprador = Cobro parcial ₡70 000', by.dddd.outcome === 'parcial' && by.dddd.collected === 70000 && by.dddd.outcomeLabel === 'Cobro parcial: ₡70 000');
  t.check('en curso muestra su estado; cancelado = Sin venta; resuelto sin detalle no inventa', by.eeeee.outcomeLabel === 'En curso' && by.eeeee.statusLabel === 'Pagado · fondos apartados' && !by.eeeee.closed
    && by.ffffff.outcomeLabel === 'Sin venta' && by.ggggggg.outcomeLabel === 'Disputa resuelta' && by.ggggggg.collected === 0);
  t.check('orden: lo más reciente (cierre o creación) primero', rows[0].slug === 'dddd' && rows[1].slug === 'ccc' && rows[2].slug === 'bb');
  const tot = historyTotals(rows);
  t.check('totales: cobrado ₡170 000, 4 cerradas (sin canceladas), 1 en curso', tot.collected === 170000 && tot.closed === 4 && tot.open === 1 && totalsLine(tot) === 'Cobrado: ₡170 000 · 4 ventas cerradas · 1 en curso', totalsLine(tot));
  t.check('collectedOf acota porcentajes raros', collectedOf(o('x', 'resuelto', { resolution: { buyerPct: -20 } })) === 100000 && collectedOf(o('x', 'resuelto', { resolution: { buyerPct: 140 } })) === 0);
  t.check('fecha corta en español', shortDate('2026-10-24T18:00:00Z') === '24 oct 2026' && shortDate('nope') === '');

  // Copy nuevo: sin palabras prohibidas ni voseo
  const copy = [AD_TITLE, AD_HINT, AD_COPY, AD_COPIED, AD_CUSTODY, HISTORY_TITLE, HISTORY_EMPTY, ...Object.values(OUTCOME_LABEL), wF2F, mEnv, ...AD_FORMATS.map((f) => f.label)].join('\n');
  const files = ['lib/sellerTools.ts', 'components/AdTemplateSheet.tsx', 'app/ventas.tsx'];
  const literals = files.map(read).join('\n').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  t.check('copy nuevo sin "seguro", "garantía", "empresa", "fintech", "banco", "billetera" ni "protegido"', !BANNED.test(copy.replace(/Protección/g, '')) && !BANNED.test(literals.replace(/Protección|protection_minutes|protectionOf/g, '')));
  t.check('tuteo (sin voseo)', !VOSEO.test(copy) && !VOSEO.test(literals));

  // Cableado: sin funciones nuevas, datos por /api/store 'orders' con fallback, entradas en Vender, Home y Mi cuenta
  const store = read('api/store/index.ts');
  t.check('API: action orders pide released_at, resolved_at y resolution con fallback sin ellas', /const hist = 'released_at, resolved_at, resolution'/.test(store) && store.includes('select(`${cols}, ${hist}, delivery_mode`)') && store.includes('select(`${cols}, ${hist}`)') && store.includes('.select(cols)'));
  const vender = read('app/(tabs)/vender.tsx'), ped = read('app/(tabs)/pedidos.tsx');
  t.check('Vender: "¡Tu link está listo!" abre la plantilla con el link y el acuerdo elegido', /<AdTemplateButton onPress=\{\(\) => setAdOpen\(true\)\}/.test(vender) && /ad: \{ title: t, price_crc: priceNum, link: orderLink\(slug\), description, delivery_mode: mode, protection_minutes: windowMin \}/.test(vender));
  t.check('Home: la hoja de un link sin pagar ofrece la plantilla; "Historial" abre /ventas', /open\.status === 'creado' \? <AdTemplateButton/.test(ped) && /onHistory=\{\(\) => router\.push\('\/ventas'\)\}/.test(ped));
  t.check('Mi cuenta: fila Historial de ventas; ruta ventas registrada', /title=\{HISTORY_TITLE\}/.test(read('components/AccountSheet.tsx')) && /name="ventas"/.test(read('app/_layout.tsx')));
  t.check('historial usa getSellerOrders (sin endpoints nuevos)', /getSellerOrders\(auth\)\.then\(\(os\) => setRows\(salesHistory\(os\)\)\)/.test(read('app/ventas.tsx')));
}
