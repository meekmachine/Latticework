/**
 * VisemeMapper
 * Maps phonemes to the canonical 15-slot viseme order used by loom3.
 *
 * Canonical VISEME_KEYS (indices 0-14):
 * 0: EE, 1: Ah, 2: Oh, 3: OO, 4: I, 5: U, 6: W, 7: L,
 * 8: F_V, 9: Th, 10: S_Z, 11: B_M_P, 12: K_G_H_NG, 13: AE, 14: R
 */

import type { VisemeID, PhonemeMapping } from './types';

/**
 * Phoneme to canonical viseme index mapping table
 * Maps directly to viseme slot indices (0-14)
 */
/**
 * Jaw opening amount per canonical viseme slot (0-1 scale)
 * Based on linguistic analysis of mouth aperture for each viseme shape:
 * - Open vowels (Ah, AE): High jaw opening (0.7-0.8)
 * - Round vowels (Oh, OO): Medium-high (0.5-0.6)
 * - Close vowels (EE, I): Low (0.2)
 * - Bilabials (B_M_P): Closed (0.0)
 * - Fricatives (F_V, S_Z): Minimal (0.1)
 *
 * Canonical indices: 0:EE, 1:Ah, 2:Oh, 3:OO, 4:I, 5:U, 6:W, 7:L, 8:F_V, 9:Th, 10:S_Z, 11:B_M_P, 12:K_G_H_NG, 13:AE, 14:R
 */
const VISEME_JAW_AMOUNTS: Record<number, number> = {
  0: 0.2,   // EE - slight opening, lips spread
  1: 0.8,   // Ah - wide open (largest aperture)
  2: 0.6,   // Oh - medium-high, rounded
  3: 0.5,   // OO - medium, protruded lips
  4: 0.2,   // I - slight opening
  5: 0.5,   // U - medium, rounded
  6: 0.4,   // W - medium, protruded lips
  7: 0.3,   // L - tongue tip, moderate
  8: 0.1,   // F_V - teeth on lip, minimal jaw
  9: 0.15,  // Th - tongue between teeth
  10: 0.1,  // S_Z - teeth close, slight gap
  11: 0.0,  // B_M_P - lips sealed, jaw closed
  12: 0.35, // K_G_H_NG - back of tongue, moderate
  13: 0.75, // AE - open front vowel (cat, bat)
  14: 0.35, // R - retroflex, moderate opening
};

/**
 * Get the jaw opening amount for a given viseme
 * Used to generate AU 26 (jaw drop) curves that match the viseme
 */
export function getJawAmountForViseme(visemeId: number): number {
  return VISEME_JAW_AMOUNTS[visemeId] ?? 0.3;
}

/**
 * Phoneme to canonical viseme index mapping table
 * Canonical indices: 0:EE, 1:Ah, 2:Oh, 3:OO, 4:I, 5:U, 6:W, 7:L, 8:F_V, 9:Th, 10:S_Z, 11:B_M_P, 12:K_G_H_NG, 13:AE, 14:R
 */
const PHONEME_TO_VISEME_MAP: Record<string, VisemeID> = {
  // Silence - maps to B_M_P (closed mouth)
  'sil': 11,
  'pau': 11,
  'PAUSE': 11,

  // DoubleMetaphone single-letter vowels (canonical viseme indices)
  'A': 1,       // → Ah (index 1)
  'E': 0,       // → EE (index 0)
  'I': 4,       // → I (index 4)
  'O': 2,       // → Oh (index 2)
  'U': 5,       // → U (index 5)

  // DoubleMetaphone special characters
  '0': 9,       // → Th (index 9)
  'X': 10,      // → S_Z (index 10, for SH-like sounds)
  'J': 12,      // → K_G_H_NG (index 12, for J sound)

  // ARPABET vowels (canonical viseme indices)
  'AE': 13,     // → AE (index 13)
  'AX': 1,      // → Ah (index 1)
  'AH': 1,      // → Ah (index 1)
  'AA': 1,      // → Ah (index 1)
  'AO': 2,      // → Oh (index 2)
  'EY': 0,      // → EE (index 0)
  'EH': 0,      // → EE (index 0)
  'UH': 3,      // → OO (index 3)
  'ER': 14,     // → R (index 14)
  'Y': 4,       // → I (index 4)
  'IY': 4,      // → I (index 4)
  'IH': 4,      // → I (index 4)
  'IX': 4,      // → I (index 4)
  'W': 6,       // → W (index 6)
  'UW': 3,      // → OO (index 3)
  'OW': 2,      // → Oh (index 2)
  'AW': 1,      // → Ah (index 1)
  'OY': 2,      // → Oh (index 2)
  'AY': 1,      // → Ah (index 1)

  // Consonants (canonical viseme indices)
  'H': 1,       // → Ah (index 1, open glottal)
  'HH': 1,      // → Ah (index 1)
  'R': 14,      // → R (index 14)
  'L': 7,       // → L (index 7)
  'S': 10,      // → S_Z (index 10)
  'Z': 10,      // → S_Z (index 10)
  'SH': 10,     // → S_Z (index 10)
  'CH': 10,     // → S_Z (index 10)
  'JH': 10,     // → S_Z (index 10)
  'ZH': 10,     // → S_Z (index 10)
  'TH': 9,      // → Th (index 9)
  'DH': 9,      // → Th (index 9)
  'F': 8,       // → F_V (index 8)
  'V': 8,       // → F_V (index 8)
  'D': 7,       // → L (index 7, tongue tip)
  'T': 7,       // → L (index 7, tongue tip)
  'N': 7,       // → L (index 7, tongue tip)
  'K': 12,      // → K_G_H_NG (index 12)
  'G': 12,      // → K_G_H_NG (index 12)
  'NG': 12,     // → K_G_H_NG (index 12)
  'P': 11,      // → B_M_P (index 11)
  'B': 11,      // → B_M_P (index 11)
  'M': 11,      // → B_M_P (index 11)
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
        viseme: 11, // B_M_P (closed mouth)
        duration,
      };
    }

    // Normalize phoneme (uppercase, remove stress markers)
    const normalizedPhoneme = phoneme.toUpperCase().replace(/[0-9]/g, '');

    const visemeId = PHONEME_TO_VISEME_MAP[normalizedPhoneme] ?? 11; // Default to B_M_P (closed)

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
