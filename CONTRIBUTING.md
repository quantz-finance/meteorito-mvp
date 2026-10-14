# Contributing to Meteorito

¡Gracias por tu interés! Thanks for helping out. Issues, PRs and reviews are welcome in **Spanish or English**.

## Ground rules

- **Testnet only.** Never add mainnet keys, mainnet network config or real funds. PRs that touch mainnet will be closed.
- **Never commit secrets.** Use `.env` (git-ignored) locally; see `.env.example`.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues go to `team@meteorito.app`, not public issues (see [SECURITY.md](SECURITY.md)).

## Workflow

1. Open or pick an issue first for anything non-trivial.
2. Fork and create a branch: `feat/…`, `fix/…`, `docs/…`.
3. Keep PRs small and focused; describe what and why, and how you tested it.
4. Before pushing, run:
   ```bash
   npm run typecheck
   npm run check:cjs
   npm run test:ci
   npx expo export -p web
   ```
5. Open a PR against `master` using the PR template.

## Merge rule

All changes land **via pull request** — no direct pushes to `master`. A PR is merged only with **green CI** and at least one maintainer approval. Changes to escrow, signing roles, auth/session or the dispute flow need a review from a core maintainer.

Fork PRs only run unit tests (no secrets); a maintainer runs the testnet suite before merging.

## Code style

- TypeScript, strict. Use `npx expo install <pkg>` to add dependencies.
- Add or update tests in `scripts/ci/` for behavior changes.
