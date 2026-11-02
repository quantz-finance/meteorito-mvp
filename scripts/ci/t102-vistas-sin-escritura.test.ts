// (102) Vistas públicas sin escritura (C1, migración 036). Sin red ni base: lee supabase/migrations en orden.
//  - Toda vista de `public` debe tener, DESPUÉS de su último `create view`, un revoke de INSERT/UPDATE/DELETE/TRUNCATE/
//    REFERENCES/TRIGGER para anon y authenticated (los default privileges de Supabase les dan ALL a las vistas nuevas).
//  - Nunca se vuelve a dar escritura (insert/update/delete/truncate/all) a anon/authenticated sobre una vista o
//    sobre last_seen_consents; last_seen_consents queda con `revoke all`.
//  - Las funciones de trigger fijan search_path (en su última definición o con `alter function ... set search_path`
//    posterior: un `create or replace function` sin `set` lo borra).
//  - 036 trae la verificación con has_table_privilege que hace fallar la migración si queda alguna escritura.
//  Verificación en vivo (0 filas = bien): scripts/ci/sql/assert-view-grants.sql
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';

const DIR = new URL('../../supabase/migrations/', import.meta.url).pathname;
const WRITES = ['insert', 'update', 'delete', 'truncate', 'references', 'trigger'];

type Stmt = { file: string; idx: number; sql: string };
/** Sentencias en orden global (archivo, posición). Quita comentarios `--` y respeta bloques $$...$$. */
export function statements(files: { name: string; sql: string }[]): Stmt[] {
  const out: Stmt[] = []; let idx = 0;
  for (const f of files) {
    const src = f.sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    let buf = '', inDollar: string | null = null;
    for (let i = 0; i < src.length; i++) {
      const m = src.slice(i).match(/^\$[a-z_]*\$/i);
      if (m) { if (!inDollar) inDollar = m[0]; else if (inDollar === m[0]) inDollar = null; buf += m[0]; i += m[0].length - 1; continue; }
      if (src[i] === ';' && !inDollar) { if (buf.trim()) out.push({ file: f.name, idx: idx++, sql: buf.trim().replace(/\s+/g, ' ') }); buf = ''; continue; }
      buf += src[i];
    }
    if (buf.trim()) out.push({ file: f.name, idx: idx++, sql: buf.trim().replace(/\s+/g, ' ') });
  }
  return out;
}

const names = (list: string) => list.split(',').map((s) => s.trim().replace(/^public\./i, '').toLowerCase());
const roles = (list: string) => list.split(',').map((s) => s.trim().toLowerCase());

