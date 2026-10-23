// Build web REAL (sin modo demo) para el E2E con backend simulado: Supabase y /api apuntan al servidor local
// scripts/e2e/mock-server.mjs (mismo origen, puerto 8084). Sin red real, sin secretos. Salida: dist-e2e/.
import { spawnSync } from 'node:child_process';
const env = { ...process.env, EXPO_PUBLIC_DEMO_MODE: '', EXPO_PUBLIC_SUPABASE_URL: 'http://localhost:8084/sb', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-e2e',
  EXPO_PUBLIC_POSTHOG_KEY: '', EXPO_PUBLIC_STELLAR_NETWORK: 'testnet', CI: process.env.CI ?? '1' };
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit', env }); if (r.status) process.exit(r.status ?? 1); };
run('npx', ['expo', 'export', '-p', 'web', '--output-dir', 'dist-e2e', '--clear']);
run('node', ['scripts/build/preload.mjs', 'dist-e2e']); // igual que vercel.json: SW con versión y precache
