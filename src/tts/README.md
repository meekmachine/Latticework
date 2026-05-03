# TTS Agency

_Author: Jonathan Sutton Fields._

Text-to-Speech service for Latticework with lip-sync support.

## Features

- **Multiple TTS Engines**: Web Speech API and SAPI support
- **Lip-Sync Integration**: Automatic viseme generation for facial animation
- **Timeline-Based Execution**: Precise timing for words, visemes, and emojis
- **Voice Management**: Dynamic voice discovery and selection
- **Rate/Pitch/Volume Control**: Full speech parameter control
- **Emoji Support**: Automatic emoji detection and timeline integration
- **Experimental Playback Reference**: Optional current-tab/display audio capture for Web Speech interruption testing

## Installation

The TTS agency is part of Latticework and requires no additional installation.

## Quick Start

```typescript
import { createTTSService } from '@/latticework/tts';

// Create TTS service
const tts = createTTSService(
  {
    engine: 'webSpeech',  // or 'sapi'
    rate: 1.0,            // 0.1 - 10.0
    pitch: 1.0,           // 0.0 - 2.0
    volume: 1.0,          // 0.0 - 1.0
    voiceName: 'Google US English'
  },
  {
    onStart: () => console.log('Speech started'),
    onEnd: () => console.log('Speech ended'),
    onViseme: (visemeId, duration) => {
      // Sync lip animation with facial engine
      console.log(`Viseme ${visemeId} for ${duration}ms`);
    },
    onBoundary: ({ word, charIndex }) => {
      // Track word boundaries
      console.log(`Speaking: ${word} at ${charIndex}`);
    },
    onError: (error) => console.error('TTS error:', error)
  }
);

// Speak text
await tts.speak('Hello world! 😊');

// Get available voices
const voices = tts.getVoices();
console.log('Available voices:', voices);

// Change voice
tts.setVoice('Microsoft David Desktop');

// Control playback
tts.pause();
tts.resume();
tts.stop();

// Cleanup
tts.dispose();
```

## API Reference

### `createTTSService(config?, callbacks?)`

Creates a new TTS service instance.

**Parameters:**
- `config` - TTS configuration
  - `engine?: 'webSpeech' | 'sapi'` - TTS engine (default: `'webSpeech'`)
  - `rate?: number` - Speech rate, 0.1-10.0 (default: `1.0`)
  - `pitch?: number` - Speech pitch, 0.0-2.0 (default: `1.0`)
  - `volume?: number` - Speech volume, 0.0-1.0 (default: `1.0`)
  - `voiceName?: string` - Voice name to use
  - `webSpeechReferenceMode?: 'none' | 'displayMedia'` - experimental browser-mediated tab/display audio reference for Web Speech TTS

- `callbacks` - Event callbacks
  - `onStart?: () => void` - Called when speech starts
  - `onEnd?: () => void` - Called when speech ends
  - `onBoundary?: (event: { word: string; charIndex: number }) => void` - Word boundary events
  - `onViseme?: (visemeId: VisemeID, duration: number) => void` - Viseme events for lip-sync
  - `onError?: (error: Error) => void` - Error handler
  - `onPause?: () => void` - Pause handler
  - `onResume?: () => void` - Resume handler
  - `onPlaybackReferenceStatusChange?: (status) => void` - called when the experimental playback reference changes state

### `TTSService` Methods

#### `speak(text: string): Promise<void>`

Speak the given text. Automatically parses emojis and generates lip-sync timeline.

```typescript
await tts.speak('Hello world! 😊');
```

#### `stop(): void`

Stop current speech immediately.

```typescript
tts.stop();
```

#### `pause(): void`

Pause current speech.

```typescript
tts.pause();
```

#### `resume(): void`

Resume paused speech.

```typescript
tts.resume();
```

#### `getVoices(): TTSVoice[]`

Get list of available voices.

```typescript
const voices = tts.getVoices();
// [{ name: 'Google US English', lang: 'en-US', ... }, ...]
```

#### `setVoice(voiceName: string): boolean`

Set voice by name. Returns `true` if voice was found and set.

```typescript
const success = tts.setVoice('Google US English');
```

#### `getState(): TTSState`

Get current TTS state.

```typescript
const state = tts.getState();
// { status: 'speaking', currentText: 'Hello', ... }
```

#### `preparePlaybackReference(): Promise<PlaybackReferenceStatus>`

Prepare the optional playback-reference stream used by audio-based interruption detection. For Web Speech, browsers do not expose a native `speechSynthesis` audio stream, so `webSpeechReferenceMode: 'displayMedia'` uses `getDisplayMedia()` as an experimental workaround.

This method can show a browser display/tab-sharing prompt and must be called from an explicit user gesture. Choose the current tab and enable audio sharing. If capture is denied, unavailable, or provides no audio track, speech still works but audio-based interruption detection stays disabled unless transcription is explicitly configured to allow threshold-only interruption.

```typescript
const status = await tts.preparePlaybackReference();
if (status === 'available') {
  console.log('Using current-tab audio as playback reference');
}
```

