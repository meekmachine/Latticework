import { describe, expect, it } from 'vitest';
import { buildTextSnippet, buildVocalSnippet } from '../snippetBuilder';

describe('buildVocalSnippet', () => {
  it('keeps playback neutral when timings are already rate-scaled', () => {
    const snippet = buildVocalSnippet(
      [
        { visemeId: 3, offsetMs: 0, durationMs: 120 },
        { visemeId: 4, offsetMs: 120, durationMs: 80 },
      ],
      { speechRate: 0.6, jawScale: 1.2 }
    );

    expect(snippet.snippetPlaybackRate).toBe(1.0);
    expect(snippet.snippetJawScale).toBe(1.2);
    expect(snippet.maxTime).toBeCloseTo(0.208, 3);
  });

  it('builds text snippets with a stable neutral playback rate', () => {
    const snippet = buildTextSnippet(
      'Hello world',
      [
        { visemeId: 11, offsetMs: 0, durationMs: 90 },
        { visemeId: 3, offsetMs: 90, durationMs: 110 },
      ],
      { speechRate: 1.4 }
    );

    expect(snippet.name).toMatch(/^vocal_hello_world_/);
    expect(snippet.snippetPlaybackRate).toBe(1.0);
    expect(snippet.curves['11']).toBeDefined();
    expect(snippet.curves['3']).toBeDefined();
  });
});
