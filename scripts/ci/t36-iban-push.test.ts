// (36) Cuenta IBAN (formato CR + mod-97 ISO 13616, enmascarado, sin datos completos hacia la app), progreso del perfil,
// avisos push por estado (textos, destinatarios, limpieza de suscripciones vencidas, sin VAPID = nada) y recarga segura. Sin red.
import type { T } from './setup';
import { crIbanError, formatIban, ibanChecksumOk, maskIban, normalizeSinpe, payoutView } from '../../api/_lib/payout';
import { notifyOrder, parseSubscription, pushMessages, type PushSub } from '../../api/_lib/push';
import { profilePct, profileSteps } from '../../lib/payout';
import { holdUpdate, pageBusy, safeToReload } from '../../lib/updater';

/** Construye un IBAN CR válido con sus dígitos de control (ISO 13616). */
function makeIban(bban: string) {
  const digits = (bban + 'CR00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0; for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return 'CR' + String(98 - r).padStart(2, '0') + bban;
}

export async function run(t: T) {
  const good = makeIban('015202001026284066');
  t.check('IBAN CR válido (22, mod-97)', good.length === 22 && crIbanError(good) === null && ibanChecksumOk(good), good.slice(0, 4));
  t.check('IBAN con espacios y minúsculas se normaliza', crIbanError(formatIban(good).toLowerCase()) === null);
  t.check('agrupa en bloques de 4', formatIban(good) === good.replace(/(.{4})(?=.)/g, '$1 ') && formatIban(good).split(' ').length === 6);
  const bad = good.slice(0, 21) + String((Number(good[21]) + 1) % 10);
  t.check('checksum malo -> error', !!crIbanError(bad) && /válida/.test(crIbanError(bad)!));
  t.check('largo malo -> error claro', /faltan 1/.test(crIbanError(good.slice(0, 21)) ?? ''));
  t.check('otro país -> error', /empieza con CR/.test(crIbanError('ES9121000418450200051332') ?? ''));
  t.check('enmascarado CR•• •••• … últimos 4', maskIban(good.slice(-4)) === `CR•• •••• … ${good.slice(-4)}`);
  const v = payoutView({ iban: good, holder_name: 'Ana Mora', sinpe_phone: '88881234' });
  t.check('vista hacia la app sin IBAN ni teléfono completos', !JSON.stringify(v).includes(good) && !JSON.stringify(v).includes('88881234') && v.iban_last4 === good.slice(-4) && v.sinpe_last4 === '1234');
  t.check('SINPE: +506, vacío e inválido', normalizeSinpe('+506 8888 1234') === '88881234' && normalizeSinpe('') === null && normalizeSinpe('123') === 'invalid');

  const st = profileSteps({ name: 'Ana', storeSlug: 'ana', payout: false, products: 1 });
  t.check('perfil: 3 de 4 pasos = 75% (cédula no cuenta)', profilePct(st) === 75 && st.some((x) => x.key === 'id' && x.soon));
  t.check('perfil completo = 100%', profilePct(profileSteps({ name: 'Ana', storeSlug: 'ana', payout: true, products: 2 })) === 100);

  const o = { slug: 'abc123', status: 'fondeado', seller_user_id: 'sub-v', buyer_user_id: 'guest:xyz', brand: 'Bicicleta', model: null };
  const m = pushMessages(o);
  t.check('pagado -> vendedor y comprador', m.length === 2 && m[0].to === 'sub-v' && m[1].to === 'guest:xyz');
  t.check('texto del vendedor', m[0].title === '¡Te pagaron!' && /Bicicleta está en custodia/.test(m[0].body) && m[0].url === '/p/abc123');
  t.check('enviado -> solo comprador', pushMessages({ ...o, status: 'enviado' }).map((x) => x.role).join() === 'buyer');
  t.check('liberado / disputa / resuelto a ambos; creado a nadie',
    pushMessages({ ...o, status: 'liberado' }).length === 2 && pushMessages({ ...o, status: 'en_disputa' }).length === 2 && pushMessages({ ...o, status: 'resuelto' }).length === 2 && pushMessages({ ...o, status: 'creado' }).length === 0);
  const banned = /\b(seguro|protegido|garant[ií]a|garantizado|pronto|regulado)\b|\b(ten[ée]s|pod[ée]s|quer[ée]s|envi[áa]la vos)\b/i;
  const all = ['fondeado', 'enviado', 'entregado', 'liberado', 'en_disputa', 'resuelto'].flatMap((s) => pushMessages({ ...o, status: s })).map((x) => x.title + ' ' + x.body).join(' | ');
  t.check('textos en tuteo y sin palabras prohibidas', !banned.test(all), all.match(banned)?.[0]);

  const subs: PushSub[] = [
    { endpoint: 'https://push.example/v', user_id: 'sub-v', p256dh: 'k', auth: 'a' },
    { endpoint: 'https://push.example/gone', user_id: 'guest:xyz', p256dh: 'k', auth: 'a' },
  ];
  const sent: any[] = []; let dropped: string[] = []; let loadedIds: string[] = [];
  const ok = await notifyOrder(o, {
    enabled: () => true,
    load: async (ids) => { loadedIds = ids; return subs; },
    send: async (s, payload) => { sent.push({ to: s.user_id, ...JSON.parse(payload) }); return s.endpoint.endsWith('gone') ? 410 : 201; },
    drop: async (eps) => { dropped = eps; },
  });
  t.check('envía a cada suscripción de cada parte', ok === 1 && sent.length === 2 && loadedIds.sort().join() === 'guest:xyz,sub-v');
  t.check('payload: título, texto, url y tag', sent[0].title && sent[0].url === '/p/abc123' && sent[0].tag === 'abc123:fondeado');
  t.check('suscripción vencida (410) se borra', dropped.join() === 'https://push.example/gone');
  let called = false;
  const none = await notifyOrder(o, { enabled: () => false, load: async () => { called = true; return subs; } });
  t.check('sin VAPID no hace nada (ni consulta)', none === 0 && !called);
  const boom = await notifyOrder(o, { enabled: () => true, load: async () => { throw new Error('db caída'); } });
  t.check('nunca lanza (best-effort)', boom === 0);
  t.check('suscripción inválida se rechaza', parseSubscription({ endpoint: 'http://x', keys: {} }) === null && !!parseSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } }));

  const dom = (inputs: { value: string; type?: string }[], active: string | null = null, cavos = false) => ({
    activeElement: active ? { tagName: active } : null,
    querySelectorAll: () => inputs.map((i) => ({ type: i.type ?? 'text', value: i.value, readOnly: false })),
    querySelector: () => (cavos ? {} : null),
  }) as any;
  t.check('formulario a medio llenar -> no recargar', pageBusy(dom([{ value: 'Bici' }])) && !pageBusy(dom([{ value: '' }])));
  t.check('campo enfocado o login de Cavos abierto -> no recargar', pageBusy(dom([], 'INPUT')) && pageBusy(dom([], null, true)));
  (globalThis as any).document = dom([]);
  const release = holdUpdate();
  const held = !safeToReload(); release(); release();
  t.check('pago/firma en curso bloquea la recarga; al terminar se libera', held && safeToReload());
  delete (globalThis as any).document;
}
