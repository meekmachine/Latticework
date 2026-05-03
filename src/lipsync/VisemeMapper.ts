/**
 * VisemeMapper
 * Maps phonemes to the canonical 15-slot viseme order used by loom3.
 * Numeric indices are resolved from @lovelace_lol/loom3 VISEME_KEYS at runtime.
 */

import type { VisemeID, PhonemeMapping } from './types';
import { VISEME_JAW_AMOUNTS } from '@lovelace_lol/loom3';
import { CANONICAL_VISEMES } from './canonicalVisemes';

/**
 * Get the jaw opening amount for a given viseme
 * Used to generate AU 26 (jaw drop) curves that match the viseme
 */
export function getJawAmountForViseme(visemeId: number): number {
  return VISEME_JAW_AMOUNTS[visemeId] ?? 0.3;
}

/**
 * Phoneme to canonical viseme index mapping table.
 */
const PHONEME_TO_VISEME_MAP: Record<string, VisemeID> = {
  // Silence - maps to B_M_P (closed mouth)
  'sil': CANONICAL_VISEMES.B_M_P,
  'pau': CANONICAL_VISEMES.B_M_P,
  'PAUSE': CANONICAL_VISEMES.B_M_P,

  // DoubleMetaphone single-letter vowels (canonical viseme indices)
  'A': CANONICAL_VISEMES.Ah,
  'E': CANONICAL_VISEMES.EE,
  'I': CANONICAL_VISEMES.Ih,
  'O': CANONICAL_VISEMES.Oh,
  'U': CANONICAL_VISEMES.W_OO,

  // DoubleMetaphone special characters
  '0': CANONICAL_VISEMES.Th,
  'X': CANONICAL_VISEMES.S_Z,
  'J': CANONICAL_VISEMES.Ch_J,

  // ARPABET vowels (canonical viseme indices)
  'AE': CANONICAL_VISEMES.AE,
  'AX': CANONICAL_VISEMES.Ah,
  'AH': CANONICAL_VISEMES.Ah,
  'AA': CANONICAL_VISEMES.Ah,
  'AO': CANONICAL_VISEMES.Oh,
  'EY': CANONICAL_VISEMES.EE,
  'EH': CANONICAL_VISEMES.EE,
  'UH': CANONICAL_VISEMES.W_OO,
  'ER': CANONICAL_VISEMES.Er,
  'Y': CANONICAL_VISEMES.Ih,
  'IY': CANONICAL_VISEMES.EE,
  'IH': CANONICAL_VISEMES.Ih,
  'IX': CANONICAL_VISEMES.Ih,
  'W': CANONICAL_VISEMES.W_OO,
  'UW': CANONICAL_VISEMES.W_OO,
  'OW': CANONICAL_VISEMES.Oh,
  'AW': CANONICAL_VISEMES.Ah,
  'OY': CANONICAL_VISEMES.Oh,
  'AY': CANONICAL_VISEMES.Ah,

  // Consonants (canonical viseme indices)
  'H': CANONICAL_VISEMES.Ah,
  'HH': CANONICAL_VISEMES.Ah,
  'R': CANONICAL_VISEMES.R,
  'L': CANONICAL_VISEMES.T_L_D_N,
  'S': CANONICAL_VISEMES.S_Z,
  'Z': CANONICAL_VISEMES.S_Z,
  'SH': CANONICAL_VISEMES.S_Z,
  'CH': CANONICAL_VISEMES.Ch_J,
  'JH': CANONICAL_VISEMES.Ch_J,
  'ZH': CANONICAL_VISEMES.S_Z,
  'TH': CANONICAL_VISEMES.Th,
  'DH': CANONICAL_VISEMES.Th,
  'F': CANONICAL_VISEMES.F_V,
  'V': CANONICAL_VISEMES.F_V,
  'D': CANONICAL_VISEMES.T_L_D_N,
  'T': CANONICAL_VISEMES.T_L_D_N,
  'N': CANONICAL_VISEMES.T_L_D_N,
  'K': CANONICAL_VISEMES.K_G_H_NG,
  'G': CANONICAL_VISEMES.K_G_H_NG,
  'NG': CANONICAL_VISEMES.K_G_H_NG,
  'P': CANONICAL_VISEMES.B_M_P,
  'B': CANONICAL_VISEMES.B_M_P,
  'M': CANONICAL_VISEMES.B_M_P,
};

/**
 * Phoneme-specific durations in milliseconds
 * Tuned to match phrase_viseme_snippet.json timing (30-60ms per viseme)
 * These are FAST - matching actual TTS output speed
 */
