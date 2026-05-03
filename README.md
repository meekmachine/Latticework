# Latticework

`@lovelace_lol/latticework` is the standalone Latticework runtime package extracted from `LoomLarge/frontend/src/latticework`.

This repo is the package home for the current runtime code. The embedded LoomLarge copy can stay in place while the external package, publish flow, and linked-PR integration are wired up.

## Intended Architecture

- `Effect` for state, lifecycle, orchestration, and service composition
- `Most.js` for transport/event streams and observable-style flows
- stable package contracts that let LoomLarge adopt the external package before the internals are fully rebuilt

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

## Strategy

The near-term strategy is to make the external package real and usable first. The current runtime can act as a migration bridge while LoomLarge starts depending on `@lovelace_lol/latticework` through a small adapter layer.

The longer-term strategy is to replace the internals behind stable package contracts. New modules should be rebuilt around `Effect` services and `Most.js` streams, with the existing LoomLarge behavior used as reference material and parity fixtures.

The important boundary is ownership. Agencies should decide what they want to express. The runtime should decide how simultaneous agency outputs become coherent animation.

## Advantages

- isolates the character-behavior runtime from LoomLarge application code
- creates a package that can be tested, versioned, and released independently
- makes agency ownership explicit, so lip-sync, gaze, blink, prosody, and TTS do not keep rewriting each other's state
- gives LoomLarge a gradual adoption path through adapters instead of one high-risk replacement
- makes timing bugs easier to reproduce because streams, agency decisions, and runtime output can be tested separately
- lets the package boundary stabilize before the internal Effect and Most.js rewrite is complete

## Challenges

- the current LoomLarge implementation mixes old scheduler logic, XState, RxJS, and newer stream-based ideas, so the boundaries need to be rediscovered carefully
- timing behavior is user-visible and fragile, especially for lip-sync, jaw motion, gaze, and speech-driven expression
- a clean reimplementation can drift from working behavior unless we build parity fixtures and migration tests early
- agencies can conflict unless priority, ownership, blending, and cancellation rules are part of the core runtime contract
- package extraction adds release discipline, API stability, and migration overhead before it pays off
- carrying the extracted runtime for too long would preserve the architectural problems this package is meant to fix

## How We Make It Better

- define runtime contracts before implementation: agency inputs, agency outputs, cancellation, priorities, and timing units
- build golden fixtures from LoomLarge scenarios for TTS, lip-sync, gaze, blink, and prosody before replacing behavior
- keep each agency independently testable with deterministic clocks and stream fixtures
- expose a small adapter layer for LoomLarge so migration can happen one agency at a time
- avoid copying more code from `frontend/src/latticework`; use the old implementation as behavioral reference for new modules
- document every public API with ownership rules: who may emit, who may consume, and who resolves conflicts
- make observability part of the package, including trace events for agency input, agency decisions, and runtime output
- track which exported modules are bridge code and which modules have been rebuilt around the target architecture

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
