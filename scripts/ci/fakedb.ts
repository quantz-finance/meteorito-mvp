// Supabase en memoria para tests (subset de la API de PostgREST que usa api/_lib). PK por tabla → 23505.
const PK: Record<string, string> = { orders: 'id', ramp_mock_payments: 'order_id', disputes: 'order_id', order_events: 'id', user_wallets: 'sub', session_nonces: 'nonce', invitations: 'code', seller_ratings: 'order_id', seller_profiles: 'sub' };
export function fakeDb() {
  const tables: Record<string, any[]> = { orders: [], ramp_mock_payments: [], disputes: [], order_events: [], invitations: [] };
  let seq = 1;
  const from = (t: string) => {
    tables[t] ??= [];
    const filters: ((r: any) => boolean)[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null; let returning = false;
    const rows = () => tables[t].filter((r) => filters.every((f) => f(r)));
    const exec = () => {
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const r of list) {
          const k = PK[t] ?? 'id'; const row = { ...r }; if (row[k] == null) row[k] = seq++;
          if (tables[t].some((x) => x[k] === row[k])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          tables[t].push(row);
        }
        return { data: list, error: null };
      }
      if (op === 'update') { const rs = rows(); rs.forEach((r) => Object.assign(r, payload)); return { data: returning ? rs.map((r) => ({ ...r })) : null, error: null }; }
      if (op === 'delete') { const rs = rows(); tables[t] = tables[t].filter((r) => !rs.includes(r)); return { data: null, error: null }; }
      return { data: rows().map((r) => ({ ...r })), error: null };
    };
    const q: any = {
      select: () => { if (op !== 'select') returning = true; return q; },
      insert: (p: any) => { op = 'insert'; payload = p; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { filters.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      lte: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] <= v); return q; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] != null && r[c] > v); return q; },
      or: () => q, order: () => q, limit: () => q,
      single: async () => { const r = exec(); const d = r.data?.[0] ?? null; return { data: d, error: d ? null : { message: 'no rows' } }; },
      maybeSingle: async () => { const r = exec(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
    };
    return q;
  };
  const uploads: string[] = [];
  const storage = { from: (_b: string) => ({ createSignedUploadUrl: async (path: string) => { uploads.push(path); return { data: { token: 'tok', signedUrl: `https://x/${path}` }, error: null }; } }) };
  return { from, tables, storage, uploads };
}
