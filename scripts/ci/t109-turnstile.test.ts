// (109) Cloudflare Turnstile (api/_lib/turnstile.ts + lib/turnstile.ts) en los formularios públicos sin cuenta:
// pagar como invitado (pedido/escrow nuevo) e importar por link como invitado.
//  - Apagado sin TURNSTILE_SECRET_KEY (producción sin llaves): no pide nada.
//  - Activo: sin token -> 403 turnstile_required + siteKey (pública); token se verifica en siteverify (secreto, IP, acción).
//  - Cloudflare caído: deja pasar y lo registra. El cliente web reintenta UNA vez con el token; nativo nunca lo pide.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { fail } from '../../api/_lib/db';
import { HttpError } from '../../api/_lib/auth';
import { __setTurnstileFetch, requireHuman, turnstileEnabled, TURNSTILE_FAILED, TURNSTILE_REQUIRED, VERIFY_URL } from '../../api/_lib/turnstile';

const rd = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const req = { headers: { 'x-forwarded-for': '203.0.113.9' } };
const SITE = '1x00000000000000000000AA', SECRET = '1x0000000000000000000000000000000AA'; // llaves de prueba públicas de Cloudflare
async function err(p: Promise<unknown>): Promise<any> { try { await p; return null; } catch (e) { return e; } }
function res() {
  const r: any = { code: 0, body: null as any }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; }; return r;
}

export async function run(t: T) {
  const saved = { s: process.env.TURNSTILE_SECRET_KEY, k: process.env.TURNSTILE_SITE_KEY };
  try {
    delete process.env.TURNSTILE_SECRET_KEY; delete process.env.TURNSTILE_SITE_KEY;
    t.check('sin TURNSTILE_SECRET_KEY: apagado, deja pasar sin token', !turnstileEnabled() && (await err(requireHuman(req, undefined, 'guest_pay'))) === null);

    process.env.TURNSTILE_SECRET_KEY = SECRET; process.env.TURNSTILE_SITE_KEY = SITE;
    const sent: any[] = [];
    __setTurnstileFetch(async (url, init) => { sent.push({ url, body: String(init.body) }); return { ok: true, json: async () => ({ success: true, action: 'guest_pay' }) }; });
    let e: any = await err(requireHuman(req, undefined, 'guest_pay'));
    t.check('activo y sin token -> 403 turnstile_required con la site key', e instanceof HttpError && e.status === 403 && e.code === 'turnstile_required' && e.siteKey === SITE && e.message === TURNSTILE_REQUIRED);
    const r = res(); fail(r, e);
    t.check('la respuesta lleva siteKey y acción (públicas), nunca el secreto', r.code === 403 && r.body.siteKey === SITE && r.body.action === 'guest_pay' && !JSON.stringify(r.body).includes(SECRET));
    t.check('token válido -> pasa', (await err(requireHuman(req, 'tok-ok', 'guest_pay'))) === null);
    const form = new URLSearchParams(sent[0]?.body ?? '');
    t.check('siteverify con secreto, token e IP del cliente', sent[0]?.url === VERIFY_URL && form.get('secret') === SECRET && form.get('response') === 'tok-ok' && form.get('remoteip') === '203.0.113.9');
    e = await err(requireHuman(req, 'tok-ok', 'guest_import'));
    t.check('token de otra acción -> 403 turnstile_failed', e?.status === 403 && e?.code === 'turnstile_failed' && e?.message === TURNSTILE_FAILED);
    __setTurnstileFetch(async () => ({ ok: true, json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) }));
    e = await err(requireHuman(req, 'malo', 'guest_pay'));
    t.check('token rechazado por Cloudflare -> 403 turnstile_failed', e?.status === 403 && e?.code === 'turnstile_failed');
    e = await err(requireHuman(req, 'x'.repeat(3000), 'guest_pay'));
    t.check('token enorme -> 403 sin llamar a Cloudflare', e?.code === 'turnstile_required');
    __setTurnstileFetch(async () => { throw new Error('red caída'); });
    t.check('Cloudflare caído -> fail-open (deja pasar)', (await err(requireHuman(req, 'tok', 'guest_pay'))) === null);
  } finally {
    __setTurnstileFetch(null);
    if (saved.s === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = saved.s;
    if (saved.k === undefined) delete process.env.TURNSTILE_SITE_KEY; else process.env.TURNSTILE_SITE_KEY = saved.k;
  }

  // Dónde se pide y cómo responde el cliente.
  const pay = rd('api/escrow/pay.ts'), store = rd('api/store/index.ts'), api = rd('lib/api.ts'), cli = rd('lib/turnstile.ts');
  t.check('pagar como invitado (pedido sin escrow) pide Turnstile', /if \(!order\.contract_id\) await requireHuman\(req, req\.body\?\.turnstile, 'guest_pay'\)/.test(pay));
  t.check('importar por link como invitado pide Turnstile', /if \(!who\.cavos\) await requireHuman\(req, b\.turnstile, 'guest_import'\)/.test(store));
  t.check('cliente: reintenta una vez con el token solo ante turnstile_*', /turnstile_/.test(api) && /turnstile: token/.test(api));
  t.check('cliente: solo en la web (sin DOM -> null) y script de challenges.cloudflare.com', /typeof document !== 'undefined'/.test(cli) && cli.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'));
  const csp = JSON.parse(rd('vercel.json')).headers.find((h: any) => h.source === '/(.*)').headers.find((h: any) => h.key === 'Content-Security-Policy').value as string;
  const dir = (d: string) => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(d + ' ')) ?? '').split(/\s+/);
  t.check('CSP: script-src y frame-src permiten challenges.cloudflare.com', dir('script-src').includes('https://challenges.cloudflare.com') && dir('frame-src').includes('https://challenges.cloudflare.com'));
  t.check('ninguna llave de Turnstile real en el repo (solo las de prueba públicas)', !/0x4[A-Za-z0-9_-]{20,}/.test(pay + store + api + cli + rd('vercel.json')));
}
