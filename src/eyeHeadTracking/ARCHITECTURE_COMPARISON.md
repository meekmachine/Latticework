# Eye/Head Tracking Architecture Comparison

This note documents the difference between the older eye/head tracking stack and the newer experimental gaze stack in Latticework, and it also records what the app is actually wired to today.

The short version:

- The currently wired eye/head UI `experimental` mode is not a pure Most+Effect implementation.
- The older eye/head service still owns the live UI path for both `legacy` and `experimental` scheduler modes.
- There is a newer `gaze/` module that uses `most-subject` for state and transport, but it is not the main eye/head execution path in the app today.
- The current `gaze/` module does not use `Effect`; it is Most-based, not Most+Effect.

## Terms

To keep the discussion precise, this document uses these names:

- `old scheduler stack`: the `eyeHeadTracking/` service + machine + scheduler path
- `new gaze stack`: the `gaze/` module (`gaze/service.ts`, `gaze/state.ts`, `gaze/transport.ts`)
- `UI experimental mode`: the `experimental` option in the Eye & Head Tracking drawer

Those are not the same thing.

## Old Scheduler Stack

The older eye/head architecture lives under `frontend/src/latticework/eyeHeadTracking/`.

Its center of gravity is `EyeHeadTrackingService`:

- It owns the config, lifecycle, current gaze state, speaking/listening flags, timers, webcam state, and input mode switching.
- It imports and runs an XState actor from `eyeHeadTrackingMachine.ts`.
- It imports and uses RxJS for mouse tracking (`fromEvent`, `throttleTime`, `pairwise`).
- It creates and uses `EyeHeadTrackingScheduler`, which emits animation-agency snippets such as `eyeHeadTracking/eyeYaw`, `eyeHeadTracking/headYaw`, and `eyeHeadTracking/headPitch`.
- In scheduler mode, the service routes gaze targets into `scheduler.scheduleGazeTransition(...)`.

This is the stack that currently powers the live scheduler-backed eye/head path.

### What belongs to the old stack

- `frontend/src/latticework/eyeHeadTracking/eyeHeadTrackingService.ts`
- `frontend/src/latticework/eyeHeadTracking/eyeHeadTrackingMachine.ts`
- `frontend/src/latticework/eyeHeadTracking/eyeHeadTrackingScheduler.ts`
- `frontend/src/latticework/eyeHeadTracking/planner.ts`
- the scheduler-facing parts of the animation runtime

### State model in the old stack

The old stack is a mixed model:

- XState stores config/mode/target/debug context
- RxJS handles mouse input streaming
- the service owns additional mutable runtime state directly
- the scheduler turns requested gaze targets into animation-agency snippets

This is why calling it a pure “Most/Effect” architecture would be inaccurate.

## New Gaze Stack

The newer gaze work lives under `frontend/src/latticework/gaze/`.

Its center of gravity is `GazeService`:

- It is engine-first.
- It optionally routes gaze targets through a transport layer.
- It uses a lightweight `GazeStateStore`.
- `GazeStateStore` uses `most-subject`.
- `NoopTransport` also uses `most-subject`.

This stack is materially different from the old stack:

- no XState actor
- no RxJS input pipeline inside `gaze/`
- no scheduler snippet generation inside `gaze/`
- no animation-agency dependency required to operate

### What belongs to the new gaze stack

- `frontend/src/latticework/gaze/service.ts`
- `frontend/src/latticework/gaze/state.ts`
- `frontend/src/latticework/gaze/transport.ts`
- `frontend/src/latticework/gaze/types.ts`

### Important limitation

The current `gaze/` module is Most-based, but it is not Effect-based.

As of this document:

- `gaze/state.ts` imports `most-subject`
- `gaze/transport.ts` imports `most-subject`
- there is no `Effect` import in `frontend/src/latticework/gaze/*`
- there is no `Effect` import in `frontend/src/latticework/eyeHeadTracking/*`

So if the target architecture is “Most + Effect only”, the codebase is not there yet for eye/head tracking.

## What The UI Actually Does Today

