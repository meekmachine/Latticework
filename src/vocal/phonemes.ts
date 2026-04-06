/**
 * Phoneme Extraction & Viseme Mapping
 *
 * Re-exports and wraps the existing PhonemeExtractor and VisemeMapper
 * from the lipsync module with a simplified API for the vocal agency.
 */

import { PhonemeExtractor } from '../lipsync/PhonemeExtractor';
import { VisemeMapper, getJawAmountForViseme } from '../lipsync/VisemeMapper';
import type { VisemeEvent, VisemeId } from './types';

// Singleton instances
const extractor = new PhonemeExtractor();
const mapper = new VisemeMapper();

/**
 * Convert a word to phonemes
 */
export function wordToPhonemes(word: string): string[] {
  // Use the extractor's internal method via extractPhonemes
  // We extract just the word without punctuation handling
  const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return [];

  // Extract phonemes for the word
  const phonemes = extractor.extractPhonemes(normalized);
  console.log(`[Vocal/phonemes] "${word}" -> phonemes:`, phonemes);

  // Filter out pause tokens
  const filtered = phonemes.filter(p => !p.startsWith('PAUSE_'));
  console.log(`[Vocal/phonemes] "${word}" -> filtered:`, filtered);
  return filtered;
}

/**
 * Convert a phoneme to its viseme ID (ARKit 0-14)
 */
export function phonemeToViseme(phoneme: string): number {
  return mapper.getViseme(phoneme);
}

/**
 * Get the duration for a phoneme in ms
 */
export function getPhonemeDuration(phoneme: string): number {
  const mapping = mapper.getVisemeAndDuration(phoneme);
  return mapping.duration;
}

/**
 * Get jaw opening amount for a viseme (0-1)
 */
export { getJawAmountForViseme };

/**
 * Convert phonemes to viseme events with timing
 */
export function phonemesToVisemes(
  phonemes: string[],
  startMs: number = 0,
  speechRate: number = 1.0
): VisemeEvent[] {
  const events: VisemeEvent[] = [];
  let currentTime = startMs;

  for (const phoneme of phonemes) {
    const mapping = mapper.getVisemeAndDuration(phoneme);
    const scaledDuration = mapper.adjustDuration(mapping.duration, speechRate);

    events.push({
      visemeId: mapping.viseme as VisemeId,
      offsetMs: currentTime,
      durationMs: scaledDuration,
    });

    currentTime += scaledDuration;
  }

  return events;
}

/**
 * Convert a word to viseme events
 */
export function wordToVisemes(
  word: string,
  startMs: number = 0,
  speechRate: number = 1.0
): VisemeEvent[] {
  const phonemes = wordToPhonemes(word);
  const events = phonemesToVisemes(phonemes, startMs, speechRate);
  console.log(`[Vocal/phonemes] "${word}" -> viseme events:`, events);
  return events;
}

/**
 * Convert text (multiple words) to viseme events
 */
export function textToVisemes(
  text: string,
  speechRate: number = 1.0
): VisemeEvent[] {
  // Use the extractor for full text (includes pause handling)
  const allPhonemes = extractor.extractPhonemes(text);
  const events: VisemeEvent[] = [];
  let currentTime = 0;

  for (const phoneme of allPhonemes) {
    const mapping = mapper.getVisemeAndDuration(phoneme);
    const scaledDuration = mapper.adjustDuration(mapping.duration, speechRate);

    // Skip zero-duration pauses (like PAUSE_SPACE)
    if (scaledDuration <= 0) continue;

    events.push({
      visemeId: mapping.viseme as VisemeId,
      offsetMs: currentTime,
      durationMs: scaledDuration,
    });

    currentTime += scaledDuration;
  }

  return events;
}

/**
 * Check if a phoneme is a vowel
 */
export function isVowel(phoneme: string): boolean {
  return mapper.isVowel(phoneme);
}
