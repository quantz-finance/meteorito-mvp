# Meteorito — "Pago en custodia"


## Video

Video de presentación (ES / EN): [Español](meteorito-demo-es.mp4) · [English](meteorito-demo-en.mp4)

**Links:** [Landing — meteorito.app](https://meteorito.app) · [Testnet app — pago.meteorito.app](https://pago.meteorito.app) · [Quantz — quantz.finance](https://quantz.finance)

Meteorito is an escrow payment link for second-hand phone sales in Costa Rica (e.g. a used iPhone sold through local buy/sell groups). The buyer pays into an on-chain escrow, the seller ships, and funds are released when the buyer enters a delivery PIN — or automatically after a release window. Disputes are resolved by a designated dispute resolver.

> ⚠️ **Status: testnet only.** Meteorito runs exclusively on the **Stellar testnet**. The backend refuses any other network. Do not use real funds, and never put mainnet keys in this project.

## Prueba para jueces (testnet)

> 🧪 **Cómo probar sin tropiezos:**
> - Usa un **correo nuevo** (nunca usado en la app) para **cada rol**: uno para el vendedor y otro para el comprador.
> - Lo ideal es usar **ventanas o perfiles de navegador separados** para cada rol.
> - Si la app pide una **frase de recuperación**, guárdala.
> - **No cierres sesión** en cuentas que no tengan respaldo.
> - Las sesiones antiguas pueden mostrar **«Tu sesión venció»**; en ese caso, usa un correo nuevo.

## Status & limitations

Meteorito is a hackathon-stage prototype. To be upfront about what it is and is not today:

- **Testnet only.** It runs on the Stellar testnet; there is no mainnet deployment and no real money moves.
- **SINPE is simulated.** The SINPE Móvil payment step is simulated by a testnet treasury that funds the escrow; there is no real fiat on-ramp.
- **Escrow via Trustless Work contracts.** Funds sit in a Trustless Work escrow contract on Stellar, but some contract roles (approver, release signer, platform/fee-bump) are operated by Meteorito's backend, so it is not fully trustless.
- **Disputes are resolved manually.** A buyer can open a dispute on-chain; the team resolves it manually (see `scripts/resolve-dispute.ts`). There is no automated arbiter.
- **No IMEI/iCloud verification yet.** The IMEI/serial and device checks are declared by the seller and are not verified by Meteorito. Buyers must inspect the device on receipt before handing over the PIN.
- **Drafted legal texts.** Terms and privacy policy are drafts pending legal review.

## Features

- Login with [Cavos](https://cavos.xyz) (Google, Apple or email) → non-custodial Stellar wallet, optional passkey backup.
- Direct USDC payment: buyers without SINPE can lock funds straight from their Stellar wallet (`/api/escrow/pay` steps `fund_xdr` → `fund_direct`; buyer signs, platform pays the fee).
- Guest checkout: a buyer opening a `/p/<slug>` link pays **without login or wallet** (`docs/guest-checkout.md`).
- Buyer-initiated deals: the buyer creates an invitation (`/i/nueva`), the seller confirms by publishing, the payment link is reserved for the inviter (`docs/buyer-invites.md`). Both sides see live status ("Actualizado hace Xs").
- Sale links: seller creates a listing with photos (IMEI optional), buyer pays in USDC (testnet).
- Escrow via [Trustless Work](https://www.trustlesswork.com) on Stellar (Soroban).
- Delivery PIN (locked after 3 wrong attempts), auto-release after `AUTO_RELEASE_MINUTES`.
- Dispute flow with percentage split (manual resolver script for now).
- Fee-bumped transactions so users don't need XLM.
- Product analytics with PostHog (see `docs/tracking-plan.md`).

## Architecture

| Layer | Tech | Where |
|---|---|---|
| App (web + iOS/Android) | Expo + React Native + Expo Router + TypeScript | `app/`, `components/`, `constants/`, `lib/` |
| Auth / wallet | Cavos kit (`lib/cavos.tsx` native, `lib/cavos.web.tsx` web) | `lib/` |
| API | Vercel serverless functions (Node 22) | `api/` |
| Database / storage | Supabase (Postgres + Storage) | `supabase/` (migrations) |
| Chain | Stellar testnet, Horizon + Soroban, Trustless Work escrow | `api/_lib/escrow*`, `lib/horizon.ts` |
| Ops scripts | Dispute resolution, smoke checks | `scripts/` |
| Tests | Unit + testnet integration tests | `scripts/ci/` |

Signing roles (deployer, approver, release signer, platform/fee-bump, dispute resolver) are separate keys. The dispute resolver secret is never deployed to the server; it is only used locally by `scripts/resolve-dispute.ts`.

## Getting started

Requirements: Node 22.x, npm.

```bash
git clone https://github.com/quantz-finance/meteorito-mvp.git
cd meteorito-mvp
npm ci
cp .env.example .env   # fill in your own testnet values
npx expo start --web
```

`.env` is git-ignored — never commit it. See `.env.example` for every variable:

- `EXPO_PUBLIC_*` — client-side, public values (Cavos app ID, Supabase URL + anon key, PostHog public key).
- Everything else is **server-only** (set in your Vercel project / local shell): Trustless Work API key, Supabase service role key, testnet signer secrets, `PIN_PEPPER`, `CRON_SECRET`, Cavos JWT settings.

You'll need your own: Cavos app (testnet, Stellar), Supabase project (apply `supabase/` migrations), Trustless Work testnet API key, and funded testnet accounts ([Friendbot](https://laboratory.stellar.org/#account-creator?network=test)).

### Native (iOS)

Expo Go is not supported (Cavos needs a native module). Use a development build: `npx expo run:ios --device`.

## Scripts

| Command | What it does |
|---|---|
| `npm run web` | Expo dev server (web) |
| `npm run ios` / `npm run android` | Expo dev server (native) |
| `npm run typecheck` | TypeScript check for app and `api/` |
| `npm run check:cjs` | Verifies the API loads as CommonJS |
| `npm run test:ci` | Unit tests + testnet integration tests |
| `npx expo export -p web` | Production web build into `dist/` |

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, web export, CJS check and tests on every push and PR. Testnet secrets come only from GitHub Actions secrets. **PRs from forks don't receive secrets**, so only unit tests run there; maintainers run the testnet suite before merging.

## Ejemplo de flujo completo en testnet

Ejecución real del 18-oct-2026 en Stellar **testnet** con wallets dedicadas a CI (modo demo apagado, USDC testnet del emisor configurado, sin dinero real). Los pedidos se manejaron con la lógica de `api/_lib` (base de datos en memoria, como en `npm run test:ci`).

**Pedido A — pago directo en USDC (`fund_xdr` / `fund_direct`), PIN y liberación** · escrow [`CBZ7LOXIXEOUDNFQGGSWQPQLK44Q2P54VSFJL3LYWH3RS5UNP2XG6UJ2`](https://stellar.expert/contract/CBZ7LOXIXEOUDNFQGGSWQPQLK44Q2P54VSFJL3LYWH3RS5UNP2XG6UJ2?network=testnet) · 1,01 USDC

| Paso | Transacción |
|---|---|
| Deploy escrow single-release | [`80b73806…325aef`](https://stellar.expert/explorer/testnet/tx/80b73806df5c3559be450e82bacbba4a50fdf81ab6b66428829519bb9a325aef) |
| Fondeo directo firmado por el comprador (`fund_escrow`, fee-bump de platform) | [`6927c20c…05ab72`](https://stellar.expert/explorer/testnet/tx/6927c20c46e7916d2810f2242f9d5f0cfc6ab23589b1e52bc6f948f03e05ab72) |
| Vendedor marca «Enviado» | [`bef0bd44…4ef1d9`](https://stellar.expert/explorer/testnet/tx/bef0bd44d0988541980b9892603c8646e71ab5058a16b97d3c81c2a0c94ef1d9) |
| Aprobación (tras validar el PIN de entrega) | [`96465460…499eba`](https://stellar.expert/explorer/testnet/tx/96465460a9c01e42002e7c339b2615e2e40e67e45d9255388c29d714f2499eba) |
| Liberación al vendedor | [`a57cb8dd…6057f5`](https://stellar.expert/explorer/testnet/tx/a57cb8dd27011dc3a8fb74cb42a0c42eba4befebd3df15dd52117466536057f5) |

Saldo USDC del vendedor: 3,99797 → 5,00494 (+1,00697 = 1,01 menos la comisión TW de 0,3 %).

**Pedido B — fondeo (ramp simulado) y disputa abierta on-chain** · escrow [`CCQAJN5WYE7MS4PFXUGHOOIGJRM7TXRPP3GKGVO2JEZ65NR5O6JTTWZT`](https://stellar.expert/contract/CCQAJN5WYE7MS4PFXUGHOOIGJRM7TXRPP3GKGVO2JEZ65NR5O6JTTWZT?network=testnet) · 1,01 USDC

| Paso | Transacción |
|---|---|
| Deploy escrow single-release | [`7282eadd…a363ab`](https://stellar.expert/explorer/testnet/tx/7282eadd01f30274bfba78da0e8efd65d1f4774a3fe1e50ae04f7e55bca363ab) |
| Fondeo desde treasury | [`6619a3bc…838823`](https://stellar.expert/explorer/testnet/tx/6619a3bc43b5855fb1566dc29e49be8bc18046c9c9cc798f2931b900e3838823) |
| Disputa (`dispute_escrow`, firmada por el approver, fee-bump) | [`a7ff823f…7087df`](https://stellar.expert/explorer/testnet/tx/a7ff823fcc8c215611129b618c47a3f6fff2078c67164bcc31e00372cf7087df) |

Estado on-chain tras la disputa: `disputed=true`, `released=false`, `resolved=false`.

Todos los enlaces apuntan a `https://stellar.expert/explorer/testnet/tx/<hash>`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). Issues and PRs in Spanish or English are welcome.

## License

[MIT](LICENSE)
