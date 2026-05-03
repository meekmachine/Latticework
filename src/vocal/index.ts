/**
 * Vocal Agency
 *
 * Lip sync and vocal animation using reactive streams (Most.js).
 * Re-uses the PhonemeExtractor and VisemeMapper from the lipsync module.
 *
 * Usage:
 * ```typescript
 * import { createVocalService } from './vocal';
 *
 * const vocal = createVocalService({
 *   intensity: 1.0,
 *   speechRate: 1.0,
 *   animationAgency: myAnimationAgency,
 * });
 *
 * // Speak text
 * vocal.speak('Hello world');
 *
 * // Or process word boundaries from TTS
 * vocal.processWordBoundary({ word: 'hello', startMs: 0, durationMs: 400 });
 *
 * // Or use pre-computed viseme events
 * vocal.processVisemeEvents([
 *   { visemeId: 12, offsetMs: 0, durationMs: 80 },
 *   { visemeId: 4, offsetMs: 100, durationMs: 120 },
 * ]);
 * ```
 */

// Types
export type {
  Keyframe,
  AnimationCurve,
  VocalSnippet,
  VisemeId,
  VisemeEvent,
  WordTiming,
  VocalSource,
  VocalTimeline,
  VocalWordTiming,
  VocalConfig,
  VocalState,
} from './types';

export {
  DEFAULT_VOCAL_CONFIG,
  JAW_AU,
  VOCAL_SNIPPET_CATEGORY,
} from './types';

// State
export { VocalStateStore } from './state';

// Phoneme/Viseme processing (wraps lipsync module)
export {
  wordToPhonemes,
  phonemeToViseme,
  getPhonemeDuration,
  getJawAmountForViseme,
  phonemesToVisemes,
  wordToVisemes,
  textToVisemes,
  isVowel,
} from './phonemes';

// Snippet building
export {
  buildVocalSnippet,
  buildWordSnippet,
  buildTextSnippet,
} from './snippetBuilder';

// Service
export { VocalService, createVocalService } from './service';
