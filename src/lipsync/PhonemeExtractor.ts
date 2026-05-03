/**
 * PhonemeExtractor
 * Extracts phonemes from text for lip-sync animation
 *
 * Uses simple letter-pattern matching to convert English text to phonemes.
 * This produces consistent vowel and consonant phonemes for viseme mapping.
 */

/**
 * Letter pattern to phoneme mapping
 * Processes common English letter patterns into phoneme representations
 */
const LETTER_PATTERNS: Array<[RegExp, string[]]> = [
  // Multi-letter patterns (order matters - check longer patterns first)
  [/^th/i, ['TH']],
  [/^sh/i, ['SH']],
  [/^ch/i, ['CH']],
  [/^wh/i, ['W']],
  [/^ph/i, ['F']],
  [/^gh/i, ['G']],  // ghost, ghoul
  [/^ng/i, ['NG']],
  [/^ck/i, ['K']],
  [/^qu/i, ['K', 'W']],

  // Vowel combinations
  [/^oo/i, ['UW']],
  [/^ee/i, ['IY']],
  [/^ea/i, ['IY']],
  [/^ai/i, ['EY']],
  [/^ay/i, ['EY']],
  [/^oa/i, ['OW']],
  [/^ou/i, ['AW']],
  [/^ow/i, ['OW']],
  [/^oi/i, ['OY']],
  [/^oy/i, ['OY']],
  [/^au/i, ['AO']],
  [/^aw/i, ['AO']],
  [/^ie/i, ['IY']],
  [/^ei/i, ['EY']],
  [/^ue/i, ['UW']],
  [/^ui/i, ['UW']],

  // Single vowels
  [/^a/i, ['AE']],
  [/^e/i, ['EH']],
  [/^i/i, ['IH']],
  [/^o/i, ['AA']],
  [/^u/i, ['AH']],
  [/^y$/i, ['IY']],  // y at end of word
  [/^y/i, ['Y']],    // y at beginning/middle

  // Consonants
  [/^b/i, ['B']],
  [/^c(?=[ei])/i, ['S']],  // c before e or i = S sound
  [/^c/i, ['K']],
  [/^d/i, ['D']],
  [/^f/i, ['F']],
  [/^g(?=[ei])/i, ['JH']], // g before e or i often = J sound (simplified)
  [/^g/i, ['G']],
  [/^h/i, ['HH']],
  [/^j/i, ['JH']],
  [/^k/i, ['K']],
  [/^l/i, ['L']],
  [/^m/i, ['M']],
  [/^n/i, ['N']],
  [/^p/i, ['P']],
  [/^r/i, ['R']],
  [/^s/i, ['S']],
  [/^t/i, ['T']],
  [/^v/i, ['V']],
  [/^w/i, ['W']],
  [/^x/i, ['K', 'S']],
  [/^z/i, ['Z']],
];

export class PhonemeExtractor {
  /**
   * Extract phonemes from text
   * Returns array of phoneme strings including PAUSE tokens
   */
  public extractPhonemes(text: string): string[] {
    const tokens = this.tokenize(text);
    const phonemes: string[] = [];

    if (!tokens || tokens.length === 0) return phonemes;

    tokens.forEach((token) => {
      if (/^\s+$/.test(token) || /^[,.;:!?]$/.test(token)) {
        phonemes.push(this.getPauseForChar(token));
      } else {
        // Convert word to phonemes using letter patterns
        const wordPhonemes = this.wordToPhonemes(token);
        phonemes.push(...wordPhonemes);
      }
    });

    return phonemes;
  }

  /**
   * Convert a single word to phonemes using letter pattern matching
   */
  private wordToPhonemes(word: string): string[] {
    const phonemes: string[] = [];
    let remaining = word.toLowerCase().replace(/[^a-z]/g, '');

    while (remaining.length > 0) {
      let matched = false;

      for (const [pattern, phoneList] of LETTER_PATTERNS) {
        const match = remaining.match(pattern);
        if (match) {
          phonemes.push(...phoneList);
          remaining = remaining.slice(match[0].length);
          matched = true;
          break;
        }
      }

      // If no pattern matched, skip the character
      if (!matched) {
        remaining = remaining.slice(1);
      }
    }

    return phonemes;
  }

  /**
   * Get pause token for punctuation/whitespace
   */
  private getPauseForChar(char: string): string {
    switch (char) {
      case ' ':
        return 'PAUSE_SPACE';
      case ',':
        return 'PAUSE_COMMA';
      case ';':
        return 'PAUSE_SEMICOLON';
      case ':':
        return 'PAUSE_COLON';
      case '.':
        return 'PAUSE_PERIOD';
      case '?':
        return 'PAUSE_QUESTION';
      case '!':
        return 'PAUSE_EXCLAMATION';
      default:
        return 'PAUSE_SPACE';
    }
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    if (!text) return [];
    return text.match(/[a-z]+|[,.;:!?]|\s+/gi) ?? [];
  }
}

// Export singleton instance
export const phonemeExtractor = new PhonemeExtractor();
