import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('TTSService runtime ownership', () => {
  it('does not initialize the legacy LipSync runtime', () => {
    const source = readFileSync(new URL('../ttsService.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('createLipSyncService');
    expect(source).not.toContain('useExperimentalVocal');
    expect(source).toContain('createVocalService');
    expect(source).toContain('startExternalTimeline');
  });
});