/** Problemas de grants/search_path en un conjunto de migraciones (vacío = bien). */
export function audit(files: { name: string; sql: string }[]): string[] {
  const st = statements(files);
  const problems: string[] = [];
  const lastCreate = new Map<string, Stmt>();
  for (const s of st) {
    const m = s.sql.match(/^create (?:or replace )?(?:materialized )?view (?:if not exists )?(?:public\.)?("?[a-z0-9_]+"?)/i);
    if (m) lastCreate.set(m[1].replace(/"/g, '').toLowerCase(), s);
  }
  const revoked = (rel: string, role: string, after: number) => st.some((s) => {
    const m = s.sql.match(/^revoke (.+?) on (?:table )?(.+?) from (.+)$/i);
    if (!m || s.idx <= after || !names(m[2]).includes(rel) || !roles(m[3]).includes(role)) return false;
    const privs = m[1].toLowerCase();
    return privs.startsWith('all') || WRITES.every((w) => new RegExp(`\\b${w}\\b`).test(privs));
  });
  const protectedRels = new Set([...lastCreate.keys(), 'last_seen_consents']);
  for (const [view, s] of lastCreate) for (const role of ['anon', 'authenticated']) {
    if (!revoked(view, role, s.idx)) problems.push(`vista public.${view} (${s.file}): falta revoke de escritura para ${role} después de crearla`);
  }
  for (const role of ['anon', 'authenticated']) {
    const created = st.find((s) => /^create table (?:if not exists )?public\.last_seen_consents\b/i.test(s.sql));
    if (created && !st.some((s) => s.idx > created.idx && new RegExp(`^revoke all on (?:table )?(?:.*,\\s*)?public\\.last_seen_consents\\b.* from .*\\b${role}\\b`, 'i').test(s.sql)))
      problems.push(`last_seen_consents: falta revoke all para ${role}`);
  }
  for (const s of st) {
    const m = s.sql.match(/^grant (.+?) on (?:table )?(.+?) to (.+)$/i);
    if (!m || /^grant .* on (function|schema|sequence|all )/i.test(s.sql)) continue;
    const privs = m[1].toLowerCase();
    if (!(privs.startsWith('all') || WRITES.some((w) => new RegExp(`\\b${w}\\b`).test(privs)))) continue;
    const rel = names(m[2]).find((n) => protectedRels.has(n));
    const role = roles(m[3]).find((r) => r === 'anon' || r === 'authenticated' || r === 'public');
    if (rel && role) problems.push(`${s.file}: da escritura (${privs}) sobre ${rel} a ${role}`);
  }
  // search_path en funciones de trigger: la última definición manda.
  const lastFn = new Map<string, Stmt>();
  for (const s of st) { const m = s.sql.match(/^create (?:or replace )?function (?:public\.)?([a-z0-9_]+)\s*\(.*?\) returns trigger/i); if (m) lastFn.set(m[1].toLowerCase(), s); }
  for (const [fn, s] of lastFn) {
    const parts = s.sql.split(/\$[a-z_]*\$/i); // fuera del cuerpo: antes del primer $$ y después del último
    const header = parts.length >= 3 ? parts[0] + ' ' + parts[parts.length - 1] : s.sql;
    const inDef = /\bset search_path\b/i.test(header);
    const altered = st.some((a) => a.idx > s.idx && new RegExp(`^alter function (?:public\\.)?${fn}\\s*\\(.*\\) set search_path`, 'i').test(a.sql));
    if (!inDef && !altered) problems.push(`función de trigger public.${fn} (${s.file}): sin search_path fijo`);
  }
  return problems;
}

export async function run(t: T) {
  const files = readdirSync(DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort().map((name) => ({ name, sql: readFileSync(join(DIR, name), 'utf8') }));
  // Controles: el detector sí encuentra los casos malos.
  const bad = audit([{ name: 'x.sql', sql: "create view public.v as select 1;\ngrant select on public.v to anon, authenticated;\ncreate or replace function public.g() returns trigger language plpgsql as $$ begin return new; end $$;" }]);
  t.check('control: vista sin revoke -> detecta anon y authenticated', bad.filter((p) => p.includes('public.v')).length === 2, bad.join(' | '));
  t.check('control: trigger sin search_path -> detecta', bad.some((p) => p.includes('public.g')));
  const regrant = audit([{ name: 'x.sql', sql: 'create view public.v as select 1;\nrevoke insert, update, delete, truncate, references, trigger on public.v from anon, authenticated;\ngrant all on public.v to anon;' }]);
  t.check('control: re-grant de escritura después del revoke -> detecta', regrant.some((p) => p.includes('da escritura')), regrant.join(' | '));
  const recreate = audit([{ name: 'a.sql', sql: 'create view public.v as select 1;\nrevoke insert, update, delete, truncate, references, trigger on public.v from anon, authenticated;' }, { name: 'b.sql', sql: 'drop view public.v;\ncreate view public.v as select 2;\ngrant select on public.v to anon, authenticated;' }]);
  t.check('control: vista recreada sin revoke nuevo -> detecta', recreate.length === 2, recreate.join(' | '));
  const ok = audit([{ name: 'x.sql', sql: "create view public.v as select 1;\ncreate or replace function public.g() returns trigger language plpgsql as $$ begin return new; end $$;\nrevoke insert, update, delete, truncate, references, trigger on public.v from public, anon, authenticated;\nalter function public.g() set search_path = public;" }]);
  t.check('control: con revoke y alter function -> sin problemas', ok.length === 0, ok.join(' | '));

  const problems = audit(files);
  t.check('migraciones: ninguna vista pública ni last_seen_consents con escritura para anon/authenticated; triggers con search_path', problems.length === 0, problems.join(' | '));
  const views = [...new Set(statements(files).map((s) => s.sql.match(/^create (?:or replace )?view (?:public\.)?([a-z0-9_]+)/i)?.[1]).filter(Boolean))].sort();
  t.check('las 3 vistas públicas conocidas siguen siendo las únicas (si agregas una, revoca escritura)', views.join(',') === 'public_orders,public_store_items,public_stores', views.join(','));
  const m036 = files.find((f) => f.name.startsWith('036_'))?.sql ?? '';
  t.check('036: verificación has_table_privilege que hace fallar la migración', /has_table_privilege/.test(m036) && /raise exception/.test(m036));
  t.check('036: las vistas siguen con SELECT para anon (la página de pago lee public_orders con la key pública)', /grant select on public\.public_orders, public\.public_stores, public\.public_store_items to anon, authenticated/.test(m036));
  t.check('036: no cambia a security_invoker (las tablas base son deny-all: anon vería 0 filas)', !statements([{ name: '036', sql: m036 }]).some((x) => /security_invoker\s*=\s*(true|on)/i.test(x.sql)));
}
