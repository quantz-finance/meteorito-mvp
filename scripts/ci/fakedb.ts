// Supabase en memoria para tests (subset de la API de PostgREST que usa api/_lib). PK por tabla → 23505.
const PK: Record<string, string> = { orders: 'id', ramp_mock_payments: 'order_id', disputes: 'order_id', order_events: 'id', user_wallets: 'sub', session_nonces: 'nonce', invitations: 'code', seller_ratings: 'order_id', seller_profiles: 'sub' };
/** Índices únicos además de la PK (→ 23505). */
const UNIQUE: Record<string, string[][]> = { seller_follows: [['follower_id', 'seller_user_id']],
  chat_conversations: [['token'], ['buyer_id', 'seller_user_id', 'ctx']], chat_messages: [['conversation_id', 'client_id']], chat_reports: [['conversation_id', 'reporter_role']],
  buyer_notifications: [['order_id', 'channel', 'dedupe_key']], buyer_contacts: [['order_id', 'channel']], buyer_links: [['guest_sub', 'account_sub']] };
export function fakeDb() {
  const tables: Record<string, any[]> = { orders: [], ramp_mock_payments: [], disputes: [], order_events: [], invitations: [] };
  let seq = 1;
  const from = (t: string) => {
    // Una lectura NO crea la tabla (así un SELECT opcional, p. ej. buyer_links, no cuenta como escritura en los tests).
    const filters: ((r: any) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'; let conflict: string[] = []; let ignoreDup = false;
    let payload: any = null; let returning = false;
    let sort: { c: string; asc: boolean } | null = null; let cap: number | null = null;
    const rows = () => (tables[t] ?? []).filter((r) => filters.every((f) => f(r)));
    const exec = () => {
      if (op !== 'select') tables[t] ??= [];
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload];
        const stored: any[] = [];
        for (const r of list) {
          const k = PK[t] ?? 'id'; const row = { ...r }; if (row[k] == null) row[k] = seq++;
          if (tables[t].some((x) => x[k] === row[k])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          const u = UNIQUE[t] ?? []; if (u.some((cols) => cols.every((c) => row[c] != null) && tables[t].some((x) => cols.every((c) => x[c] === row[c])))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          tables[t].push(row); stored.push({ ...row });
        }
        return { data: returning ? stored : list, error: null };
      }
      if (op === 'upsert') { // onConflict: columnas separadas por coma (o la PK)
        const list = Array.isArray(payload) ? payload : [payload]; const cols = conflict.length ? conflict : [PK[t] ?? 'id']; const stored: any[] = [];
        for (const r of list) { const hit = tables[t].find((x) => cols.every((c) => x[c] === r[c])); if (hit) { if (!ignoreDup) Object.assign(hit, r); stored.push({ ...hit }); } else { const row = { ...r }; const k = PK[t] ?? 'id'; if (row[k] == null) row[k] = seq++; tables[t].push(row); stored.push({ ...row }); } }
        return { data: returning ? stored : null, error: null };
      }
      if (op === 'update') { const rs = rows(); rs.forEach((r) => Object.assign(r, payload)); return { data: returning ? rs.map((r) => ({ ...r })) : null, error: null }; }
      if (op === 'delete') { const rs = rows(); tables[t] = tables[t].filter((r) => !rs.includes(r)); return { data: null, error: null }; }
      let out = rows().map((r) => ({ ...r }));
      if (sort) { const { c, asc } = sort; out.sort((a, b) => (a[c] === b[c] ? 0 : (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1))); }
      if (cap != null) out = out.slice(0, cap);
      return { data: out, error: null };
    };
    const q: any = {
      select: () => { if (op !== 'select') returning = true; return q; },
      insert: (p: any) => { op = 'insert'; payload = p; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      upsert: (p: any, o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => { op = 'upsert'; payload = p; conflict = String(o.onConflict ?? '').split(',').map((x) => x.trim()).filter(Boolean); ignoreDup = !!o.ignoreDuplicates; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { filters.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      lte: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] <= v); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] >= v); return q; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] > v); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      lt: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] < v); return q; },
      ilike: (c: string, p: string) => { const re = new RegExp('^' + String(p).split('').map((ch) => (ch === '%' || ch === '*' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$', 'is'); filters.push((r) => re.test(String(r[c] ?? ''))); return q; },
      or: () => q,
      order: (c: string, o?: { ascending?: boolean }) => { sort = { c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { cap = n; return q; },
      single: async () => { const r = exec(); const d = r.data?.[0] ?? null; return { data: d, error: d ? null : { message: 'no rows' } }; },
      maybeSingle: async () => { const r = exec(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  };
  const uploads: string[] = [];
  /** Objetos ya subidos al bucket (ruta completa). Los tests simulan la subida del teléfono con objects.add(path). */
  const objects = new Set<string>();
  const storage = { from: (_b: string) => ({
    createSignedUploadUrl: async (path: string) => { uploads.push(path); return { data: { token: 'tok', signedUrl: `https://x/${path}` }, error: null }; },
    upload: async (path: string) => { if (objects.has(path)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }; objects.add(path); return { data: { path }, error: null }; },
    list: async (dir: string, o: { search?: string } = {}) => ({ data: [...objects].filter((p) => p.startsWith(dir + '/')).map((p) => ({ name: p.slice(dir.length + 1) })).filter((f) => !f.name.includes('/') && (!o.search || f.name.includes(o.search))), error: null }),
  }) };
  return { from, tables, storage, uploads, objects };
}
