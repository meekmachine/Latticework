import { describe, expect, it } from 'vitest';
import { VISEME_JAW_AMOUNTS, VISEME_KEYS } from '@lovelace_lol/loom3';
import { azureVisemesToTimeline, mapAzureVisemeIdToCC4 } from '../azureVisemeMapping';
import { getJawAmountForViseme, VisemeMapper } from '../VisemeMapper';
import { CANONICAL_VISEMES } from '../canonicalVisemes';

describe('canonical viseme mapping', () => {
  it('resolves indices from the installed loom3 15-slot viseme order', () => {
    expect(VISEME_KEYS).toHaveLength(15);
    expect(CANONICAL_VISEMES.B_M_P).toBe(VISEME_KEYS.indexOf('B_M_P'));
    expect(CANONICAL_VISEMES.Ah).toBe(VISEME_KEYS.indexOf('Ah'));
    expect(CANONICAL_VISEMES.F_V).toBe(VISEME_KEYS.indexOf('F_V'));
  });

  it('reads jaw activation from loom3 canonical defaults', () => {
    expect(getJawAmountForViseme(CANONICAL_VISEMES.B_M_P)).toBe(VISEME_JAW_AMOUNTS[CANONICAL_VISEMES.B_M_P]);
    expect(getJawAmountForViseme(CANONICAL_VISEMES.Ah)).toBe(VISEME_JAW_AMOUNTS[CANONICAL_VISEMES.Ah]);
  });

  it('documents lossy Azure groups against canonical slots', () => {
    const mapper = new VisemeMapper();

    expect(mapAzureVisemeIdToCC4(1)).toBe(CANONICAL_VISEMES.AE); // AE/AX/AH -> open wide provider group
    expect(mapAzureVisemeIdToCC4(4)).toBe(CANONICAL_VISEMES.Ih); // EY/EH/UH -> lax front provider group
    expect(mapAzureVisemeIdToCC4(7)).toBe(CANONICAL_VISEMES.W_OO); // W/UW -> shared provider group
    expect(mapAzureVisemeIdToCC4(12)).toBe(CANONICAL_VISEMES.K_G_H_NG); // H -> subtle glottal group
    expect(mapper.getViseme('UW')).toBe(CANONICAL_VISEMES.W_OO);
  });

  it('keeps the full Azure inventory spread across canonical speech classes', () => {
    const timeline = azureVisemesToTimeline(
      Array.from({ length: 21 }, (_, index) => ({
        viseme_id: index + 1,
        audio_offset: index * 0.2,
      })),
      5000,
      {
        wordTimings: [
          { word: 'bee', start_time: 1.0, end_time: 1.18 },
        ],
      }
    );
    const uniqueVisemes = new Set(timeline.map((event) => event.visemeId));

    expect(uniqueVisemes).toEqual(new Set(Object.values(CANONICAL_VISEMES)));
  });

  it('extends dense Azure segments so vowels and consonants do not chatter at raw boundary speed', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 2, audio_offset: 0 },
      { viseme_id: 18, audio_offset: 0.05 },
      { viseme_id: 6, audio_offset: 0.1 },
    ], 500);

    expect(timeline[0]).toMatchObject({
      visemeId: CANONICAL_VISEMES.Ah,
      offsetMs: 0,
      durationMs: 120,
    });
    expect(timeline[1].durationMs).toBeGreaterThan(50);
  });

  it('keeps bilabial closures crisp instead of smearing prior vowels through them', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 2, audio_offset: 0 },
      { viseme_id: 21, audio_offset: 0.05 },
    ], 300);

    expect(timeline[0]).toMatchObject({
      visemeId: CANONICAL_VISEMES.Ah,
      durationMs: 58,
    });
    expect(timeline[1].visemeId).toBe(CANONICAL_VISEMES.B_M_P);
  });

  it('uses word timing context to recover TH from Azure ID 19 when the provider group is ambiguous', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 19, audio_offset: 0.1 },
      { viseme_id: 1, audio_offset: 0.2 },
      { viseme_id: 20, audio_offset: 0.28 },
    ], 500, {
      wordTimings: [{ word: 'thank', start_time: 0.05, end_time: 0.32 }],
    });

    expect(timeline[0]).toMatchObject({
      visemeId: CANONICAL_VISEMES.Th,
      offsetMs: 100,
    });
  });

  it('keeps Azure ID 19 as tongue-led for non-TH words', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 19, audio_offset: 0.1 },
      { viseme_id: 11, audio_offset: 0.2 },
    ], 400, {
      wordTimings: [{ word: 'time', start_time: 0.05, end_time: 0.32 }],
    });

    expect(timeline[0].visemeId).toBe(CANONICAL_VISEMES.T_L_D_N);
  });

  it('uses word timing context to prefer EE for long-E Azure ID 6 words', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 6, audio_offset: 0.1 },
      { viseme_id: 14, audio_offset: 0.2 },
    ], 400, {
      wordTimings: [{ word: 'feel', start_time: 0.05, end_time: 0.35 }],
    });

    expect(timeline[0].visemeId).toBe(CANONICAL_VISEMES.EE);
  });

  it('expands Azure diphthongs into visible canonical shape travel', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 11, audio_offset: 0.1 },
      { viseme_id: 9, audio_offset: 0.35 },
      { viseme_id: 8, audio_offset: 0.6 },
    ], 1000);

    expect(timeline.map((event) => event.visemeId)).toEqual([
      CANONICAL_VISEMES.Ah,
      CANONICAL_VISEMES.Ih,
      CANONICAL_VISEMES.Ah,
      CANONICAL_VISEMES.W_OO,
      CANONICAL_VISEMES.Oh,
      CANONICAL_VISEMES.W_OO,
    ]);
    expect(timeline[1].offsetMs).toBeGreaterThan(timeline[0].offsetMs);
    expect(timeline[3].offsetMs).toBeGreaterThan(timeline[2].offsetMs);
  });

  it('uses word timing context to keep rounded OW endings from snapping back to Ih', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 8, audio_offset: 0.1 },
      { viseme_id: 4, audio_offset: 0.2 },
    ], 400, {
      wordTimings: [{ word: 'rose', start_time: 0.05, end_time: 0.25 }],
    });

    expect(timeline.map((event) => event.visemeId)).toContain(CANONICAL_VISEMES.W_OO);
    expect(timeline[timeline.length - 1].visemeId).toBe(CANONICAL_VISEMES.W_OO);
  });

  it('skips Azure silence events instead of turning pauses into bilabial closures', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 0, audio_offset: 1.0 },
      { viseme_id: 7, audio_offset: 1.8 },
    ], 2200);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      visemeId: CANONICAL_VISEMES.W_OO,
      offsetMs: 1800,
    });
  });

  it('can add a visual lead without changing Azure event durations', () => {
    const timeline = azureVisemesToTimeline([
      { viseme_id: 2, audio_offset: 0.1 },
      { viseme_id: 18, audio_offset: 0.25 },
    ], 500, {
      visualLeadMs: 35,
    });

    expect(timeline[0]).toMatchObject({
      visemeId: CANONICAL_VISEMES.Ah,
      offsetMs: 65,
      durationMs: 150,
    });
    expect(timeline[1].offsetMs).toBe(215);
  });
});
