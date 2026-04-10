# Latticework

`@lovelace_lol/latticework` is the standalone Latticework runtime package extracted from `LoomLarge/frontend/src/latticework`.

This repo is the package home for the current runtime code. The embedded LoomLarge copy can stay in place while the external package, publish flow, and linked-PR integration are wired up.

## Intended Architecture

- `Effect` for state, lifecycle, orchestration, and service composition
- `Most.js` for transport/event streams and observable-style flows
- package the current runtime code so it can be versioned, tested, and published independently

## Vision

The long-term goal is not a single animation manager. Latticework should become a library of collaborating agencies that each own a narrow part of character behavior and coordinate through clear runtime contracts.

This direction follows the architecture already documented in LoomLarge:

- a shared animation/runtime layer acts as the execution surface for all animation snippets
- domain agencies own their own state, lifecycle, scheduling rules, and cleanup behavior
- higher-level coordinators delegate work to specialized agencies instead of embedding all behavior in one service
- multiple agencies can contribute at the same time, with the runtime resolving timing, priority, continuity, and blending

The target agency model includes systems such as:

- animation/runtime for clip execution, arbitration, and continuity
- TTS for speech generation and speech-timed coordination
- vocal/lip-sync for visemes, jaw motion, and spoken phrase timing
- prosodic for emphasis, phrasing, and speech-driven expression
- blink for autonomous eye behavior
- gaze / eye-head tracking for attention and target following
- conversation / transcription for higher-level orchestration across interactive flows

In the longer-term design, `Effect` should own service composition, resource management, state transitions, and cancellation. `Most.js` should carry transport concerns such as timed event streams, signal fan-out, and external observable-style inputs. The point is to make collaboration explicit: agencies should publish and consume well-defined streams and commands, while the runtime stays responsible for turning those decisions into coherent output.

That means this package should eventually expose a set of composable agencies and runtime interfaces that LoomLarge can assemble, rather than another tightly-coupled application-specific stack.

## Current Status

What exists today:

- extracted runtime source from LoomLarge
- ESM + CJS build output via `tsup`
- Vitest test harness
- GitHub Actions PR checks
- GitHub Actions NPM publish workflow

What is still in transition:

- LoomLarge still keeps a copy of the runtime under `frontend/src/latticework`
- package adoption inside LoomLarge is being wired separately so the in-repo copy can remain as fallback until the external package path is proven
- API cleanup and dependency trimming can happen after the extracted package path is stable

## Scripts

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Publish Flow

The publish workflow mirrors Loom3:

- PRs run build, typecheck, and tests
- pushes to `main` bump the patch version automatically
- the publish job verifies NPM auth and publishes when the version is new

The workflow expects an `npm` GitHub environment with an `NPM_KEY` secret.
