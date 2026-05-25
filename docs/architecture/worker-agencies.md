# Worker-Backed Agencies

This note records how Latticework should evaluate worker-backed agencies in the
TypeScript version.

## Recommendation

Make agencies worker-capable, not worker-only at the first step.

The animation agency should remain on the main thread because Loom3, Three.js,
WebGL resources, clip handles, and browser media objects are main-thread owned
in the current integration. Worker agencies should produce typed commands,
state updates, and animation snippets. The main thread should own the final
animation gateway that schedules, updates, seeks, pauses, resumes, and removes
snippets.

This keeps the smooth animation path centralized while still moving agency
state machines, planners, timers, and expensive timeline generation out of React
and away from the renderer.

## Target Shape

Each agency should be factored into three pieces:

1. Core logic: pure TypeScript state, Effect state management, Most streams, and
   snippet planning.
2. Host capabilities: a typed interface for browser, backend, and animation
   operations that the agency is allowed to request.
3. Runtime adapter: either in-process or worker-backed, both speaking the same
   typed message protocol.

The protocol should be shared and serializable:

```ts
type AgencyCommand =
  | { type: 'configure'; agency: string; config: unknown }
  | { type: 'start'; agency: string }
  | { type: 'stop'; agency: string }
  | { type: 'input'; agency: string; input: unknown };

type AgencyOutput =
  | { type: 'state'; agency: string; state: unknown }
  | { type: 'scheduleSnippet'; agency: string; snippet: unknown; options?: unknown }
  | { type: 'updateSnippet'; agency: string; snippet: unknown }
  | { type: 'removeSnippet'; agency: string; name: string }
  | { type: 'seekSnippet'; agency: string; name: string; timeSec: number }
  | { type: 'error'; agency: string; message: string };
```

The concrete types should be agency-specific before implementation. The shape
above is only the minimum shared envelope.

## Agency Inventory

Good first worker candidates:

- `gaze`: target smoothing, camera-relative planning, and return-to-neutral
  state can run in a worker. The worker should emit eye/head snippets, not touch
  the engine directly.
- `blink`: random timing and blink snippet generation are small and cleanly
  serializable. This is a low-risk proving ground for the protocol.
- `vocal`: text-to-viseme timeline building, word timing normalization, and
  drift decisions can run off-thread. The main thread should still perform the
  final animation service calls.
- `lipsync`: phoneme extraction, viseme mapping, Azure timeline normalization,
  and coarticulation are good worker workloads.
- `prosodic`: speech pulse planning and snippet generation can run in a worker
  once snippet loading stops depending directly on `localStorage`.

Hybrid candidates:

- `tts`: browser Web Speech, `SpeechSynthesisUtterance`, `AudioContext`, and
  display-media capture are browser-owned and should stay on the main thread.
  Provider response parsing and timeline construction can be worker-backed.
- `transcription`: Web Speech recognition, microphone capture, and
  `AudioContext` setup are main-thread/browser-bound today. Interruption/VAD
  analysis can move to a worker or AudioWorklet after the media boundary is
  isolated.
- `conversation`: orchestration can become worker-backed after the dependent
  services expose typed command/state streams. It should not directly reach into
  browser-only APIs.
- `hair`: physics calculations may be worker-friendly, but final skeleton or
  engine mutation must remain on the main thread unless Loom3 exposes a worker
  safe runtime.

Should stay main-thread initially:

- `animation`: this is the gateway to Loom3 clip handles, Three.js state, and
  mixer playback. Worker agencies can request animation changes, but animation
  should serialize those requests into one ordered scheduler.

## Risks

- A worker per agency can add ordering and latency problems if multiple workers
  race to update the same AUs or snippets. The animation gateway must be the
  single arbiter for priorities, inherited frame starts, snippet replacement,
  and final playback order.
- `postMessage` is asynchronous. High-frequency gaze updates should be
  coalesced before crossing the worker boundary, ideally to one message per
  animation frame or less.
- Worker boundaries require serializable state. Media streams, DOM nodes,
  clip handles, Three objects, and functions cannot be passed as agency state.
- A one-worker-per-agency model may be more expensive than a shared agency
  worker. The API should support both so the runtime can choose based on
  profile, device, and workload.

## Migration Plan

1. Define shared command/output envelopes and typed host capabilities.
2. Refactor one simple agency, preferably `blink`, so the same core can run
   in-process or inside a worker.
3. Add an animation gateway on the main thread that consumes worker outputs and
   calls the existing animation service.
4. Move `gaze` next, preserving the current scheduler behavior by emitting the
   same inherited-frame eye/head snippets.
5. Move heavier planners (`vocal`, `lipsync`, then `prosodic`) once the protocol
   and ordering semantics are proven.
6. Split browser-bound services (`tts`, `transcription`) into main-thread
   capture/playback shells plus worker-backed analysis and timeline generation.
