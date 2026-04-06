/**
 * TTS Agency
 * Text-to-Speech service for Latticework
 *
 * @example
 * ```typescript
 * import { createTTSService } from '@/latticework/tts';
 *
 * const tts = createTTSService(
 *   { engine: 'webSpeech', rate: 1.0 },
 *   {
 *     onViseme: (visemeId, duration) => {
 *       // Sync lip animation
 *       engine.setAU(26, visemeId / 20); // Example: map to jaw
 *     },
 *     onStart: () => console.log('Speech started'),
 *     onEnd: () => console.log('Speech ended')
 *   }
 * );
 *
 * // Speak text
 * await tts.speak('Hello world! 😊');
 *
 * // Get available voices
 * const voices = tts.getVoices();
 *
 * // Change voice
 * tts.setVoice('Google US English');
 *
 * // Stop speech
 * tts.stop();
 * ```
 */

export { createTTSService, TTSService } from './ttsService';
export type {
  TTSConfig,
  TTSVoice,
  TTSCallbacks,
  TTSState,
  TTSEngine,
  VisemeID,
  TimelineEvent,
  WordTimelineItem,
  VisemeTimelineItem,
  EmojiTimelineItem,
  PhonemeTimelineItem,
  SAPIResponse,
  ParsedTokens
} from './types';
export {
  parseTokens,
  buildLocalTimeline,
  buildSAPITimeline,
  extractPhonemesFromWord,
  phonemeToViseme,
  decodeBase64Audio,
  getTimelineDuration,
  PHONEME_TO_VISEME
} from './utils';
