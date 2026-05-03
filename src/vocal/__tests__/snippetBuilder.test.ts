import { describe, expect, it } from 'vitest';
import { buildTextSnippet, buildVocalSnippet } from '../snippetBuilder';
import { JAW_AU } from '../types';
import { CANONICAL_VISEMES } from '../../lipsync/canonicalVisemes';
import type { AnimationCurve, VocalSnippet } from '../types';

function sampleAt(curve: AnimationCurve | undefined, time: number): number {
  if (!curve || curve.length === 0) return 0;
  if (time <= curve[0].time) return curve[0].intensity;
  if (time >= curve[curve.length - 1].time) return curve[curve.length - 1].intensity;

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const progress = (time - a.time) / span;
      return a.intensity + (b.intensity - a.intensity) * progress;
    }
  }

  return 0;
}

function lipActivationTotalAt(snippet: VocalSnippet, time: number): number {
  return Object.entries(snippet.curves)
    .filter(([key]) => key !== JAW_AU)
    .reduce((sum, [, curve]) => sum + sampleAt(curve, time), 0);
}

function maxLipPeak(snippet: VocalSnippet): number {
  return Math.max(
    ...Object.entries(snippet.curves)
      .filter(([key]) => key !== JAW_AU)
      .flatMap(([, curve]) => curve.map((frame) => frame.intensity))
  );
}