const PHONEME_DURATIONS: Record<string, number> = {
  // DoubleMetaphone single-letter vowels
  'A': 50,  // General A sound
  'E': 45,  // General E sound
  'I': 40,  // General I sound
  'O': 55,  // General O sound
  'U': 50,  // General U sound

  // DoubleMetaphone special
  '0': 35,  // TH sound
  'X': 45,  // SH sound
  'J': 40,  // J sound

  // Stops (plosives) - very short
  'P': 25, 'B': 25,
  'T': 20, 'D': 20,
  'K': 30, 'G': 30,

  // Fricatives - short
  'F': 35, 'V': 35,
  'S': 40, 'Z': 40,
  'SH': 45, 'ZH': 45,
  'TH': 35, 'DH': 35,
  'H': 30, 'HH': 30,

  // Affricates
  'CH': 40, 'JH': 40,

  // Nasals
  'M': 35, 'N': 35, 'NG': 40,

  // Liquids
  'L': 40, 'R': 40,

  // Glides/Semivowels
  'W': 35, 'Y': 30,

  // ARPABET Vowels (for compatibility)
  // Tense/long vowels
  'IY': 50, // "bee"
  'EY': 60, // "bay"
  'UW': 50, // "boo"
  'OW': 60, // "go"
  'AO': 55, // "caught"

  // Lax/short vowels
  'IH': 40,  // "bit"
  'EH': 45, // "bet"
  'UH': 45, // "book"
  'AH': 45, // "but"
  'AX': 35,  // schwa (unstressed)

  // Diphthongs
  'AY': 65, // "buy"
  'AW': 65, // "cow"
  'OY': 70, // "boy"

  // R-colored vowels
  'ER': 50, // "bird"
  'AA': 55, // "father"
  'AE': 55, // "cat"

  // Special
  'IX': 30,  // unstressed "roses"
};

// Fallback defaults
const DEFAULT_VOWEL_DURATION = 50;
const DEFAULT_CONSONANT_DURATION = 35;

/**
 * Special pause durations based on punctuation
 * Very short - word boundaries are handled by TTS timing
 */
const PAUSE_DURATIONS: Record<string, number> = {
  'PAUSE_SPACE': 0,   // No pause - word boundaries handled by TTS
  'PAUSE_COMMA': 50,  // Brief pause
  'PAUSE_PERIOD': 100, // Short pause
  'PAUSE_QUESTION': 100, // Short pause
  'PAUSE_EXCLAMATION': 100, // Short pause
  'PAUSE_SEMICOLON': 75, // Brief pause
  'PAUSE_COLON': 75, // Brief pause
};

export class VisemeMapper {
  /**
   * Map a single phoneme to its viseme ID and duration
   * Uses phoneme-specific durations for more natural timing:
   * - Stops: ~40-50ms (quick closure-release)
   * - Fricatives: ~70-90ms (continuous airflow)
   * - Vowels: ~90-150ms (sustained articulation)
   */
  public getVisemeAndDuration(phoneme: string): PhonemeMapping {
    // Handle pause tokens - return B_M_P (closed mouth)
    if (phoneme.startsWith('PAUSE_')) {
      const duration = PAUSE_DURATIONS[phoneme] || 300;
      return {
        phoneme,
        viseme: CANONICAL_VISEMES.B_M_P,
        duration,
      };
    }

    // Normalize phoneme (uppercase, remove stress markers)
    const normalizedPhoneme = phoneme.toUpperCase().replace(/[0-9]/g, '');

    const visemeId = PHONEME_TO_VISEME_MAP[normalizedPhoneme] ?? CANONICAL_VISEMES.B_M_P;

    // Use phoneme-specific duration if available, otherwise fall back to vowel/consonant defaults
    let baseDuration = PHONEME_DURATIONS[normalizedPhoneme];
    if (baseDuration === undefined) {
      const isVowelPhoneme = this.isVowel(normalizedPhoneme);
      baseDuration = isVowelPhoneme ? DEFAULT_VOWEL_DURATION : DEFAULT_CONSONANT_DURATION;
    }

    return {
      phoneme: normalizedPhoneme,
      viseme: visemeId,
      duration: baseDuration,
    };
  }

  /**
   * Map an array of phonemes to viseme sequence
   */
  public mapPhonemesToVisemes(phonemes: string[]): PhonemeMapping[] {
    return phonemes.map(phoneme => this.getVisemeAndDuration(phoneme));
  }

  /**
   * Get viseme ID from phoneme (convenience method)
   */
  public getViseme(phoneme: string): VisemeID {
    return this.getVisemeAndDuration(phoneme).viseme;
  }

  /**
   * Check if a phoneme is a vowel (typically longer duration)
   */
  public isVowel(phoneme: string): boolean {
    const normalizedPhoneme = phoneme.toUpperCase().replace(/[0-9]/g, '');
    // Vowel phonemes - includes DoubleMetaphone single letters and ARPABET codes
    const vowels = new Set([
      // DoubleMetaphone single-letter vowels
      'A', 'E', 'I', 'O', 'U',
      // ARPABET vowels
      'AA', 'AE', 'AH', 'AO', 'AW', 'AX', 'AY',
      'EH', 'ER', 'EY',
      'IH', 'IX', 'IY',
      'OW', 'OY',
      'UH', 'UW'
    ]);
    return vowels.has(normalizedPhoneme);
  }

  /**
   * Adjust duration based on speech rate
   */
  public adjustDuration(baseDuration: number, speechRate: number): number {
    return Math.round(baseDuration / speechRate);
  }

  /**
   * Get all supported phonemes
   */
  public getSupportedPhonemes(): string[] {
    return Object.keys(PHONEME_TO_VISEME_MAP);
  }

  /**
   * Get phoneme to viseme mapping table (for debugging)
   */
  public getMappingTable(): Record<string, VisemeID> {
    return { ...PHONEME_TO_VISEME_MAP };
  }
}

// Export singleton instance
export const visemeMapper = new VisemeMapper();
