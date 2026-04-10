/**
 * TTS Agency Utilities
 * Helper functions for text parsing, phoneme extraction, and viseme mapping
 */

import type { ParsedTokens, VisemeID, TimelineEvent, WordTimelineItem, VisemeTimelineItem, EmojiTimelineItem } from './types';

/**
 * CMU Phoneme to ARKit Viseme mapping
 * Maps phonemes to viseme IDs (0-20) for lip-sync animation
 */
export const PHONEME_TO_VISEME: Record<string, VisemeID> = {
  // Silence
  'sil': 0,
  'pau': 0,

  // Vowels
  'AA': 1,  'AE': 1,  'AH': 1,  'AO': 2,  'AW': 3,
  'AY': 4,  'EH': 5,  'ER': 6,  'EY': 7,  'IH': 8,
  'IY': 9,  'OW': 10, 'OY': 11, 'UH': 12, 'UW': 13,

  // Consonants
  'B': 14,  'CH': 15, 'D': 16,  'DH': 17, 'F': 18,
  'G': 19,  'HH': 20, 'JH': 15, 'K': 19,  'L': 16,
  'M': 14,  'N': 16,  'NG': 19, 'P': 14,  'R': 6,
  'S': 7,   'SH': 15, 'T': 16,  'TH': 17, 'V': 18,
  'W': 13,  'Y': 9,   'Z': 7,   'ZH': 15
};

/**
 * Simple phoneme extraction from text
 * This is a basic implementation - for better accuracy, use a proper phoneme library
 */
export function extractPhonemesFromWord(word: string): string[] {
  const phonemes: string[] = [];
  const w = word.toLowerCase();

  // Very basic phoneme extraction - this should be replaced with a proper library
  // For now, we'll map common letter patterns to phonemes
  const patterns: Array<[RegExp, string]> = [
    [/th/, 'TH'], [/sh/, 'SH'], [/ch/, 'CH'], [/ng/, 'NG'],
    [/a/, 'AE'], [/e/, 'EH'], [/i/, 'IH'], [/o/, 'OW'], [/u/, 'UH'],
    [/b/, 'B'], [/c/, 'K'], [/d/, 'D'], [/f/, 'F'], [/g/, 'G'],
    [/h/, 'HH'], [/j/, 'JH'], [/k/, 'K'], [/l/, 'L'], [/m/, 'M'],
    [/n/, 'N'], [/p/, 'P'], [/r/, 'R'], [/s/, 'S'], [/t/, 'T'],
    [/v/, 'V'], [/w/, 'W'], [/y/, 'Y'], [/z/, 'Z']
  ];

  let remaining = w;
  while (remaining.length > 0) {
    let matched = false;
    for (const [pattern, phoneme] of patterns) {
      if (pattern.test(remaining)) {
        phonemes.push(phoneme);
        remaining = remaining.replace(pattern, '');
        matched = true;
        break;
      }
    }
    if (!matched) {
      remaining = remaining.slice(1);
    }
  }

  return phonemes;
}

/**
 * Convert phoneme to viseme ID
 */
export function phonemeToViseme(phoneme: string): VisemeID {
  return PHONEME_TO_VISEME[phoneme.toUpperCase()] ?? 0;
}

/**
 * Parse text and extract emojis
 * Returns sanitized text and emoji positions
 */
export function parseTokens(text: string): ParsedTokens {
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

  const emojis: Array<{ emoji: string; index: number }> = [];
  let match;
  let offset = 0;

  while ((match = emojiRegex.exec(text)) !== null) {
    emojis.push({
      emoji: match[0],
      index: match.index - offset
    });
    offset += match[0].length;
  }

  const sanitizedText = text.replace(emojiRegex, '').trim();

  return { text: sanitizedText, emojis };
}

/**
 * Build timeline for Web Speech API
 * Estimates timing based on word count and speech rate
 */
