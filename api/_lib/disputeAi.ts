// Capa E: precalificación con IA para las disputas que ninguna regla resuelve. Resumen corto + recomendación
// (reembolsar / liberar / dividir %) con nivel de confianza y razones. NUNCA decide: una persona aprueba.
// Privacidad: al modelo NO van correos, teléfonos, IBAN, links ni ids de cuenta. Solo "Comprador"/"Vendedor", el producto,
// el precio, la línea de tiempo (horas relativas), el texto de la disputa, la respuesta del vendedor y el chat, todo con
// los datos de contacto tapados (redact). Las fotos no se mandan (solo cuántas hay).
// Acceso al modelo: Vercel AI Gateway (https://ai-gateway.vercel.sh/v1, compatible con OpenAI) con AI_GATEWAY_API_KEY o,
// en Vercel, el token OIDC del proyecto (VERCEL_OIDC_TOKEN / header x-vercel-oidc-token). Flag: DISPUTES_AI=0 lo apaga.
// Sin credencial -> { available:false } y la UI muestra "Resumen IA no disponible". Caché por disputa (027) con el hash
// de la entrada: si nada cambió, no se vuelve a llamar.
import { createHash } from 'node:crypto';
import type { Outcome, RuleResult } from './disputeRules';

export const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'anthropic/claude-haiku-4.5';
export const AI_UNAVAILABLE = 'Resumen IA no disponible';
export const aiModel = () => (process.env.DISPUTES_AI_MODEL || DEFAULT_AI_MODEL).trim();

export type Confidence = 'alta' | 'media' | 'baja';
export interface AiResult { summary: string; recommendation: Outcome; buyerPct: number; confidence: Confidence; reasons: string[]; model: string; at: string }

/** Tapa correos, teléfonos, IBAN/cuentas, links y números largos. */
export function redact(s: unknown, max = 600): string {
  let x = String(s ?? '');
  x = x.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo]');
  x = x.replace(/\bCR\s?\d{2}(?:[\s-]?\d){16,20}\b/gi, '[cuenta]');
  x = x.replace(/https?:\/\/\S+|www\.\S+/gi, '[link]');
  x = x.replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[número]' : m));
  x = x.replace(/\b[GC][A-Z2-7]{55}\b/g, '[cuenta]');
  x = x.replace(/\s+/g, ' ').trim();
  return x.length > max ? x.slice(0, max - 1) + '…' : x;
}

export interface AiFacts {
  product: string; priceCrc: number; delivery: 'envio' | 'cara_a_cara'; reason: string; description: string | null; evidenceCount: number;
  openedAt: string | null;
  timeline: { kind: string; at: string }[];
  ship: { shipped: boolean; photo: boolean; note: boolean; hash: boolean };
  response: { body: string; photo: boolean; at: string } | null;
  chat: { from: 'comprador' | 'vendedor'; body: string; at: string; ctx: 'pedido' | 'tienda' }[];
  rule: RuleResult | null;
}
const hrs = (at: string | null | undefined, ref: number) => (at ? Math.round((Date.parse(at) - ref) / 36e5) : null);

/** Entrada minimizada para el modelo (sin PII). Horas relativas a la apertura de la disputa. */
export function buildAiInput(f: AiFacts) {
  const ref = f.openedAt ? Date.parse(f.openedAt) : Date.now();
  return {
    producto: redact(f.product, 120), precio_crc: Math.round(f.priceCrc), entrega: f.delivery,
    disputa: { motivo: f.reason, descripcion: f.description ? redact(f.description, 1200) : null, fotos_del_comprador: f.evidenceCount },
    linea_de_tiempo: f.timeline.slice(-30).map((e) => ({ evento: e.kind, horas_desde_la_disputa: hrs(e.at, ref) })),
    envio: { marcado_enviado: f.ship.shipped, foto_del_paquete: f.ship.photo, numero_de_guia: f.ship.note, hash_de_evidencia: f.ship.hash },
    respuesta_del_vendedor: f.response ? { texto: redact(f.response.body, 1000), foto: f.response.photo, horas_desde_la_disputa: hrs(f.response.at, ref) } : null,
    chat: f.chat.slice(-60).map((m) => ({ de: m.from, en: m.ctx, texto: redact(m.body, 300), horas_desde_la_disputa: hrs(m.at, ref) })),
    regla_que_aplico: f.rule ? { regla: f.rule.rule, sugerencia: f.rule.outcome } : null,
  };
}
export const inputHash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);

