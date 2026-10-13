// GET /api/health — verifica que el runtime puede cargar TODAS las dependencias del API (CJS, sin require(esm)).
// Sin secretos (solo config pública: autoReleaseMinutes), sin env requeridas, sin DB ni red. Si alguna dependencia no carga, la función falla al importar (500).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as jose from 'jose';
import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc, Horizon, TransactionBuilder } from '@stellar/stellar-sdk';
import * as supabaseJs from '@supabase/supabase-js';
import * as auth from './_lib/auth';
import * as db from './_lib/db';
import * as env from './_lib/env';
import * as escrow from './_lib/escrow';
import * as feebump from './_lib/feebump';
import * as photos from './_lib/photos';
import * as tw from './_lib/tw';
import { activationConfig } from './_lib/wallet';

function version(pkg: string): string {
  try { return require(`${pkg}/package.json`).version; } catch {}
  try {
    // Paquetes con "exports" que no exponen package.json: subir desde el entry resuelto.
    let d = dirname(require.resolve(pkg));
    for (let i = 0; i < 6; i++, d = dirname(d)) {
      const f = join(d, 'package.json');
      if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); if (j.name === pkg) return j.version; }
    }
  } catch {}
  return 'unknown';
}

const loaded = {
  jose: typeof jose.jwtVerify === 'function',
  stellarSdk: typeof StellarSdk.Keypair === 'function',
  stellarRpc: typeof rpc?.Server === 'function',
  stellarHorizon: typeof Horizon?.Server === 'function',
  stellarTxBuilder: typeof TransactionBuilder?.buildFeeBumpTransaction === 'function',
  supabase: typeof supabaseJs.createClient === 'function',
  lib: [auth.requireCavosUser, db.json, env.env, escrow.approveAndRelease, feebump.feeBumpAndSend, photos.userDir, tw.releaseGuard].every(Boolean),
};

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') { res.status(405).setHeader('Content-Type', 'application/json'); return res.send(JSON.stringify({ error: 'method' })); }
  const ok = Object.values(loaded).every(Boolean);
  res.status(ok ? 200 : 500).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify({
    ok, loaded, node: process.version,
    config: { autoReleaseMinutes: env.env.autoReleaseMinutes(), walletActivation: activationConfig() },
    versions: { jose: version('jose'), '@stellar/stellar-sdk': version('@stellar/stellar-sdk'), '@stellar/stellar-base': version('@stellar/stellar-base'), '@supabase/supabase-js': version('@supabase/supabase-js') },
  }));
}
