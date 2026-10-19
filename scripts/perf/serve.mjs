// Servidor estático local que imita Vercel (brotli, rewrites SPA, Cache-Control de vercel.json). Uso: node scripts/perf/serve.mjs [dir=dist] [port=8099]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const dir = path.resolve(process.argv[2] ?? 'dist'); const port = Number(process.argv[3] ?? 8099);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const cache = new Map();
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(dir, p);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = /^\/p\//.test(p) && fs.existsSync(path.join(dir, 'p/[slug].html')) ? path.join(dir, 'p/[slug].html') : path.join(dir, p.endsWith('.html') ? p : 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(f); const immutable = /\/(_expo\/static|assets)\//.test(f.replace(dir, ''));
  const h = { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate' };
  let body = fs.readFileSync(f);
  if (/\.(js|html|json|ttf)$/.test(ext) && /br/.test(req.headers['accept-encoding'] ?? '')) { if (!cache.has(f)) cache.set(f, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })); body = cache.get(f); h['Content-Encoding'] = 'br'; }
  res.writeHead(200, h); res.end(body);
}).listen(port, () => console.log('serving', dir, 'on', port));