The Eye & Head Tracking drawer exposes three modes:

- `engine`
- `legacy`
- `experimental`

But those labels do not map to three fully separate implementations.

### `engine`

`engine` uses the old `EyeHeadTrackingService`, but that service bypasses the animation agency and calls engine continuum methods directly.

This is still old-stack code, just on its direct-engine branch.

### `legacy`

`legacy` uses the old `EyeHeadTrackingService` plus `EyeHeadTrackingScheduler`.

That is the classic scheduler/animation-agency path.

### `experimental`

`experimental` also goes through the old `EyeHeadTrackingService`.

In the current code, the service treats both `legacy` and `experimental` as `useAgency = true`, then routes the active path into:

- planner logic in `eyeHeadTrackingService.ts`
- scheduler snippet generation in `eyeHeadTrackingScheduler.ts`
- animation-agency playback in the runtime

That means the UI’s `experimental` mode is currently an experimental branch inside the old scheduler stack, not the standalone `gaze/` stack.

## Why This Is Confusing

There are two different meanings of “experimental” in the tree:

### 1. Experimental scheduler behavior inside the old stack

This is what the UI currently exposes for eye/head tracking.

It means:

- same `EyeHeadTrackingService`
- same XState context
- same RxJS input handling
- same scheduler/runtime family
- different tuning/branching behavior inside that system

### 2. Experimental gaze architecture in `gaze/`

This is a newer engine/transport-oriented module.

It means:

- different service
- Most-based state/transport layer
- no XState inside that module
- no RxJS inside that module
- not currently the main UI-driven eye/head path

The codebase currently contains both ideas at once, which is why “experimental” can be read two different ways.

## The Current Wiring Gap

`EyeHeadTrackingService` does create `experimentalGaze = new GazeService(...)`, and it keeps that instance updated when config changes.

However, the live target-application path still goes through the scheduler branch in `applyGazeToCharacter(...)` instead of delegating to `experimentalGaze.setTarget(...)`.

In practice, this means:

- the new gaze stack exists
- the old eye/head service knows about it
- but the app does not actually hand off the UI `experimental` mode to that new stack

That gap is the core architectural mismatch.

## Practical Difference Between The Two Approaches

### Old scheduler stack

Use this description when you mean:

- animation-agency snippets
- scheduler-generated AU curves
- XState + RxJS + service-owned mutable state
- planner + scheduler + runtime coordination
- UI `legacy`
- current UI `experimental`

### New gaze stack

Use this description when you mean:

- `GazeService`
- Most-based state/transport
- direct engine or transport routing
- no scheduler snippet generation inside the module
- no XState/RxJS inside that module
- not yet the main UI path

## What My Recent Eye/Head Fixes Touched

The recent eye/head fixes in PR `#143` touched the old scheduler stack, specifically:

- `eyeHeadTrackingService.ts`
- `eyeHeadTrackingScheduler.ts`
- `animationRuntime.ts`

Those changes improved the behavior of the currently wired UI `experimental` mode, but they did not migrate eye/head tracking onto a pure Most+Effect architecture.

## Recommended Terminology Going Forward

To avoid repeating this confusion, these labels are safer:

- `engine`: direct old-stack engine branch
- `legacy scheduler`: old scheduler/animation-agency branch
- `experimental scheduler`: newer behavior inside the old scheduler branch
- `new gaze stack`: the `gaze/` module
- `Most+Effect target architecture`: desired end state, not current reality

## If The Goal Is A True Most+Effect Eye/Head Path

The next architectural step should not be more tuning inside `EyeHeadTrackingService`.

The next step should be to decide one of these explicitly:

- route UI `experimental` mode into `GazeService` (or its successor) instead of the old scheduler path
- add Effect-based orchestration to the new gaze stack if “Most + Effect” is the desired final model
- leave the old scheduler stack available as `legacy`, but stop calling it “experimental”

Until that happens, the current eye/head UI `experimental` mode should be understood as “experimental scheduler behavior inside the old stack”, not “the new architecture.”
