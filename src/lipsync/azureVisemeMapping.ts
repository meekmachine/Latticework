/**
 * Azure/SAPI Viseme Mapping Helpers
 *
 * Azure Speech returns viseme IDs in the SAPI viseme set (0-21).
 * Our animation system uses CC4/ARKit-style visemes (0-14).
 *
 * This module normalizes Azure viseme events and maps them
 * to CC4 viseme indices so they drive the correct morph targets.
 */

import type { VisemeEvent, VisemeId } from '../vocal/types';
import { CANONICAL_VISEMES } from './canonicalVisemes';

export interface AzureVisemeLike {
  visemeId?: number;
  viseme_id?: number;
  time?: number; // seconds
  audio_offset?: number; // seconds
}

export interface AzureWordTimingLike {
  word: string;
  start_time?: number; // seconds
  end_time?: number; // seconds
  startSec?: number; // seconds
  endSec?: number; // seconds
}

export interface AzureTimelineOptions {
  wordTimings?: AzureWordTimingLike[];
  visualLeadMs?: number;
}

export interface NormalizedAzureViseme {
  visemeId: number;
  time: number; // seconds
}

// Map Azure/SAPI viseme IDs (0-21) to the installed loom3 canonical viseme indices.
//
// Lossy Azure groups are intentional and should stay documented here:
// - Azure 1 merges AE/AX/AH. We default to AE because Azure ID 2 covers the wider AA/Ah shape.
// - Azure 4 merges EY/EH/UH. We default to Ih because it is less smiley than EE for EH/UH.
// - Azure 6 merges Y/IY/IH/IX. We default to Ih, then use word timing context to recover
//   long-E words such as "we", "me", and "feel" as EE.
// - Azure 7 merges W/UW. We map it to the canonical W/OO slot to preserve protrusion and rounding.
// - Azure 8/9/10/11 are diphthongs. Timeline conversion expands them into two canonical
//   poses so they visually travel instead of freezing as one static vowel.
// - Azure 19 merges D/T/N/TH. We default to T_L_D_N, then use word timing context to recover
//   "th" positions as the dental TH slot.
export const AZURE_TO_CC4_VISEME: Record<number, number> = {
  0: CANONICAL_VISEMES.B_M_P, // Silence is skipped by timeline conversion.
  1: CANONICAL_VISEMES.AE,  // AE/AX/AH -> AE (provider group is lossy)
  2: CANONICAL_VISEMES.Ah,  // AA -> Ah
  3: CANONICAL_VISEMES.Oh,  // AO -> Oh
  4: CANONICAL_VISEMES.Ih,  // EY/EH/UH -> Ih (less smiley than EE for the lossy group)
  5: CANONICAL_VISEMES.Er, // ER -> Er/R
  6: CANONICAL_VISEMES.Ih,  // Y/IY/IH/IX -> Ih
  7: CANONICAL_VISEMES.W_OO,  // W/UW -> W_OO
  8: CANONICAL_VISEMES.Oh,  // OW -> Oh
  9: CANONICAL_VISEMES.Ah,  // AW -> Ah
  10: CANONICAL_VISEMES.Oh, // OY -> Oh
  11: CANONICAL_VISEMES.Ah, // AY -> Ah
  12: CANONICAL_VISEMES.K_G_H_NG, // H -> subtle velar/glottal group
  13: CANONICAL_VISEMES.R, // R -> R
  14: CANONICAL_VISEMES.T_L_D_N, // L -> tongue-led group
  15: CANONICAL_VISEMES.S_Z, // S/Z -> S_Z
  16: CANONICAL_VISEMES.Ch_J, // SH/CH/JH/ZH -> Ch_J when available
  17: CANONICAL_VISEMES.Th, // TH/DH -> Th
  18: CANONICAL_VISEMES.F_V, // F/V -> F_V
  19: CANONICAL_VISEMES.T_L_D_N, // D/T/N -> tongue-led group
  20: CANONICAL_VISEMES.K_G_H_NG, // K/G/NG -> K_G_H_NG
  21: CANONICAL_VISEMES.B_M_P, // P/B/M -> B_M_P
};

