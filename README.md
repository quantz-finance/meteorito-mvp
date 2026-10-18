# Meteorito — "Pagá seguro"

**Links:** [Landing — meteorito.app](https://meteorito.app) · [Testnet app — pago.meteorito.app](https://pago.meteorito.app) · [Quantz — quantz.finance](https://quantz.finance)

Meteorito is an escrow payment link for second-hand phone sales in Costa Rica (e.g. a used iPhone sold through local buy/sell groups). The buyer pays into an on-chain escrow, the seller ships, and funds are released when the buyer enters a delivery PIN — or automatically after a release window. Disputes are resolved by a designated dispute resolver.

> ⚠️ **Status: testnet only.** Meteorito runs exclusively on the **Stellar testnet**. The backend refuses any other network. Do not use real funds, and never put mainnet keys in this project.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). Issues and PRs in Spanish or English are welcome.

## License

[MIT](LICENSE)
