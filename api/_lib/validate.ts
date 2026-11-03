// Validación de entrada con zod en TODOS los endpoints de api/ (body y query). Forma y tamaños: tipos, largos máximos,
// listas acotadas y acción/paso conocidos. Las reglas de negocio (precio, PIN, estados…) siguen en cada handler con sus
// mensajes propios; esto corta antes lo que ningún cliente nuestro manda (tipos cambiados, textos enormes, campos raros).
// Falla -> 400 { error: 'Solicitud inválida.', code: 'bad_request' } (genérico, sin decir qué campo ni por qué).
import { z } from 'zod';
import { HttpError } from './auth';

export const BAD_REQUEST = 'Solicitud inválida.';
export const badRequest = () => Object.assign(new HttpError(400, BAD_REQUEST), { code: 'bad_request' });

/** Valida y devuelve el valor original (los handlers siguen leyendo req.body / req.query). */
export function check<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest();
  return data as z.infer<T>;
}
/** Body y query del request. Body ausente = {}. Query de Vercel: string | string[]. */
export function validate(req: any, s: { body?: z.ZodTypeAny; query?: z.ZodTypeAny }) {
  if (s.query) check(s.query, req?.query ?? {});
  if (s.body && req?.method === 'POST') check(s.body, req?.body ?? {});
}

// ---- Primitivas ----
const str = (n: number) => z.string().max(n);
const o = <T extends z.ZodTypeAny>(t: T) => t.nullish();
const numeric = z.union([z.number().finite(), z.string().max(32).regex(/^\s*-?\d+(\.\d+)?\s*$/)]);
const slug = str(80); // formato exacto lo revisa orderBySlug (400 / 409 producto de ejemplo con su mensaje)
const xdr = str(20000);
const photos = z.array(str(1000)).max(10);
const proof = z.object({ address: o(str(80)), publicKey: o(str(80)), signature: o(str(400)), message: o(str(400)), nonce: o(str(200)) }).passthrough();
const captureTok = str(2000);
/** Query de Vercel: cada parámetro string o lista corta de strings. */
const qv = (n = 300) => z.union([str(n), z.array(str(n)).max(5)]);
const query = (shape: Record<string, z.ZodTypeAny> = {}) => z.record(z.string().max(60), qv(2000)).and(z.object(shape).partial());
const body = (shape: Record<string, z.ZodTypeAny>) => z.object(shape).partial().passthrough();
const anyAction = <A extends readonly [string, ...string[]]>(names: A) => z.enum(names);

