/**
 * Test Utilities for Lip-Sync Animation System
 * Provides comprehensive testing, validation, and debugging tools
 */

import { PhonemeExtractor } from './PhonemeExtractor';
import { VisemeMapper } from './VisemeMapper';
import { VISEME_KEYS } from '@lovelace_lol/loom3';

export interface TestResult {
  passed: boolean;
  message: string;
  details?: any;
}

export interface LipSyncTestSuite {
  testPhonemeExtraction: () => TestResult[];
  testVisemeMapping: () => TestResult[];
  testARKitConversion: () => TestResult[];
  testCoarticulation: () => TestResult[];
  testTimingAccuracy: () => TestResult[];
  runAllTests: () => { total: number; passed: number; failed: number; results: TestResult[] };
}

/**
 * Create a comprehensive test suite for lip-sync system
 */
export function createLipSyncTestSuite(): LipSyncTestSuite {
  const phonemeExtractor = new PhonemeExtractor();
  const visemeMapper = new VisemeMapper();

  /**
   * Test phoneme extraction from various texts
   */
  function testPhonemeExtraction(): TestResult[] {
    const results: TestResult[] = [];

    // Test 1: Basic word
    const hello = phonemeExtractor.extractPhonemes('hello');
    results.push({
      passed: hello.length > 0,
      message: 'Extract phonemes from "hello"',
      details: { phonemes: hello, count: hello.length }
    });

    // Test 2: Complex sentence
    const sentence = phonemeExtractor.extractPhonemes('The quick brown fox jumps over the lazy dog.');
    results.push({
      passed: sentence.length > 20,
      message: 'Extract phonemes from complex sentence',
      details: { phonemes: sentence, count: sentence.length }
    });

    // Test 3: Punctuation handling
    const withPunctuation = phonemeExtractor.extractPhonemes('Hello, world!');
    const hasPause = withPunctuation.some(p => p.startsWith('PAUSE'));
    results.push({
      passed: hasPause,
      message: 'Handle punctuation with pauses',
      details: { phonemes: withPunctuation, hasPause }
    });

    // Test 4: Technical terms
    const technical = phonemeExtractor.extractPhonemes('DoubleMetaphone algorithm');
    results.push({
      passed: technical.length > 0,
      message: 'Extract phonemes from technical terms',
      details: { phonemes: technical, count: technical.length }
    });

    // Test 5: Numbers and special characters
    const mixed = phonemeExtractor.extractPhonemes('Hello 123!');
    results.push({
      passed: mixed.length > 0,
      message: 'Handle mixed alphanumeric input',
      details: { phonemes: mixed }
    });

    return results;
  }

  /**
   * Test viseme mapping accuracy
   * VisemeMapper now returns ARKit indices directly (0-14)
   */
  function testVisemeMapping(): TestResult[] {
    const results: TestResult[] = [];

    // Test 1: Vowel phonemes map to valid ARKit indices (0-14)
    const vowelPhonemes = ['AE', 'AA', 'IY', 'UW', 'OW'];
    const vowelTests = vowelPhonemes.map(phoneme => {
      const mapping = visemeMapper.getVisemeAndDuration(phoneme);
      return {
        passed: mapping.viseme >= 0 && mapping.viseme <= 14,
        message: `Vowel ${phoneme} maps to ARKit viseme ${mapping.viseme} (${VISEME_KEYS[mapping.viseme]})`,
        details: mapping
      };
    });
    results.push(...vowelTests);

    // Test 2: Consonant phonemes map to valid ARKit indices
    const consonantPhonemes = ['P', 'B', 'M', 'S', 'Z', 'T', 'D'];
    const consonantTests = consonantPhonemes.map(phoneme => {
      const mapping = visemeMapper.getVisemeAndDuration(phoneme);
      return {
        passed: mapping.viseme >= 0 && mapping.viseme <= 14,
        message: `Consonant ${phoneme} maps to ARKit viseme ${mapping.viseme} (${VISEME_KEYS[mapping.viseme]})`,
        details: mapping
      };
    });
    results.push(...consonantTests);

    // Test 3: Duration differences between vowels and consonants
    const vowelDuration = visemeMapper.getVisemeAndDuration('AA').duration;
    const consonantDuration = visemeMapper.getVisemeAndDuration('P').duration;
    results.push({
      passed: vowelDuration > consonantDuration,
      message: 'Vowels have longer duration than consonants',
      details: { vowelDuration, consonantDuration }
    });

    // Test 4: Pause tokens map to B_M_P (closed mouth, index 11)
    const pauseMapping = visemeMapper.getVisemeAndDuration('PAUSE_COMMA');
    results.push({
      passed: pauseMapping.viseme === 11 && pauseMapping.duration > 0,
      message: 'Pause tokens map to B_M_P (closed mouth) with duration',
      details: pauseMapping
    });

    return results;
  }

  /**
   * Test ARKit viseme mapping
   * VisemeMapper now outputs ARKit indices directly - no conversion needed
   */
  function testARKitConversion(): TestResult[] {
    const results: TestResult[] = [];

    // Test 1: All ARKit viseme indices have valid keys
    for (let arkitIndex = 0; arkitIndex <= 14; arkitIndex++) {
      const arkitKey = VISEME_KEYS[arkitIndex];
      results.push({
        passed: arkitKey !== undefined && arkitKey.length > 0,
        message: `ARKit index ${arkitIndex} → ${arkitKey}`,
        details: { arkitIndex, arkitKey }
      });
    }

    // Test 2: Bilabial consonants (P, B, M) map to B_M_P (index 11)
    const bilabialMapping = visemeMapper.getVisemeAndDuration('P');
    results.push({
      passed: bilabialMapping.viseme === 11, // B_M_P
      message: 'Bilabial consonants (P, B, M) map to B_M_P (closed mouth)',
      details: { viseme: bilabialMapping.viseme, key: VISEME_KEYS[bilabialMapping.viseme] }
    });

    // Test 3: Open vowels (AA) map to Ah (index 3)
    const openVowelMapping = visemeMapper.getVisemeAndDuration('AA');
    results.push({
      passed: openVowelMapping.viseme === 3, // Ah
      message: 'Open vowels (AA) map to Ah (wide mouth)',
      details: { viseme: openVowelMapping.viseme, key: VISEME_KEYS[openVowelMapping.viseme] }
    });

    return results;
  }

  /**
   * Test coarticulation behavior
   */
  function testCoarticulation(): TestResult[] {
    const results: TestResult[] = [];

    // Simulate adjacent visemes
    const word = 'hello';
    const phonemes = phonemeExtractor.extractPhonemes(word);
    const visemes = visemeMapper.mapPhonemesToVisemes(phonemes);

    // Test 1: Adjacent visemes exist
    results.push({
      passed: visemes.length >= 2,
      message: 'Word produces multiple visemes for coarticulation',
      details: { word, visemeCount: visemes.length, visemes }
    });

    // Test 2: Timing overlap is possible
    let totalDuration = 0;
    visemes.forEach(v => {
      totalDuration += v.duration;
    });
    results.push({
      passed: totalDuration > 0,
      message: 'Total viseme duration is positive',
      details: { totalDuration, average: totalDuration / visemes.length }
    });

    // Test 3: Check for variety in visemes (not all the same)
    const uniqueVisemes = new Set(visemes.map(v => v.viseme));
    results.push({
      passed: uniqueVisemes.size > 1,
      message: 'Word produces varied visemes (not monotone)',
      details: { uniqueCount: uniqueVisemes.size, unique: Array.from(uniqueVisemes) }
    });

    return results;
  }

  /**
   * Test timing accuracy and performance
   */
  function testTimingAccuracy(): TestResult[] {
    const results: TestResult[] = [];

    // Test 1: Phoneme extraction performance
    const longText = 'The saddest aspect of life right now is that science gathers knowledge faster than society gathers wisdom.'.repeat(5);
    const startTime = performance.now();
    const phonemes = phonemeExtractor.extractPhonemes(longText);
    const extractTime = performance.now() - startTime;

    results.push({
      passed: extractTime < 50, // Should complete in < 50ms
      message: `Phoneme extraction performance: ${extractTime.toFixed(2)}ms for ${phonemes.length} phonemes`,
      details: { extractTime, phonemeCount: phonemes.length, text: longText }
    });

    // Test 2: Viseme mapping performance
    const mapStartTime = performance.now();
    const visemes = visemeMapper.mapPhonemesToVisemes(phonemes);
    const mapTime = performance.now() - mapStartTime;

    results.push({
      passed: mapTime < 20, // Should complete in < 20ms
      message: `Viseme mapping performance: ${mapTime.toFixed(2)}ms for ${visemes.length} visemes`,
      details: { mapTime, visemeCount: visemes.length }
    });

    // Test 3: Viseme key lookup performance
    const keyLookupStartTime = performance.now();
    visemes.forEach(v => {
      const key = VISEME_KEYS[v.viseme];
      // Verify key exists
      if (!key) throw new Error(`Invalid viseme index: ${v.viseme}`);
    });
    const keyLookupTime = performance.now() - keyLookupStartTime;

    results.push({
      passed: keyLookupTime < 10, // Should complete in < 10ms
      message: `Viseme key lookup performance: ${keyLookupTime.toFixed(2)}ms for ${visemes.length} lookups`,
      details: { keyLookupTime, lookupCount: visemes.length }
    });

    // Test 4: Total latency
    const totalLatency = extractTime + mapTime + keyLookupTime;
    results.push({
      passed: totalLatency < 100, // Total should be < 100ms
      message: `Total lip-sync latency: ${totalLatency.toFixed(2)}ms (target: <100ms)`,
      details: { totalLatency, breakdown: { extractTime, mapTime, keyLookupTime } }
    });

    return results;
  }

  /**
   * Run all tests and return summary
   */
  function runAllTests() {
    const allResults: TestResult[] = [
      ...testPhonemeExtraction(),
      ...testVisemeMapping(),
      ...testARKitConversion(),
      ...testCoarticulation(),
      ...testTimingAccuracy(),
    ];

    const passed = allResults.filter(r => r.passed).length;
    const failed = allResults.filter(r => !r.passed).length;

    return {
      total: allResults.length,
      passed,
      failed,
      results: allResults
    };
  }

  return {
    testPhonemeExtraction,
    testVisemeMapping,
    testARKitConversion,
    testCoarticulation,
    testTimingAccuracy,
    runAllTests
  };
}

