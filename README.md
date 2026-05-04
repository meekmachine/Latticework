# Latticework

`@lovelace_lol/latticework` is the standalone character-runtime package used by
LoomLarge for speech, conversation, gaze, blinking, hair, lip-sync, and animation
coordination.

Latticework owns character-behavior agencies and runtime helpers. LoomLarge owns
the application shell, UI, backend routes, character asset loading, and product
flows that assemble those agencies.

## Current Status

Latticework has been externalized from LoomLarge and is published to npm.

- Package: `@lovelace_lol/latticework`
- Repo: `meekmachine/Latticework`
- Current LoomLarge consumption: `@lovelace_lol/latticework@^0.0.5`
- LoomLarge no longer contains `frontend/src/latticework`
- LoomLarge validates linked Latticework PRs before publish when needed

The current package is a bridge extraction that preserves the working runtime
surface while the internals are cleaned up. The long-term architecture is still
to move toward clearer `Effect` service composition and `Most.js` stream
contracts without breaking LoomLarge consumers.

## Install

```bash
npm install @lovelace_lol/latticework
```

`three` is an optional peer dependency. Install it in consumers that use runtime
surfaces backed by Three.js or animation-engine integration.

```bash
npm install three
```

## Package Boundary

Latticework should contain reusable character-runtime behavior:

- animation services, snippet state, bundled snippet preloading, and baked clip
  runtime helpers
- TTS and transcription services
- conversation orchestration for local browser speech flows
- vocal/lip-sync timeline helpers, including Azure/SAPI viseme normalization
- gaze and eye/head tracking services
- blink, hair, and prosodic agencies
- runtime configuration helpers that are not LoomLarge-specific UI state

LoomLarge should keep app-specific behavior:

- React screens, panels, and module UI
- backend API calls and product-specific session orchestration
- character profile selection and product settings
- LiveKit room/token ownership and app-level connection UX
- smoke tests and previews for the assembled LoomLarge experience

## Public Runtime Areas

The package currently exposes a single root entry point.

```ts
import {
  createAnimationService,
  createConversationService,
  createTTSService,
  createTranscriptionService,
  createVocalService,
  createEyeHeadTrackingService,
  azureVisemesToTimeline,
} from '@lovelace_lol/latticework';
```

| Area | Key exports | Purpose |
| --- | --- | --- |
| Animation | `createAnimationService`, snippet observables, snippet preload helpers | Schedules snippets, tracks playback state, exposes UI/runtime streams |
| TTS | `createTTSService`, TTS timeline helpers, playback-reference types | Speaks text, emits timing events, coordinates vocal animation when an animation agency is provided |
| Transcription | `createTranscriptionService` | Browser speech recognition, transcript callbacks, interruption/reference-audio hooks |
| Conversation | `createConversationService`, `ConversationFlow` | Coordinates TTS, transcription, turn state, interruption handling, gaze/prosody handoff |
| Vocal / lip-sync | `createVocalService`, `azureVisemesToTimeline`, `VisemeMapper`, `PhonemeExtractor` | Converts text/provider visemes into animation timelines and snippets |
| Gaze / eye-head | `createEyeHeadTrackingService`, gaze config/types | Drives attention, gaze targets, listening/speaking poses, blink hooks |
| Blink | `createBlinkService`, `BlinkService` | Autonomous and triggered blinking |
| Hair | `HairService`, hair physics config/types | Hair runtime state and UI-facing configuration |
| Prosody | source modules, not yet a stable root export | Speech-driven expression and gesture coordination |

## Basic Usage

### TTS

```ts
import { createTTSService } from '@lovelace_lol/latticework';

const tts = createTTSService(
  {
    engine: 'webSpeech',
    rate: 1,
    pitch: 1,
    volume: 1,
  },
  {
    onStart: () => console.log('speaking'),
    onEnd: () => console.log('done'),
    onBoundary: ({ word }) => console.log('word', word),
  }
);

await tts.speak('Hello from Latticework.');
```