export function mapAzureVisemeIdToCC4(id: number): number {
  return AZURE_TO_CC4_VISEME[id] ?? CANONICAL_VISEMES.B_M_P;
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

type AzureVisemeClass = 'silence' | 'bilabial' | 'vowel' | 'fricative' | 'tongue' | 'liquid' | 'glide' | 'default';

const AZURE_MIN_DURATION_MS: Record<AzureVisemeClass, number> = {
  silence: 0,
  bilabial: 55,
  vowel: 120,
  fricative: 80,
  tongue: 80,
  liquid: 90,
  glide: 100,
  default: 85,
};

const AZURE_MAX_DURATION_MS: Record<AzureVisemeClass, number> = {
  silence: 0,
  bilabial: 110,
  vowel: 220,
  fricative: 150,
  tongue: 140,
  liquid: 160,
  glide: 180,
  default: 150,
};

const AZURE_MAX_OVERLAP_MS: Record<AzureVisemeClass, number> = {
  silence: 0,
  bilabial: 8,
  vowel: 90,
  fricative: 45,
  tongue: 45,
  liquid: 60,
  glide: 65,
  default: 45,
};

const AZURE_DUPLICATE_WINDOW_MS = 35;
const DIPHTHONG_MIN_DURATION_MS = 85;
const DIPHTHONG_SECONDARY_MIN_MS = 38;

const AZURE_VOWELS = new Set([
  CANONICAL_VISEMES.AE,
  CANONICAL_VISEMES.Ah,
  CANONICAL_VISEMES.EE,
  CANONICAL_VISEMES.Er,
  CANONICAL_VISEMES.Ih,
  CANONICAL_VISEMES.Oh,
  CANONICAL_VISEMES.W_OO,
]);

function getAzureVisemeClass(providerId: number, canonicalId: number): AzureVisemeClass {
  if (providerId === 0) return 'silence';
  if (canonicalId === CANONICAL_VISEMES.B_M_P) return 'bilabial';
  if (AZURE_VOWELS.has(canonicalId)) return canonicalId === CANONICAL_VISEMES.W_OO ? 'glide' : 'vowel';
  if (
    canonicalId === CANONICAL_VISEMES.Ch_J ||
    canonicalId === CANONICAL_VISEMES.F_V ||
    canonicalId === CANONICAL_VISEMES.S_Z ||
    canonicalId === CANONICAL_VISEMES.Th
  ) return 'fricative';
  if (
    canonicalId === CANONICAL_VISEMES.K_G_H_NG ||
    canonicalId === CANONICAL_VISEMES.T_L_D_N
  ) return 'tongue';
  if (canonicalId === CANONICAL_VISEMES.R) return 'liquid';
  return 'default';
}

function clampDuration(durationMs: number, minMs: number, maxMs: number, remainingMs: number): number {
  const clamped = Math.min(Math.max(durationMs, minMs), maxMs, remainingMs);
  return Math.max(0, Math.round(clamped));
}

function wordStartSec(word: AzureWordTimingLike): number {
  return typeof word.start_time === 'number' ? word.start_time : word.startSec ?? 0;
}

function wordEndSec(word: AzureWordTimingLike): number {
  return typeof word.end_time === 'number' ? word.end_time : word.endSec ?? wordStartSec(word);
}

function findWordAtTime(timeSec: number, wordTimings?: AzureWordTimingLike[]): AzureWordTimingLike | undefined {
  return wordTimings?.find((word) => timeSec >= wordStartSec(word) - 0.02 && timeSec <= wordEndSec(word) + 0.02);
}

function normalizedWord(word?: AzureWordTimingLike): string {
  return (word?.word ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

function isLongEWord(word: string): boolean {
  return /(?:ee|ea|ie|ei)/.test(word) || /^(?:we|me|be|he|she|see)$/.test(word) || /y$/.test(word);
}

function shouldUseRoundedBack(eventTimeSec: number, word?: AzureWordTimingLike): boolean {
  const text = normalizedWord(word);
  if (!text) return false;
  if (!/(?:oo|ew|ue|ui|ough|ow|oa|oe|ose|ole|old|own|o)$/.test(text)) return false;
  if (!word) return true;

  const startSec = wordStartSec(word);
  const endSec = wordEndSec(word);
  const durationSec = Math.max(0.001, endSec - startSec);
  const progress = Math.max(0, Math.min(1, (eventTimeSec - startSec) / durationSec));
  return progress >= 0.35;
}

function shouldUseDentalTh(eventTimeSec: number, word?: AzureWordTimingLike): boolean {
  const text = normalizedWord(word);
  if (!text.includes('th') || !word) return false;

  const startSec = wordStartSec(word);
  const endSec = wordEndSec(word);
  const durationSec = Math.max(0.001, endSec - startSec);
  const progress = Math.max(0, Math.min(1, (eventTimeSec - startSec) / durationSec));

  for (let index = text.indexOf('th'); index >= 0; index = text.indexOf('th', index + 1)) {
    const thProgress = text.length <= 2 ? 0 : index / Math.max(1, text.length - 2);
    const startsWord = index === 0;
    const endsWord = index >= text.length - 2;

    if (startsWord && progress <= 0.45) return true;
    if (endsWord && progress >= 0.55) return true;
    if (Math.abs(progress - thProgress) <= 0.22) return true;
  }

  return false;
}

function refineAzureVisemeForWord(
  providerId: number,
  canonicalId: number,
  eventTimeSec: number,
  word?: AzureWordTimingLike
): number | null {
  if (providerId === 0) return null;

  const text = normalizedWord(word);

  if (providerId === 6 && isLongEWord(text)) {
    return CANONICAL_VISEMES.EE;
  }

  if (providerId === 4 && shouldUseRoundedBack(eventTimeSec, word)) {
    return CANONICAL_VISEMES.W_OO;
  }

  if (providerId === 19 && shouldUseDentalTh(eventTimeSec, word)) {
    return CANONICAL_VISEMES.Th;
  }

  return canonicalId;
}

function buildMappedAzureEvents(normalized: NormalizedAzureViseme[], options?: AzureTimelineOptions) {
  const mapped: Array<NormalizedAzureViseme & { canonicalId: number; className: AzureVisemeClass }> = [];

  for (const event of normalized) {
    const baseCanonicalId = mapAzureVisemeIdToCC4(event.visemeId);
    const canonicalId = refineAzureVisemeForWord(
      event.visemeId,
      baseCanonicalId,
      event.time,
      findWordAtTime(event.time, options?.wordTimings)
    );
    if (canonicalId == null) continue;

    const timeMs = event.time * 1000;
    const previous = mapped[mapped.length - 1];

    if (
      previous &&
      previous.canonicalId === canonicalId &&
      Math.abs(timeMs - previous.time * 1000) < AZURE_DUPLICATE_WINDOW_MS
    ) {
      continue;
    }

    mapped.push({
      ...event,
      canonicalId,
      className: getAzureVisemeClass(event.visemeId, canonicalId),
    });
  }

  return mapped;
}

function getAzureDurationMs(
  current: { time: number; className: AzureVisemeClass },
  next: { time: number; className: AzureVisemeClass } | undefined,
  totalDurationMs: number | undefined
): number {
  const offsetMs = Math.max(0, Math.round(current.time * 1000));
  const remainingMs = typeof totalDurationMs === 'number'
    ? Math.max(0, totalDurationMs - offsetMs)
    : Number.POSITIVE_INFINITY;

  const fallbackMs = current.className === 'silence' ? AZURE_MAX_DURATION_MS.silence : AZURE_MIN_DURATION_MS[current.className];
  const rawSpanMs = next
    ? Math.max(0, Math.round((next.time - current.time) * 1000))
    : Math.min(fallbackMs, remainingMs);

  if (current.className === 'silence') {
    return clampDuration(rawSpanMs, 0, AZURE_MAX_DURATION_MS.silence, remainingMs);
  }

  const nextIsClosure = next?.className === 'bilabial';
  const overlapMs = nextIsClosure ? 8 : AZURE_MAX_OVERLAP_MS[current.className];
  const desiredMs = Math.max(rawSpanMs, AZURE_MIN_DURATION_MS[current.className]);
  const maxMs = Math.min(
    AZURE_MAX_DURATION_MS[current.className],
    rawSpanMs + overlapMs
  );

  return clampDuration(desiredMs, 1, maxMs, remainingMs);
}

function pushTimelineEvent(
  timeline: VisemeEvent[],
  visemeId: number,
  offsetMs: number,
  durationMs: number
): void {
  if (durationMs <= 0) return;
  timeline.push({
    visemeId: visemeId as VisemeId,
    offsetMs: Math.max(0, Math.round(offsetMs)),
    durationMs: Math.max(1, Math.round(durationMs)),
  });
}

function applyVisualLeadMs(offsetMs: number, visualLeadMs?: number): number {
  if (typeof visualLeadMs !== 'number' || !Number.isFinite(visualLeadMs) || visualLeadMs <= 0) {
    return offsetMs;
  }

  return Math.max(0, offsetMs - visualLeadMs);
}

function getAzureDiphthongTargets(providerId: number): [number, number] | null {
  switch (providerId) {
    case 8: // OW: rounded back vowel, e.g. "go", "rose"
      return [CANONICAL_VISEMES.Oh, CANONICAL_VISEMES.W_OO];
    case 9: // AW: open vowel into rounded lips, e.g. "cow"
      return [CANONICAL_VISEMES.Ah, CANONICAL_VISEMES.W_OO];
    case 10: // OY: rounded vowel into high front, e.g. "boy"
      return [CANONICAL_VISEMES.Oh, CANONICAL_VISEMES.EE];
    case 11: // AY: open vowel into lax high front, e.g. "five", "night"
      return [CANONICAL_VISEMES.Ah, CANONICAL_VISEMES.Ih];
    default:
      return null;
  }
}

function pushExpandedAzureEvent(
  timeline: VisemeEvent[],
  providerId: number,
  canonicalId: number,
  offsetMs: number,
  durationMs: number,
  visualLeadMs?: number
): void {
  const diphthongTargets = getAzureDiphthongTargets(providerId);
  if (!diphthongTargets || durationMs < DIPHTHONG_MIN_DURATION_MS) {
    pushTimelineEvent(timeline, canonicalId, applyVisualLeadMs(offsetMs, visualLeadMs), durationMs);
    return;
  }

  const [firstViseme, secondViseme] = diphthongTargets;
  const secondOffsetMs = Math.min(
    offsetMs + durationMs - DIPHTHONG_SECONDARY_MIN_MS,
    offsetMs + durationMs * 0.55
  );
  const firstDurationMs = Math.max(
    DIPHTHONG_SECONDARY_MIN_MS,
    Math.min(durationMs, secondOffsetMs - offsetMs + durationMs * 0.25)
  );
  const secondDurationMs = Math.max(
    DIPHTHONG_SECONDARY_MIN_MS,
    offsetMs + durationMs - secondOffsetMs
  );

  pushTimelineEvent(timeline, firstViseme, applyVisualLeadMs(offsetMs, visualLeadMs), firstDurationMs);
  pushTimelineEvent(timeline, secondViseme, applyVisualLeadMs(secondOffsetMs, visualLeadMs), secondDurationMs);
}

/**
 * Convert Azure viseme events to internal CC4 viseme timeline
 */
export function azureVisemesToTimeline(
  visemes: AzureVisemeLike[],
  totalDurationMs?: number,
  options?: AzureTimelineOptions
): VisemeEvent[] {
  const normalized = normalizeAzureVisemes(visemes);
  if (normalized.length === 0) return [];

  const mappedEvents = buildMappedAzureEvents(normalized, options);
  const timeline: VisemeEvent[] = [];

  for (let i = 0; i < mappedEvents.length; i++) {
    const evt = mappedEvents[i];
    const next = mappedEvents[i + 1];
    const offsetMs = Math.max(0, Math.round(evt.time * 1000));
    const durationMs = getAzureDurationMs(evt, next, totalDurationMs);

    // Skip zero-duration events
    if (durationMs <= 0) continue;

    pushExpandedAzureEvent(
      timeline,
      evt.visemeId,
      evt.canonicalId,
      offsetMs,
      durationMs,
      options?.visualLeadMs
    );
  }

  timeline.sort((a, b) => a.offsetMs - b.offsetMs);
  return timeline;
}
