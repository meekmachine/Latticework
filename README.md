# Latticework

`@lovelace_lol/latticework` is the standalone reimplementation target for the Latticework runtime.

This repo starts as a minimal package scaffold so the build, test, and publish pipeline can be established before the full runtime is rebuilt.

## Intended Architecture

- `Effect` for state, lifecycle, orchestration, and service composition
- `Most.js` for transport/event streams and observable-style flows
- clean reimplementation of the current Latticework concepts rather than code motion from LoomLarge

## Current Status

The repo is intentionally in scaffold state.

What exists today:

- TypeScript package setup
- ESM + CJS build output via `tsup`
- Vitest test harness
- GitHub Actions PR checks
- GitHub Actions NPM publish workflow

What does not exist yet:

- the actual agency/runtime implementations
- migration adapters
- public runtime APIs beyond the initial placeholder export

## Scripts

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Publish Flow

The publish workflow mirrors the Loom3 pattern:

- PRs run build, typecheck, and tests
- pushes to `main` bump the patch version automatically
- the publish job verifies NPM auth and publishes when the version is new

The workflow expects an `npm` GitHub environment with an `NPM_KEY` secret.

