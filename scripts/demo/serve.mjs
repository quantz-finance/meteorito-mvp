// Servidor estático mínimo para el build web (misma lógica de rewrites que vercel.json). Sin dependencias.
// Uso: node scripts/demo/serve.mjs [carpeta=dist-demo] [puerto=8081]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist-demo');
const port = Number(process.argv[3] ?? process.env.PORT ?? 8081);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.map': 'application/json' };

function resolveFile(path) {
  const clean = decodeURIComponent(path.split('?')[0]).replace(/\.\./g, '');
  if (/^\/p\/[^/]+$/.test(clean)) return join(root, 'p/[slug].html');
  if (/^\/t\/[^/]+$/.test(clean)) return join(root, 't/[store].html');
  if (/^\/compartir\/[^/]+$/.test(clean)) return join(root, 'compartir/[slug].html');
  const direct = join(root, clean);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (existsSync(direct + '.html')) return direct + '.html';
  if (clean.startsWith('/api/')) return null; // el demo NO tiene backend: cualquier /api responde 404
  return join(root, 'index.html');
}

createServer((req, res) => {
  const f = resolveFile(req.url ?? '/');
  if (!f || !existsSync(f)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"demo: sin backend"}'); console.warn('[demo-serve] 404', req.url); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(port, () => console.log(`Meteorito demo en http://localhost:${port}  (carpeta: ${root})`));
