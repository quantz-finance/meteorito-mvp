// Build web en MODO DEMO a dist-demo/ (no toca dist/ ni el despliegue de producción).
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['expo', 'export', '-p', 'web', '--output-dir', 'dist-demo', '--clear'], { stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_DEMO_MODE: '1', CI: process.env.CI ?? '1' } });
process.exit(r.status ?? 1);