export function buildLocalTimeline(
  text: string,
  emojis: Array<{ emoji: string; index: number }>,
  rate: number = 1.0
): TimelineEvent[] {
  const timeline: TimelineEvent[] = [];
  const words = text.split(/\s+/).filter(w => w.length > 0);

  // Estimate base duration per character (in ms)
  const baseCharDuration = 100;
  const adjustedCharDuration = baseCharDuration / rate;

  let currentOffset = 0;

  words.forEach((word, index) => {
    // Add word event
    const wordItem: WordTimelineItem = {
      type: 'WORD',
      word,
      index,
      offsetMs: currentOffset
    };
    timeline.push(wordItem);

    // Extract phonemes and create viseme events
    const phonemes = extractPhonemesFromWord(word);
    let phonemeOffset = currentOffset;

    phonemes.forEach(phoneme => {
      const visemeId = phonemeToViseme(phoneme);
      const duration = adjustedCharDuration * 0.8; // Slightly shorter than character duration

      const visemeItem: VisemeTimelineItem = {
        type: 'VISEME',
        visemeId,
        offsetMs: phonemeOffset,
        durMs: duration
      };
      timeline.push(visemeItem);

      phonemeOffset += duration;
    });

    // Advance offset
    currentOffset += word.length * adjustedCharDuration + 50; // 50ms pause between words
  });

  // Distribute emojis proportionally across timeline
  const totalDuration = currentOffset;
  const textLength = text.length;

  emojis.forEach(({ emoji, index }) => {
    const proportion = index / textLength;
    const emojiOffset = totalDuration * proportion;

    const emojiItem: EmojiTimelineItem = {
      type: 'EMOJI',
      emoji,
      offsetMs: emojiOffset
    };
    timeline.push(emojiItem);
  });

  // Sort timeline by offset
  timeline.sort((a, b) => a.offsetMs - b.offsetMs);

  return timeline;
}

/**
 * Build timeline from SAPI response
 * Uses pre-computed viseme data from server
 */
export function buildSAPITimeline(
  text: string,
  emojis: Array<{ emoji: string; index: number }>,
  visemes: Array<{ id: VisemeID; duration: number }>,
  totalDuration: number
): TimelineEvent[] {
  const timeline: TimelineEvent[] = [];
  const words = text.split(/\s+/).filter(w => w.length > 0);

  // Add word events proportionally
  let currentOffset = 0;
  const wordDuration = totalDuration / words.length;

  words.forEach((word, index) => {
    const wordItem: WordTimelineItem = {
      type: 'WORD',
      word,
      index,
      offsetMs: currentOffset
    };
    timeline.push(wordItem);
    currentOffset += wordDuration;
  });

  // Add viseme events from SAPI data
  let visemeOffset = 0;
  visemes.forEach(({ id, duration }) => {
    const visemeItem: VisemeTimelineItem = {
      type: 'VISEME',
      visemeId: id,
      offsetMs: visemeOffset,
      durMs: duration
    };
    timeline.push(visemeItem);
    visemeOffset += duration;
  });

  // Distribute emojis proportionally
  const textLength = text.length;
  emojis.forEach(({ emoji, index }) => {
    const proportion = index / textLength;
    const emojiOffset = totalDuration * proportion;

    const emojiItem: EmojiTimelineItem = {
      type: 'EMOJI',
      emoji,
      offsetMs: emojiOffset
    };
    timeline.push(emojiItem);
  });

  // Sort timeline by offset
  timeline.sort((a, b) => a.offsetMs - b.offsetMs);

  return timeline;
}

/**
 * Decode base64 WAV audio to AudioBuffer
 */
export async function decodeBase64Audio(
  base64: string,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  // Remove data URI prefix if present
  const base64Data = base64.replace(/^data:audio\/wav;base64,/, '');

  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Decode audio data
  return await audioContext.decodeAudioData(bytes.buffer);
}

/**
 * Calculate total timeline duration
 */
export function getTimelineDuration(timeline: TimelineEvent[]): number {
  if (timeline.length === 0) return 0;

  let maxOffset = 0;
  for (const item of timeline) {
    const itemEnd = item.offsetMs + (item.durMs ?? 0);
    if (itemEnd > maxOffset) {
      maxOffset = itemEnd;
    }
  }

  return maxOffset;
}
