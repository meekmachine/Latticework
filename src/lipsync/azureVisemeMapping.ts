/**
 * Azure/SAPI Viseme Mapping Helpers
 *
 * Azure Speech returns viseme IDs in the SAPI viseme set (0-21).
 * Our animation system uses CC4/ARKit-style visemes (0-14).
 *
 * This module normalizes Azure viseme events and maps them
 * to CC4 viseme indices so they drive the correct morph targets.
 */

import type { VisemeEvent } from './types';

export interface AzureVisemeLike {
  visemeId?: number;
  viseme_id?: number;
  time?: number; // seconds
  audio_offset?: number; // seconds
}

export interface NormalizedAzureViseme {
  visemeId: number;
  time: number; // seconds
}

// Map Azure/SAPI viseme IDs (0-21) to CC4 viseme indices (0-14)
// CC4 indices: 0 EE, 1 Ah, 2 Oh, 3 OO, 4 I, 5 U, 6 W, 7 L,
//              8 F_V, 9 Th, 10 S_Z, 11 B_M_P, 12 K_G_H_NG, 13 AE, 14 R
export const AZURE_TO_CC4_VISEME: Record<number, number> = {
  0: 11, // Silence -> B_M_P (closed mouth)
  1: 1,  // AE/AX/AH -> Ah
  2: 1,  // AA -> Ah
  3: 2,  // AO -> Oh
  4: 0,  // EY/EH/UH -> EE (closest front-mid)
  5: 14, // ER -> R
  6: 4,  // Y/IY/IH/IX -> I
  7: 6,  // W/UW -> W
  8: 2,  // OW -> Oh
  9: 1,  // AW -> Ah
  10: 2, // OY -> Oh
  11: 1, // AY -> Ah
  12: 1, // H -> Ah (open glottal)
  13: 14, // R -> R
  14: 7, // L -> L
  15: 10, // S/Z -> S_Z
  16: 10, // SH/CH/JH/ZH -> S_Z (closest)
  17: 9, // TH/DH -> Th
  18: 8, // F/V -> F_V
  19: 7, // D/T/N -> L (tongue tip)
  20: 12, // K/G/NG -> K_G_H_NG
  21: 11, // P/B/M -> B_M_P
};

export function mapAzureVisemeIdToCC4(id: number): number {
  return AZURE_TO_CC4_VISEME[id] ?? 11;
}

export function normalizeAzureVisemes(visemes: AzureVisemeLike[]): NormalizedAzureViseme[] {
  if (!visemes || visemes.length === 0) return [];

  return visemes
    .map((v) => ({
      visemeId: v.visemeId ?? v.viseme_id ?? 0,
      time: v.time ?? v.audio_offset ?? 0,
    }))
    .filter((v) => Number.isFinite(v.time))
    .sort((a, b) => a.time - b.time);
}

/**
 * Convert Azure viseme events to internal CC4 viseme timeline
 */
export function azureVisemesToTimeline(
  visemes: AzureVisemeLike[],
  totalDurationMs?: number
): VisemeEvent[] {
  const normalized = normalizeAzureVisemes(visemes);
  if (normalized.length === 0) return [];

  const timeline: VisemeEvent[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const evt = normalized[i];
    const next = normalized[i + 1];
    const offsetMs = Math.max(0, Math.round(evt.time * 1000));

    let durationMs = 100;
    if (next) {
      durationMs = Math.max(0, Math.round((next.time - evt.time) * 1000));
    } else if (typeof totalDurationMs === 'number') {
      durationMs = Math.max(0, Math.round(totalDurationMs - offsetMs));
    }

    // Skip zero-duration events
    if (durationMs <= 0) continue;

    timeline.push({
      visemeId: mapAzureVisemeIdToCC4(evt.visemeId),
      offsetMs,
      durationMs,
    });
  }

  return timeline;
}
