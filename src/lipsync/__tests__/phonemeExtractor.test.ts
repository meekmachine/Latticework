import { describe, expect, it } from 'vitest';
import { PhonemeExtractor } from '../PhonemeExtractor';

describe('PhonemeExtractor punctuation handling', () => {
  const extractor = new PhonemeExtractor();

  it('keeps comma punctuation as a pause token', () => {
    const phonemes = extractor.extractPhonemes('hello,');

    expect(phonemes).toContain('PAUSE_COMMA');
    expect(phonemes[phonemes.length - 1]).toBe('PAUSE_COMMA');
  });

  it('keeps period punctuation as a sentence pause token', () => {
    const phonemes = extractor.extractPhonemes('world.');

    expect(phonemes).toContain('PAUSE_PERIOD');
    expect(phonemes[phonemes.length - 1]).toBe('PAUSE_PERIOD');
  });

  it('preserves multi-word punctuation order', () => {
    const phonemes = extractor.extractPhonemes('hello, world.');
    const commaIndex = phonemes.indexOf('PAUSE_COMMA');
    const spaceIndex = phonemes.indexOf('PAUSE_SPACE');
    const periodIndex = phonemes.indexOf('PAUSE_PERIOD');

    expect(commaIndex).toBeGreaterThan(-1);
    expect(spaceIndex).toBeGreaterThan(commaIndex);
    expect(periodIndex).toBeGreaterThan(spaceIndex);
  });
});