/**
 * Validate animation snippet structure
 */
export function validateAnimationSnippet(snippet: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!snippet.name) errors.push('Missing snippet name');
  if (!snippet.curves || typeof snippet.curves !== 'object') errors.push('Missing or invalid curves object');
  if (typeof snippet.maxTime !== 'number' || snippet.maxTime <= 0) errors.push('Invalid maxTime');
  if (snippet.snippetCategory === undefined) errors.push('Missing snippetCategory');
  if (typeof snippet.snippetPriority !== 'number') errors.push('Invalid snippetPriority');

  // Validate curves
  if (snippet.curves) {
    Object.entries(snippet.curves).forEach(([curveId, keyframes]: [string, any]) => {
      if (!Array.isArray(keyframes)) {
        errors.push(`Curve "${curveId}" is not an array`);
        return;
      }

      keyframes.forEach((kf: any, idx: number) => {
        if (typeof kf.time !== 'number') errors.push(`Curve "${curveId}" keyframe ${idx}: missing time`);
        if (typeof kf.intensity !== 'number') errors.push(`Curve "${curveId}" keyframe ${idx}: missing intensity`);
        if (kf.intensity < 0 || kf.intensity > 100) errors.push(`Curve "${curveId}" keyframe ${idx}: intensity out of range (0-100)`);
      });

      // Check keyframes are sorted
      for (let i = 0; i < keyframes.length - 1; i++) {
        if (keyframes[i].time > keyframes[i + 1].time) {
          errors.push(`Curve "${curveId}" keyframes not sorted by time`);
          break;
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate test report
 */
export function generateTestReport(testSuite: LipSyncTestSuite): string {
  const results = testSuite.runAllTests();
  const lines: string[] = [];

  lines.push('=== LIP-SYNC SYSTEM TEST REPORT ===\n');
  lines.push(`Total Tests: ${results.total}`);
  lines.push(`Passed: ${results.passed} ✓`);
  lines.push(`Failed: ${results.failed} ✗`);
  lines.push(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%\n`);

  lines.push('\n=== DETAILED RESULTS ===\n');
  results.results.forEach((result, idx) => {
    const status = result.passed ? '✓' : '✗';
    lines.push(`${idx + 1}. ${status} ${result.message}`);
    if (result.details && !result.passed) {
      lines.push(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    }
  });

  return lines.join('\n');
}

/**
 * Export test utilities for console/debugging
 */
export const LipSyncTestUtils = {
  createTestSuite: createLipSyncTestSuite,
  validateSnippet: validateAnimationSnippet,
  generateReport: generateTestReport,
};

// Make available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).LipSyncTestUtils = LipSyncTestUtils;
}