// ---- Por endpoint ----
export const S = {
  health: { query: query() },
  ordersCreate: {
    query: query(),
    body: body({
      title: o(str(200)), brand: o(str(200)), model: o(str(200)), category: o(str(40)), condition: o(str(100)),
      description: o(str(5000)), identifier: o(str(100)), price_crc: o(numeric), delivery_mode: o(str(40)), protection_minutes: o(numeric),
      photos: o(z.array(z.unknown()).max(10)), checks: o(z.array(z.unknown()).max(50)), invite: o(str(64)), single: o(z.boolean()),
      source_url: o(str(2000)), source_provider: o(str(60)), rules_ack: o(numeric), proof: o(proof), captures: o(z.array(o(captureTok)).max(10)),
    }),
  },
  escrowPay: {
    query: query(),
    body: body({
      slug: o(slug), proof: o(proof), turnstile: o(str(2048)),
      step: o(anyAction(['start', 'confirm_sinpe', 'shipment', 'card_pay', 'card_session', 'card_confirm', 'crypto_quote', 'crypto_status', 'fund_xdr', 'fund_direct'])),
      signedXdr: o(xdr), asset: o(str(10)), buyer: o(str(80)),
      number: o(str(40)), exp: o(str(10)), cvc: o(str(8)), name: o(str(120)), email: o(str(254)), scenario: o(str(40)),
    }),
  },
  escrowConfirm: {
    query: query(),
    body: body({ slug: o(slug), reason: o(str(40)), pin: o(z.union([str(12), z.number()])), days: o(numeric), accept: o(z.boolean()) }),
  },
  escrowShip: {
    query: query(),
    body: body({ slug: o(slug), evidence: o(z.object({ photo: o(str(1000)), note: o(str(1000)), capture_token: o(captureTok), captured_at: o(z.union([str(40), z.number()])) }).passthrough()), proof: o(proof), signedXdr: o(xdr) }),
  },
  escrowDispute: {
    query: query(),
    body: body({
      action: o(str(40)), slug: o(slug), reason: o(str(40)), description: o(str(5000)), evidence: o(z.array(z.unknown()).max(10)), captures: o(z.array(o(captureTok)).max(10)),
      body: o(str(5000)), tracking: o(str(200)), photo: o(str(1000)), capture: o(captureTok), note: o(str(2000)), refresh: o(z.boolean()),
      outcome: o(str(20)), buyer_pct: o(numeric), confirm: o(z.boolean()), store_slug: o(str(80)),
    }),
  },
  escrowCron: { query: query({ slug: o(str(80)) }) },
  invites: {
    query: query({ code: o(str(64)) }),
    body: body({ op: o(str(20)), code: o(str(64)), title: o(str(200)), brand: o(str(200)), model: o(str(200)), category: o(str(40)), price_crc: o(numeric), note: o(str(2000)), photos: o(z.array(z.unknown()).max(10)), source_url: o(str(2000)), captures: o(z.array(o(captureTok)).max(10)) }),
  },
  photosUpload: {
    query: query(),
    body: body({ action: o(str(40)), purpose: o(str(40)), ref: o(str(80)), as: o(str(20)), capture_token: o(captureTok), draftId: o(str(80)), index: o(numeric), mime: o(str(60)), size: o(numeric) }),
  },
  txSubmit: { query: query(), body: body({ slug: o(slug), action: o(str(40)), signedXdr: o(xdr) }) },
  walletActivate: { query: query(), body: body({ step: o(str(40)), proof: o(proof), signedXdr: o(xdr), slug: o(slug) }) },
  store: {
    query: query({ store: o(str(80)), feed: o(str(20)), q: o(str(200)), cursor: o(str(200)), limit: o(str(10)), verified: o(str(10)), order: o(str(10)), profile: o(str(80)), activity: o(str(2000)), og: o(str(80)), demo: o(str(20)), slug: o(str(80)), chat: o(str(20)), seller_of: o(str(80)), push: o(str(10)), ejemplos: o(str(5)) }),
    body: body({
      action: o(str(40)), turnstile: o(str(2048)), slug: o(slug), store_slug: o(str(200)), stars: o(numeric), comment: o(str(2000)), buyer_name: o(str(200)),
      subscription: o(z.object({ endpoint: o(str(2000)), keys: o(z.record(str(40), str(400))) }).passthrough()), url: o(str(2000)),
      token: o(str(2000)), consent: o(z.boolean()), consent_version: o(z.union([str(40), z.number()])), channel: o(str(20)), email: o(str(254)), phone: o(str(40)), cc: o(str(8)),
      q: o(str(200)), verified: o(z.union([z.boolean(), str(10)])), cursor: o(str(200)), limit: o(numeric), view: o(str(20)), ejemplos: o(z.boolean()),
      item_slug: o(str(80)), order_slug: o(str(80)), after: o(z.union([str(80), z.number()])), before: o(z.union([str(80), z.number()])), typing: o(z.boolean()), full: o(z.boolean()),
      body: o(str(5000)), client_id: o(str(100)), as: o(str(20)), summary: o(z.boolean()), blocked: o(z.boolean()), reason: o(str(40)), detail: o(str(2000)),
      method: o(str(20)), stellar_address: o(str(80)), iban: o(str(64)), holder_name: o(str(200)), sinpe_phone: o(str(40)), status: o(str(20)),
      display_name: o(str(200)), avatar_url: o(str(1000)), contact_phone: o(str(40)), whatsapp_public: o(z.unknown()), show_last_seen: o(z.unknown()),
      socials: o(z.record(str(40), o(str(1000)))),
    }),
  },
} as const;
