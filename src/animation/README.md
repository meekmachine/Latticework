# Animation Agency

The Animation agency is LoomLarge's UI and orchestration adapter for reusable
Loom3 animation clips. LoomLarge owns snippet loading, metadata, controls, and
React-facing event streams. Loom3 owns runtime playback, mixer timing, looping,
scrubbing, keyframe detection, and completion.

There is no local animation runtime, scheduler polling loop, or
`requestAnimationFrame` tick in LoomLarge. Snippet playback is started through a
Loom3 `ClipHandle`, and UI state is updated from the clip event stream exposed
by that handle.

## Runtime Ownership

### Loom3 owns

- Building mixer clips from AU, viseme, morph, and bone curves.
- Advancing clip time inside the Three.js mixer update loop.
- Applying runtime values to the character.
- Emitting lifecycle events from `ClipHandle.subscribe()`.
- Resolving `ClipHandle.finished` when non-looping clips complete.

### LoomLarge owns

- Loading bundled snippets and user-authored JSON.
- Normalizing snippet metadata for the editor UI.
- Mapping UI controls to Loom3 clip parameters.
- Publishing RxJS observables for React components.
- Holding lightweight UI state such as current time, loop state, and selected
  snippet parameters.

## Components

| File | Role |
| --- | --- |
| `animationService.ts` | Public service API. Creates Loom3 clip handles and adapts their event stream into UI state. |
| `animationEvents.ts` | Event and UI-state types for the RxJS stream surface. |
| `types.ts` | LoomLarge-facing animation types and Loom3 type re-exports. |
| `snippetPreloader.ts` | Bundled snippet loading helpers. |
| `snippets/` | Bundled AU, viseme, and eye/head snippets. |

## Service API

Create the service with a Loom3 engine instance:

```typescript
import { createAnimationService } from './animationService';

const animationService = createAnimationService(loom3);
```

Load or schedule snippets:

```typescript
const name = animationService.schedule({
  name: 'head-nod',
  snippetCategory: 'eyeHeadTracking',
  curves: {
    '63': [
      { time: 0, intensity: 0 },
      { time: 0.2, intensity: 0.5 },
      { time: 0.4, intensity: 0 },
    ],
  },
}, {
  priority: 20,
  autoPlay: true,
});
```

Control playback:

```typescript
animationService.play();
animationService.pause();
animationService.stop();

animationService.setSnippetPlaying(name, true);
animationService.setSnippetTime(name, 0.25);
animationService.setSnippetPlaybackRate(name, 1.2);
animationService.setSnippetIntensityScale(name, 0.8);
animationService.setSnippetLoopMode(name, 'once');
```

The service delegates runtime work to Loom3:

```typescript
const handle = loom3.buildClip(snippetName, curves, options);
handle.subscribe((event) => {
  // keyframe, loop, seek, completed
});
handle.play();
```

If Loom3 does not provide `ClipHandle.subscribe()`, snippet playback fails fast.
The service does not fall back to polling because polling would recreate a
second runtime in LoomLarge.

## Event Streams

React components should use the exported observables instead of sampling service
state on an interval:

| Stream | Emits |
| --- | --- |
| `snippetList$` | Snippet list changes. |
| `snippetState$(name)` | Discrete state changes for one snippet. |
| `snippetTime$(name)` | Keyframe-driven time updates for one snippet. |
| `globalPlaybackState$` | Global play, pause, and stop state. |
| `bakedClipList$` | Baked clip list changes after model load. |
| `playingBakedAnimations$` | Discrete baked-animation playback and parameter changes. |
| `bakedAnimationState$(name)` | Discrete state changes for one baked animation. |
| `bakedAnimationProgress$(name)` | Explicit seek/scrub progress events for one baked animation. |

Example React usage:

```typescript
import { useEffect, useState } from 'react';
import { snippetState$ } from './animationService';

function SnippetRow({ name }: { name: string }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    const sub = snippetState$(name).subscribe(setState);
    return () => sub.unsubscribe();
  }, [name]);

  return <span>{state?.isPlaying ? 'Playing' : 'Paused'}</span>;
}
```

## Timing Model

Snippet current time is not calculated by a LoomLarge frame loop. It is copied
from Loom3 stream events:

- `keyframe` events update UI time and publish `KEYFRAME_COMPLETED`.
- `loop` events update iteration state and publish `SNIPPET_LOOPED`.
- `seek` events update local UI time after scrubbing.
- `completed` events are paired with `ClipHandle.finished` to publish
  `SNIPPET_COMPLETED`.

This means LoomLarge can update controls and timelines without owning the
runtime clock.

## Baked Animations

Baked model animations still use Loom3's baked animation API
(`playAnimation`, `pauseAnimation`, `resumeAnimation`, `stopAnimation`,
`seekAnimation`, and parameter setters). LoomLarge stores the editor-facing
state and emits RxJS events when the user starts, stops, pauses, seeks, or
changes parameters.

No baked-animation progress interval is created by this agency. Continuous
playhead advancement belongs to Loom3; LoomLarge only emits explicit state and
seek/scrub events.

## Testing

Primary tests live in `__tests__/animationService.test.ts`.

The important behavior to preserve is:

- Snippet scheduling creates Loom3 clip handles.
- Playback requires `ClipHandle.subscribe()`.
- Keyframe, loop, seek, and completion events update UI state through streams.
- Pausing, seeking, parameter changes, and stop cleanup call Loom3 handles
  directly.
- No service test should rely on polling or a local animation frame runtime.