#### `getPlaybackReferenceTrack(): MediaStreamTrack | null`

Returns the current playback-reference audio track when available. Azure/SAPI playback can expose a direct Web Audio reference; Web Speech can only expose the experimental display/tab capture reference after `preparePlaybackReference()` succeeds.

#### `onPlaybackReferenceTrackChange(listener): () => void`

Subscribe to playback-reference track changes so the transcription agency can update or clear its echo/interruption analyser when the reference starts or ends.

#### `updateConfig(config: Partial<TTSConfig>): void`

Update TTS configuration.

```typescript
tts.updateConfig({ rate: 1.5, pitch: 1.2 });
```

#### `dispose(): void`

Cleanup and release resources.

```typescript
tts.dispose();
```

## Viseme Mapping

The TTS agency uses a 21-viseme system (IDs 0-20) compatible with ARKit and FACS:

| Viseme ID | Description | Example Phonemes |
|-----------|-------------|------------------|
| 0 | Silence | sil, pau |
| 1 | Open vowels | AA, AE, AH |
| 2 | Back vowels | AO |
| 3 | Diphthong | AW |
| 4 | Diphthong | AY |
| 5 | Front vowel | EH |
| 6 | R-colored | ER, R |
| 7 | Dental/alveolar | EY, S, Z |
| 8 | Front vowel | IH |
| 9 | High front | IY, Y |
| 10 | Back rounded | OW |
| 11 | Diphthong | OY |
| 12 | Back rounded | UH |
| 13 | High back | UW, W |
| 14 | Bilabial | B, M, P |
| 15 | Postalveolar | CH, JH, SH, ZH |
| 16 | Dental/alveolar | D, L, N, T |
| 17 | Dental fricative | DH, TH |
| 18 | Labiodental | F, V |
| 19 | Velar | G, K, NG |
| 20 | Glottal | HH |

## Integration with Facial Engine

To integrate TTS with your facial animation engine:

```typescript
import { createTTSService } from '@/latticework/tts';
import { EngineThree } from '@/engine/EngineThree';

const engine = new EngineThree();

const tts = createTTSService(
  { engine: 'webSpeech', rate: 1.0 },
  {
    onViseme: (visemeId, duration) => {
      // Map viseme to facial AU
      // Example: Use viseme intensity to control jaw/lip AUs
      const intensity = (visemeId / 20) * 0.8;

      // Set jaw drop
      engine.setAU(26, intensity);

      // Additional lip shaping based on viseme type
      if (visemeId === 14) {
        // Bilabial - close lips
        engine.setAU(24, 0.8);
      } else if (visemeId >= 1 && visemeId <= 13) {
        // Vowels - open mouth
        engine.setAU(27, intensity * 0.6);
      }
    },
    onEnd: () => {
      // Return to neutral
      engine.setAU(26, 0);
      engine.setAU(24, 0);
      engine.setAU(27, 0);
    }
  }
);

await tts.speak('Hello, how are you today?');
```

## Timeline System

The TTS agency uses a declarative timeline for precise event scheduling:

```typescript
Timeline: [
  { type: 'WORD', word: 'hello', offsetMs: 0, index: 0 },
  { type: 'VISEME', visemeId: 14, offsetMs: 50, durMs: 80 },   // HH
  { type: 'VISEME', visemeId: 5, offsetMs: 130, durMs: 90 },    // EH
  { type: 'VISEME', visemeId: 16, offsetMs: 220, durMs: 70 },   // L
  { type: 'VISEME', visemeId: 10, offsetMs: 290, durMs: 100 },  // OW
  { type: 'EMOJI', emoji: '😊', offsetMs: 400 },
  ...
]
```

Each event fires at its exact offset time, enabling perfect synchronization between speech, lip-sync, and expressions.

## Web Speech API vs SAPI

### Web Speech API (Default)
- **Pros**: Native browser support, no server required, low latency
- **Cons**: Phoneme extraction is approximate, voice quality varies
- **Interruption note**: Web Speech does not expose its synthesized audio stream. The optional `displayMedia` reference mode is only a browser permission workaround that captures tab/display audio, not a clean TTS-only stream.

### SAPI (Server-based)
- **Pros**: Pre-computed viseme data, consistent quality, more voices
- **Cons**: Requires server, higher latency, network dependency

## Error Handling

```typescript
const tts = createTTSService(
  { engine: 'webSpeech' },
  {
    onError: (error) => {
      console.error('TTS error:', error);

      // Handle specific errors
      if (error.message.includes('not supported')) {
        console.log('Fallback to SAPI...');
        tts.updateConfig({ engine: 'sapi' });
      }
    }
  }
);
```

## Browser Compatibility

- **Web Speech API**: Chrome, Edge, Safari (limited)
- **Audio Playback**: All modern browsers
- **Recommended**: Chrome/Edge for best Web Speech API support

## License

Part of the LoomLarge product authored by Jonathan Sutton Fields.
