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
