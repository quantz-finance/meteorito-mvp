# Security Policy

## Scope

Meteorito currently runs **only on the Stellar testnet**. There is no mainnet deployment and no real funds. Never use mainnet keys or real funds with this code.

## Reporting a vulnerability

Please **do not open a public issue**. Email **team@meteorito.app** with:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected files/endpoints and commit.

We aim to acknowledge within 72 hours and will keep you updated until it's fixed. Please give us reasonable time to fix before public disclosure. Reportes en español también son bienvenidos.

Especially interesting: escrow release/dispute logic, signing roles, delivery PIN, auth/session handling (Cavos JWT), Supabase access rules.

## Secrets

- Never commit `.env` or any key. If you accidentally expose a key, report it right away so it can be rotated.
- Do not send private keys in reports — testnet ones included.

## Web hardening

- Security headers and an enforced Content-Security-Policy live in `vercel.json` (global `/(.*)` entry). Inline scripts are allowed only by sha256 hash; `scripts/build/preload.mjs` fails the build if an inline script is missing from the CSP, and the local demo/e2e servers apply the same headers (`scripts/build/csp.mjs`).
- Buyer secrets on the web (guest key, delivery PIN, access grants) are stored encrypted in IndexedDB with a non-extractable WebCrypto key (`lib/secretVault.ts`), never in plain `localStorage`.

## Rate limiting

Sensitive API routes (create link, pay, PIN entry, tx submit, wallet activation, photo uploads, invitations,
import-by-link, buyer access links) share a persistent per-IP counter in Postgres (`supabase/migrations/037_rate_limits.sql`,
`api/_lib/rateLimit.ts`). The key is an HMAC of route + IP (the IP is never stored), rows expire after two windows.
Over the limit: `429` with `Retry-After`. If the database errors or is slow, requests pass (fail-open) and the event is logged.

## Risk limits

Order create, buyer invites, and the steps that **start** a payment (`start`, `confirm_sinpe`, `card_pay`,
`fund_direct`) enforce configurable amount caps, per-person velocity, a shared-IP cooldown, and a block list
(`api/_lib/risk.ts`, `docs/riesgo.md`). `card_session`, `card_confirm`, `fund_xdr`, and `crypto_status` are not
risk-checked (liquidation and polling). An order that already has `funded_tx`, or whose status is past
`escrow_creado`, is not risk-checked either, so a duplicate SINPE confirmation stays idempotent.
Defaults live in code. Overrides: `app_flags` key `risk_limits` (migration 027) and `RISK_*` env vars.
`supabase/migrations/050_risk_flags.sql` only seeds those rows and indexes — it is not applied by deploy.

Over a cap, or if the person is already blocked, the handler returns **403** `unavailable` with a generic
message and does not create the order or start the payment. One over-limit attempt does not write a 24 h
block. A burst does, for that person only — an IP is never stored as a block (mobile CGNAT and shared Wi-Fi).
Server logs and `order_events` use `risk_limit`, `risk_velocity`, `risk_signal`, and `risk_block`. The client
never receives the threshold or the reason. If the flag read fails while **publishing**, the request is
rejected. If it fails during a **payment**, the payment proceeds and the failure is logged.

## Bot checks (Cloudflare Turnstile)

Guest checkout (a new order/escrow) and guest import-by-link require a Turnstile token when `TURNSTILE_SECRET_KEY`
and `TURNSTILE_SITE_KEY` are set (`api/_lib/turnstile.ts`). Without them the check is off. The server answers
`403 turnstile_required` with the public site key; the web client (`lib/turnstile.ts`) solves the challenge and
retries once. Native iOS never loads the widget. If Cloudflare's siteverify is unreachable, requests pass and it is logged.