export const SYSTEM_PROMPT = [
  'Eres analista de disputas de un marketplace con pagos en custodia (testnet). Recibes los hechos de UNA disputa entre un comprador y un vendedor.',
  'No inventes hechos. Si falta información, dilo y baja la confianza. No incluyas datos personales.',
  'Responde SOLO un objeto JSON, sin texto alrededor, con esta forma:',
  '{"resumen": "máximo 3 frases en español neutro", "recomendacion": "refund" | "release" | "split", "porcentaje_comprador": 0-100,',
  ' "confianza": "alta" | "media" | "baja", "razones": ["máximo 4 razones cortas"]}',
  'refund = devolver todo al comprador (porcentaje 100); release = pagar todo al vendedor (porcentaje 0); split = dividir (1-99).',
].join('\n');

/** Valida y normaliza la respuesta del modelo. null si no es usable. */
export function parseAiOutput(text: string, model: string, at = new Date().toISOString()): AiResult | null {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return null;
  let j: any; try { j = JSON.parse(m[0]); } catch { return null; }
  const rec = j.recomendacion ?? j.recommendation;
  if (!['refund', 'release', 'split'].includes(rec)) return null;
  let pct = Math.round(Number(j.porcentaje_comprador ?? j.buyerPct));
  if (rec === 'refund') pct = 100; else if (rec === 'release') pct = 0; else if (!(pct >= 1 && pct <= 99)) pct = 50;
  const conf: Confidence = ['alta', 'media', 'baja'].includes(j.confianza) ? j.confianza : 'baja';
  const summary = redact(j.resumen ?? j.summary ?? '', 600);
  if (!summary) return null;
  const reasons = (Array.isArray(j.razones ?? j.reasons) ? (j.razones ?? j.reasons) : []).slice(0, 4).map((r: unknown) => redact(r, 200)).filter(Boolean);
  return { summary, recommendation: rec, buyerPct: pct, confidence: conf, reasons, model, at };
}

export type AiCaller = (input: { system: string; user: string; model: string; token: string }) => Promise<string>;
let testCaller: AiCaller | null = null;
export const __setAiCallerForTests = (c: AiCaller | null) => { testCaller = c; };

/** Credencial para AI Gateway: API key o el token OIDC de Vercel (env o header de la request). Nunca se registra. */
export function aiToken(req?: any): string | null {
  const h = req?.headers?.['x-vercel-oidc-token'];
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || (typeof h === 'string' && h ? h : null);
}
export const aiEnabled = () => process.env.DISPUTES_AI !== '0';
export function aiStatus(req?: any): { available: boolean; reason?: 'flag_off' | 'no_credentials' } {
  if (!aiEnabled()) return { available: false, reason: 'flag_off' };
  if (!testCaller && !aiToken(req)) return { available: false, reason: 'no_credentials' };
  return { available: true };
}

const gatewayCaller: AiCaller = async ({ system, user, model, token }) => {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(AI_GATEWAY_URL, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 700, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`AI Gateway ${r.status}: ${String(j?.error?.message ?? j?.error ?? '').slice(0, 160)}`), { status: r.status });
    return String(j?.choices?.[0]?.message?.content ?? '');
  } finally { clearTimeout(timer); }
};

/** Llama al modelo con la entrada minimizada. Lanza si no hay credencial o la respuesta no sirve. */
export async function runAi(input: ReturnType<typeof buildAiInput>, req?: any): Promise<AiResult> {
  const token = aiToken(req) ?? (testCaller ? 'test' : null);
  if (!token) throw Object.assign(new Error(AI_UNAVAILABLE), { code: 'ai_unavailable' });
  const model = aiModel();
  const text = await (testCaller ?? gatewayCaller)({ system: SYSTEM_PROMPT, user: JSON.stringify(input), model, token });
  const out = parseAiOutput(text, model);
  if (!out) throw Object.assign(new Error('La IA no devolvió un resumen válido. Intenta de nuevo.'), { code: 'ai_bad_output' });
  return out;
}