### Conversation Service And ConversationFlow

`ConversationService` owns the mechanics: TTS, transcription, state,
interruptions, gaze/prosody coordination, and cleanup.

`ConversationFlow` is the caller-provided content policy. It is a generator that
yields agent utterances and receives final user transcripts through `.next()`.

```ts
import {
  createConversationService,
  createTranscriptionService,
  createTTSService,
  type ConversationFlow,
} from '@lovelace_lol/latticework';

const tts = createTTSService({ engine: 'webSpeech' });
const transcription = createTranscriptionService({ lang: 'en-US' });
const conversation = createConversationService(tts, transcription);

function* simpleFlow(): ConversationFlow {
  const answer = yield 'What should we work on today?';
  yield `I heard: ${answer}`;
}

conversation.start(simpleFlow);
```

The generator API is intentionally documented because it is easy to confuse with
the service itself. Follow-up API cleanup is tracked in issue #8.

### Azure Visemes And Vocal Runtime

```ts
import {
  azureVisemesToTimeline,
  createVocalService,
} from '@lovelace_lol/latticework';

const vocal = createVocalService({
  animationAgency: {
    schedule: (snippet) => animationManager.schedule(snippet),
    remove: (name) => animationManager.remove(name),
    seek: (name, offsetSec) => animationManager.seek?.(name, offsetSec),
  },
});

const visemes = azureVisemesToTimeline(
  [{ viseme_id: 2, audio_offset: 0.12 }],
  1200,
  { visualLeadMs: 35 }
);

vocal.startTimeline({
  source: 'azure',
  text: 'hello',
  visemes,
  durationSec: 1.2,
});
```

## Development

```bash
npm ci
npm run build
npm run typecheck
npm test
```

The build emits ESM, CJS, and type declarations through `tsup`. The build also
copies bundled animation snippets into `dist` so consumers can preload them from
the package.

## Release Flow

Publishing currently mirrors the Loom3-style tag/release flow.

1. Open a PR against `main`.
2. PR checks run build, typecheck, and tests.
3. Merge to `main`.
4. The `Publish to NPM` workflow determines the next patch version, creates or
   reuses a `vX.Y.Z` tag, builds, tests, and publishes if that npm version does
   not already exist.
5. Verify the published package.

```bash
npm view @lovelace_lol/latticework version gitHead --json
```

The workflow currently expects the GitHub `npm` environment to provide:

- `NPM_KEY` for npm authentication
- `PUBLISH_PUSH_TOKEN` for pushing release tags

Moving to npm trusted publishing and rotating/removing the long-lived token is
tracked in issue #7.

## LoomLarge Linked-PR Workflow

Use linked PR validation when LoomLarge needs to test unreleased Latticework
changes before an npm publish.

Typical sequence:

1. Open a Latticework PR with the package change.
2. In the LoomLarge PR body or comments, add a dependency link such as:

   ```text
   Depends-on: meekmachine/Latticework#123
   ```

3. LoomLarge CI resolves that Latticework PR to a git dependency for the current
   validation run.
4. After the Latticework PR merges and publishes, update the LoomLarge PR to use
   the published npm semver.
5. Do not merge LoomLarge `main` with a temporary git SHA dependency.

Release and linked-PR documentation is tracked in issue #6.

## Roadmap

Near-term work:

- document the release and linked-PR workflow in more detail (#6)
- move publishing to npm trusted publishing and rotate token secrets (#7)
- clarify or simplify `ConversationService` versus `ConversationFlow` (#8)
- keep LoomLarge consumer smoke coverage current

Longer-term work:

- reduce bridge-era runtime coupling
- make agency ownership and cancellation rules explicit
- replace legacy runtime internals behind stable public contracts
- move toward `Effect` for service composition and lifecycle management
- use `Most.js` streams for timed events, fan-out, and observable-style inputs

The package boundary should remain stable while internals improve.
