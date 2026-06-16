# Eye/Head Tracking Architecture

This note records the current gaze architecture in Latticework.

## Short Version

- `EyeHeadTrackingService` now routes gaze targets through `gaze/GazeService`.
- `GazeService` owns the Most stream surface and Effect-managed state refs.
- The animation-agency scheduler is an output runtime adapter, not a separate gaze mode.
- Direct engine AU transitions remain as a fallback runtime when no animation agency is provided.
- `gazeMode` and `useAnimationAgency` are compatibility fields. They no longer select separate execution paths.

## Current Runtime Flow

```text
input target
  -> EyeHeadTrackingService
  -> camera-relative adjustment
  -> GazeService
  -> GazeRuntime
      -> animation agency scheduler, when available
      -> direct engine continuum/AU fallback otherwise
```

The eye/head service still owns browser-facing concerns:

- manual, mouse, and webcam input mode setup
- camera-relative gaze offsets
- lifecycle callbacks and UI/debug state
- return-to-neutral timers

The gaze module owns the architecture-level contract:

- `most-subject` state and event streams
- Effect `Ref` state for config, lifecycle, and last applied target
- target planning, min-delta filtering, and runtime commands
- runtime adapters for animation-agency output or direct engine output

## Why The Scheduler Still Exists

`EyeHeadTrackingScheduler` still builds the animation snippets:

- `eyeHeadTracking/eyeYaw`
- `eyeHeadTracking/eyePitch`
- `eyeHeadTracking/headYaw`
- `eyeHeadTracking/headPitch`
- `eyeHeadTracking/headRoll`

That scheduler is now called from the `GazeRuntime` adapter created by `EyeHeadTrackingService`. This keeps gaze able to mix with mouth, blink, prosody, and other animation snippets through the same animation agency instead of directly owning engine side effects.

## Compatibility Fields

Older consumers may still pass:

- `gazeMode: 'engine' | 'legacy' | 'experimental'`
- `useAnimationAgency: boolean`

Those values are accepted to avoid breaking callers, but the service no longer branches into old engine/legacy/experimental implementations. If an `animationAgency` is provided, gaze is scheduled through the modern runtime adapter. If not, the runtime falls back to engine continuum/AU methods when an engine is available.

## Modernization Status

This change makes gaze the first agency using the target architecture pattern:

- Most streams for observable state/events
- Effect refs for mutable service state
- explicit runtime commands between state planning and side effects
- animation-agency output where possible so gaze can blend with other animations

Remaining cleanup should focus on deleting stale UI labels and retiring old planner/scheduler terminology once downstream consumers no longer reference it.