describe('buildVocalSnippet', () => {
  it('keeps playback neutral when timings are already rate-scaled', () => {
    const snippet = buildVocalSnippet(
      [
        { visemeId: CANONICAL_VISEMES.Oh as any, offsetMs: 0, durationMs: 120 },
        { visemeId: CANONICAL_VISEMES.Ih as any, offsetMs: 120, durationMs: 80 },
      ],
      { speechRate: 0.6, jawScale: 1.2 }
    );

    expect(snippet.snippetPlaybackRate).toBe(1.0);
    expect(snippet.snippetJawScale).toBe(1.2);
    expect(snippet.maxTime).toBeCloseTo(0.2, 3);
  });

  it('builds text snippets with a stable neutral playback rate', () => {
    const snippet = buildTextSnippet(
      'Hello world',
      [
        { visemeId: CANONICAL_VISEMES.B_M_P as any, offsetMs: 0, durationMs: 90 },
        { visemeId: CANONICAL_VISEMES.Oh as any, offsetMs: 90, durationMs: 110 },
      ],
      { speechRate: 1.4 }
    );

    expect(snippet.name).toMatch(/^vocal_hello_world_/);
    expect(snippet.snippetPlaybackRate).toBe(1.0);
    expect(snippet.curves[String(CANONICAL_VISEMES.B_M_P)]).toBeDefined();
    expect(snippet.curves[String(CANONICAL_VISEMES.Oh)]).toBeDefined();
    expect(snippet.curves[JAW_AU]).toBeDefined();
  });

  it('preserves hard bilabial closure peaks', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.B_M_P as any, offsetMs: 0, durationMs: 40 },
    ]);

    const peak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.B_M_P)].map((frame) => frame.intensity));

    expect(peak).toBe(1);
  });

  it('adds an explicit jaw curve so speech remains visible without morph bindings', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 120 },
      { visemeId: CANONICAL_VISEMES.B_M_P as any, offsetMs: 140, durationMs: 60 },
    ]);

    const jawCurve = snippet.curves[JAW_AU];
    const jawPeak = Math.max(...jawCurve.map((frame) => frame.intensity));

    expect(jawCurve).toBeDefined();
    expect(jawPeak).toBeGreaterThan(0.5);
    expect(snippet.autoVisemeJaw).toBe(false);
  });

  it('applies jaw scale to explicit jaw curves', () => {
    const fullJawSnippet = buildVocalSnippet(
      [{ visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 120 }],
      { jawScale: 1 }
    );
    const reducedJawSnippet = buildVocalSnippet(
      [{ visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 120 }],
      { jawScale: 0.5 }
    );

    const fullPeak = Math.max(...fullJawSnippet.curves[JAW_AU].map((frame) => frame.intensity));
    const reducedPeak = Math.max(...reducedJawSnippet.curves[JAW_AU].map((frame) => frame.intensity));

    expect(reducedPeak).toBeCloseTo(fullPeak * 0.5);
  });

  it('keeps the jaw curve continuous across dense non-closure visemes', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 120 },
      { visemeId: CANONICAL_VISEMES.EE as any, offsetMs: 60, durationMs: 120 },
      { visemeId: CANONICAL_VISEMES.F_V as any, offsetMs: 120, durationMs: 80 },
    ]);

    const midSpeechFrames = snippet.curves[JAW_AU].filter((frame) => frame.time > 0.04 && frame.time < 0.18);

    expect(midSpeechFrames.length).toBeGreaterThan(0);
    expect(midSpeechFrames.every((frame) => frame.intensity > 0)).toBe(true);
  });

  it('keeps fricatives lower than vowel lip shapes', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 120 },
      { visemeId: CANONICAL_VISEMES.S_Z as any, offsetMs: 150, durationMs: 80 },
    ]);

    const vowelPeak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.Ah)].map((frame) => frame.intensity));
    const fricativePeak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.S_Z)].map((frame) => frame.intensity));

    expect(vowelPeak).toBeGreaterThan(fricativePeak);
    expect(fricativePeak).toBeLessThanOrEqual(0.8);
  });

  it('gives rounded W/OO a distinct visible lip profile', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Oh as any, offsetMs: 0, durationMs: 140 },
      { visemeId: CANONICAL_VISEMES.W_OO as any, offsetMs: 160, durationMs: 140 },
    ]);

    const ohPeak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.Oh)].map((frame) => frame.intensity));
    const roundedPeak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.W_OO)].map((frame) => frame.intensity));

    expect(roundedPeak).toBeGreaterThan(ohPeak);
    expect(roundedPeak).toBeCloseTo(0.98, 3);
  });

  it('eases non-closure viseme shoulders without reducing the distinctive peak', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 160 },
    ]);

    const vowelCurve = snippet.curves[String(CANONICAL_VISEMES.Ah)];
    const peak = Math.max(...vowelCurve.map((frame) => frame.intensity));
    const shoulderFrames = vowelCurve.slice(1, -1).filter((frame) => frame.intensity > 0 && frame.intensity < peak);

    expect(vowelCurve.length).toBeGreaterThan(4);
    expect(shoulderFrames.length).toBeGreaterThanOrEqual(2);
    expect(peak).toBeCloseTo(0.92, 3);
  });

  it('does not smear coarticulation into bilabial closures', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.B_M_P as any, offsetMs: 100, durationMs: 50 },
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 150, durationMs: 100 },
    ]);

    expect(snippet.curves[String(CANONICAL_VISEMES.B_M_P)][0].time).toBeCloseTo(0.1, 3);
    expect(snippet.curves[String(CANONICAL_VISEMES.Ah)][0].time).toBeCloseTo(0.15, 3);
  });

  it('caps overlapping lip activations so dense Azure timelines do not pile up', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 160 },
      { visemeId: CANONICAL_VISEMES.EE as any, offsetMs: 60, durationMs: 160 },
      { visemeId: CANONICAL_VISEMES.F_V as any, offsetMs: 110, durationMs: 100 },
    ]);

    expect(lipActivationTotalAt(snippet, 0.13)).toBeLessThanOrEqual(1.06);
  });

  it('keeps high UI intensity capped before Loom3 playback scaling', () => {
    const snippet = buildVocalSnippet(
      [
        { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 160 },
        { visemeId: CANONICAL_VISEMES.EE as any, offsetMs: 60, durationMs: 160 },
        { visemeId: CANONICAL_VISEMES.F_V as any, offsetMs: 110, durationMs: 100 },
      ],
      { intensity: 1.6 }
    );

    expect(snippet.snippetIntensityScale).toBe(1);
    expect(lipActivationTotalAt(snippet, 0.13)).toBeLessThanOrEqual(1.06);
    expect(maxLipPeak(snippet)).toBeLessThanOrEqual(1);
  });

  it('preserves phoneme-class shape differences under high UI intensity', () => {
    const snippet = buildVocalSnippet(
      [
        { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 120 },
        { visemeId: CANONICAL_VISEMES.S_Z as any, offsetMs: 180, durationMs: 90 },
      ],
      { intensity: 1.6 }
    );

    const vowelPeak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.Ah)].map((frame) => frame.intensity));
    const fricativePeak = Math.max(...snippet.curves[String(CANONICAL_VISEMES.S_Z)].map((frame) => frame.intensity));

    expect(vowelPeak).toBeGreaterThan(fricativePeak + 0.04);
    expect(fricativePeak).toBeLessThan(0.94);
  });

  it('keeps bilabial closures dominant when adjacent vowels overlap', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 160 },
      { visemeId: CANONICAL_VISEMES.B_M_P as any, offsetMs: 70, durationMs: 80 },
    ]);

    const closure = sampleAt(snippet.curves[String(CANONICAL_VISEMES.B_M_P)], 0.09);
    const vowel = sampleAt(snippet.curves[String(CANONICAL_VISEMES.Ah)], 0.09);

    expect(closure).toBeCloseTo(1, 3);
    expect(vowel).toBeLessThanOrEqual(0.04);
  });

  it('reduces lip keys conservatively while preserving vowel peaks', () => {
    const snippet = buildVocalSnippet([
      { visemeId: CANONICAL_VISEMES.Ah as any, offsetMs: 0, durationMs: 160 },
    ]);

    const vowelCurve = snippet.curves[String(CANONICAL_VISEMES.Ah)];
    const peak = Math.max(...vowelCurve.map((frame) => frame.intensity));

    expect(vowelCurve.length).toBeLessThanOrEqual(6);
    expect(peak).toBeCloseTo(0.92, 3);
  });
});
