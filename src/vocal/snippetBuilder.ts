/**
 * Snippet Builder
 *
 * Builds animation snippets from viseme events, matching the format
 * of the reference viseme snippets (e.g., lipsync_hello.json).
 *
 * Key features:
 * - Viseme curves (indices 0-14) with eased envelope shoulders
 * - Explicit AU26 jaw curve using loom3 viseme jaw amounts
 * - snippetCategory: "combined" to support both viseme and AU curves
 *
 * Reference: lipsync_hello.json, lipsync_world.json
 */

import type {
  VisemeEvent,
  VocalSnippet,
  AnimationCurve,
  VocalConfig,
} from './types';
import {
  DEFAULT_VOCAL_CONFIG,
  JAW_AU,
  VOCAL_SNIPPET_CATEGORY,
} from './types';
import { CANONICAL_VISEMES } from '../lipsync/canonicalVisemes';
import { getJawAmountForViseme } from '../lipsync/VisemeMapper';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const INTENSITY_EPS = 1e-3;
const COARTICULATION_STRENGTH = 0.52;
const JAW_ATTACK_SEC = 0.04;
const JAW_RELEASE_SEC = 0.065;
const JAW_TRANSITION_LEAD_SEC = 0.024;
const JAW_LONG_GAP_SEC = 0.09;
const LIP_TOTAL_ACTIVATION_CAP = 1.05;
const LIP_DOMINANT_CAP = 1.0;
const LIP_SECONDARY_RATIO = 0.3;
const LIP_SECONDARY_CAP = 0.22;
const CLOSURE_DOMINANCE_THRESHOLD = 0.55;
const CLOSURE_SECONDARY_CAP = 0.035;
const ENVELOPE_SHOULDER_RATIO = 0.55;
const ENVELOPE_SHOULDER_INTENSITY = 0.62;

type VisemeClass = 'bilabial' | 'vowel' | 'fricative' | 'tongue' | 'liquid' | 'glide' | 'default';

interface EnvelopeProfile {
  attackSec: number;
  releaseSec: number;
  peak: number;
}

const VOWEL_VISEMES = new Set([
  CANONICAL_VISEMES.AE,
  CANONICAL_VISEMES.Ah,
  CANONICAL_VISEMES.EE,
  CANONICAL_VISEMES.Er,
  CANONICAL_VISEMES.Ih,
  CANONICAL_VISEMES.Oh,
]);

function getVisemeClass(visemeId: number): VisemeClass {
  if (visemeId === CANONICAL_VISEMES.B_M_P) return 'bilabial';
  if (visemeId === CANONICAL_VISEMES.W_OO) return 'glide';
  if (VOWEL_VISEMES.has(visemeId)) return 'vowel';
  if (
    visemeId === CANONICAL_VISEMES.Ch_J ||
    visemeId === CANONICAL_VISEMES.F_V ||
    visemeId === CANONICAL_VISEMES.S_Z ||
    visemeId === CANONICAL_VISEMES.Th
  ) return 'fricative';
  if (
    visemeId === CANONICAL_VISEMES.K_G_H_NG ||
    visemeId === CANONICAL_VISEMES.T_L_D_N
  ) return 'tongue';
  if (visemeId === CANONICAL_VISEMES.R) return 'liquid';
  return 'default';
}

function getEnvelopeProfile(visemeId: number): EnvelopeProfile {
  if (visemeId === CANONICAL_VISEMES.W_OO) {
    return { attackSec: 0.018, releaseSec: 0.026, peak: 0.98 };
  }
  if (visemeId === CANONICAL_VISEMES.Oh) {
    return { attackSec: 0.020, releaseSec: 0.026, peak: 0.96 };
  }
  if (visemeId === CANONICAL_VISEMES.EE) {
    return { attackSec: 0.016, releaseSec: 0.020, peak: 0.94 };
  }
  if (visemeId === CANONICAL_VISEMES.Ih) {
    return { attackSec: 0.014, releaseSec: 0.018, peak: 0.88 };
  }
  if (visemeId === CANONICAL_VISEMES.F_V) {
    return { attackSec: 0.010, releaseSec: 0.016, peak: 0.86 };
  }
  if (visemeId === CANONICAL_VISEMES.Th) {
    return { attackSec: 0.010, releaseSec: 0.016, peak: 0.82 };
  }
  if (visemeId === CANONICAL_VISEMES.Ch_J) {
    return { attackSec: 0.012, releaseSec: 0.018, peak: 0.84 };
  }
  if (visemeId === CANONICAL_VISEMES.S_Z) {
    return { attackSec: 0.010, releaseSec: 0.014, peak: 0.78 };
  }
  if (visemeId === CANONICAL_VISEMES.K_G_H_NG) {
    return { attackSec: 0.010, releaseSec: 0.014, peak: 0.68 };
  }
  if (visemeId === CANONICAL_VISEMES.T_L_D_N) {
    return { attackSec: 0.012, releaseSec: 0.016, peak: 0.80 };
  }

  switch (getVisemeClass(visemeId)) {
    case 'bilabial':
      return { attackSec: 0.004, releaseSec: 0.006, peak: 1.0 };
    case 'vowel':
      return { attackSec: 0.018, releaseSec: 0.022, peak: 0.92 };
    case 'fricative':
      return { attackSec: 0.010, releaseSec: 0.014, peak: 0.72 };
    case 'tongue':
      return { attackSec: 0.012, releaseSec: 0.016, peak: 0.76 };
    case 'liquid':
      return { attackSec: 0.016, releaseSec: 0.018, peak: 0.82 };
    case 'glide':
      return { attackSec: 0.012, releaseSec: 0.018, peak: 0.84 };
    default:
      return { attackSec: 0.010, releaseSec: 0.012, peak: 0.86 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Curve Building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a single viseme curve with a phoneme-class envelope.
 * Closures stay crisp, fricatives stay lighter, and vowels have slower
 * jaw-led attacks with lip shape layered on top.
 */
function buildVisemeCurve(
  visemeId: number,
  startMs: number,
  durationMs: number,
  peakOverride?: number
): AnimationCurve {
  const startSec = startMs / 1000;
  const durationSec = durationMs / 1000;
  const endSec = startSec + durationSec;
  const profile = getEnvelopeProfile(visemeId);
  const peak = peakOverride ?? profile.peak;

  if (durationSec <= 0) return [];

  const attackSec = Math.min(profile.attackSec, durationSec * 0.45);
  const releaseSec = Math.min(profile.releaseSec, durationSec * 0.45);

  if (durationSec <= attackSec + releaseSec + 0.002) {
    const peakTime = startSec + durationSec * 0.5;
    return [
      { time: startSec, intensity: 0 },
      { time: peakTime, intensity: peak },
      { time: endSec, intensity: 0 },
    ];
  }

  const rampUpEnd = startSec + attackSec;
  const holdEnd = endSec - releaseSec;

  if (getVisemeClass(visemeId) === 'bilabial') {
    return deduplicateCurve([
      { time: startSec, intensity: 0 },
      { time: rampUpEnd, intensity: peak },
      { time: holdEnd, intensity: peak },
      { time: endSec, intensity: 0 },
    ]);
  }

  return deduplicateCurve([
    { time: startSec, intensity: 0 },
    {
      time: startSec + attackSec * ENVELOPE_SHOULDER_RATIO,
      intensity: peak * ENVELOPE_SHOULDER_INTENSITY,
    },
    { time: rampUpEnd, intensity: peak },
    { time: holdEnd, intensity: peak },
    {
      time: holdEnd + releaseSec * (1 - ENVELOPE_SHOULDER_RATIO),
      intensity: peak * ENVELOPE_SHOULDER_INTENSITY,
    },
    { time: endSec, intensity: 0 },
  ]);
}

/**
 * Remove consecutive keyframes with the same intensity
 */
function deduplicateCurve(curve: AnimationCurve): AnimationCurve {
  if (curve.length <= 1) return curve;

  const result: AnimationCurve = [curve[0]];

  for (let i = 1; i < curve.length; i++) {
    const prev = result[result.length - 1];
    const curr = curve[i];
    const next = curve[i + 1];
    const intensityChanged = Math.abs(curr.intensity - prev.intensity) > INTENSITY_EPS;
    const endsPlateau = Boolean(
      next && Math.abs(next.intensity - curr.intensity) > INTENSITY_EPS
    );

    // Keep plateau ends so trapezoids do not collapse into fast triangular flaps.
    if (intensityChanged || endsPlateau || i === curve.length - 1) {
      result.push(curr);
    }
  }

  return result;
}

function scaleLipIntensity(value: number, intensity: number): number {
  const normalized = Math.max(0, Math.min(LIP_DOMINANT_CAP, value));
  const scale = Number.isFinite(intensity) ? Math.max(0, intensity) : 1;

  if (Math.abs(scale - 1) <= INTENSITY_EPS) return normalized;
  if (scale <= 1) return normalized * scale;

  // Use a soft-knee boost so high UI intensity stays visible without pushing
  // every viseme class into the same saturated full-strength shape.
  return 1 - Math.pow(1 - normalized, scale);
}

function scaleCurveIntensity(curve: AnimationCurve, intensity: number): AnimationCurve {
  if (curve.length === 0) return curve;
  const scale = Number.isFinite(intensity) ? Math.max(0, intensity) : 1;
  if (Math.abs(scale - 1) <= INTENSITY_EPS) return curve;

  return curve.map((frame) => ({
    ...frame,
    intensity: scaleLipIntensity(frame.intensity, scale),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Coarticulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply coarticulation blending between adjacent visemes
 *
 * Coarticulation creates smoother transitions by:
 * 1. Starting the next viseme slightly before the current one ends
 * 2. Blending intensities during the overlap period
 */
function applyConstrainedCoarticulation(
  curves: Record<string, AnimationCurve>,
  events: VisemeEvent[],
  strength: number
): Record<string, AnimationCurve> {
  if (strength <= 0 || events.length < 2) return curves;

  const blendedCurves = Object.fromEntries(
    Object.entries(curves).map(([key, curve]) => [key, curve.map((frame) => ({ ...frame }))])
  );

  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i];
    const next = events[i + 1];
    const currentClass = getVisemeClass(current.visemeId);
    const nextClass = getVisemeClass(next.visemeId);

    const currentEnd = current.offsetMs + current.durationMs;
    const nextStart = next.offsetMs;
    const gap = nextStart - currentEnd;

    // Only blend if visemes are close together
    if (gap < 50 && gap > -30) {
      const currentKey = String(current.visemeId);
      const nextKey = String(next.visemeId);

      // Bilabial closures need hard lip seal; do not smear into or out of them.
      if (currentClass === 'bilabial' || nextClass === 'bilabial') {
        continue;
      }

      const canCarryCurrent = currentClass === 'vowel' || currentClass === 'liquid' || currentClass === 'glide';
      const canAnticipateNext = nextClass === 'vowel' || nextClass === 'liquid' || nextClass === 'glide';

      if (canCarryCurrent && blendedCurves[currentKey]) {
        const lastIdx = blendedCurves[currentKey].length - 1;
        if (lastIdx >= 0) {
          const extendSec = 0.010 * strength;
          const maxEndSec = Math.max(blendedCurves[currentKey][lastIdx].time, nextStart / 1000);
          blendedCurves[currentKey][lastIdx].time = Math.min(maxEndSec, blendedCurves[currentKey][lastIdx].time + extendSec);
        }
      }

      if (canAnticipateNext && blendedCurves[nextKey]) {
        const anticipateSec = 0.016 * strength;
        blendedCurves[nextKey][0].time = Math.max(
          0,
          blendedCurves[nextKey][0].time - anticipateSec
        );
      }
    }
  }

  return blendedCurves;
}

function sampleCurveAt(curve: AnimationCurve, time: number): number {
  if (curve.length === 0) return 0;
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

function addSampleTime(times: Set<number>, time: number): void {
  if (!Number.isFinite(time) || time < 0) return;
  times.add(Math.round(time * 1000) / 1000);
}

function collectLipSampleTimes(curves: Record<string, AnimationCurve>): number[] {
  const times = new Set<number>();

  Object.entries(curves).forEach(([key, curve]) => {
    if (key === JAW_AU) return;
    curve.forEach((frame) => addSampleTime(times, frame.time));
  });

  const sorted = Array.from(times).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end - start <= 0.12) {
      addSampleTime(times, (start + end) / 2);
    }
  }

  return Array.from(times).sort((a, b) => a - b);
}

function fitSecondaryActivation(
  active: Array<{ key: string; value: number }>,
  adjusted: Record<string, number>,
  budget: number
): void {
  const secondary = active.slice(1);
  const secondarySum = secondary.reduce((sum, entry) => sum + entry.value, 0);
  if (secondary.length === 0 || secondarySum <= budget) return;

  const scale = budget / secondarySum;
  secondary.forEach((entry) => {
    adjusted[entry.key] = entry.value * scale;
  });
}

/**
 * Keep lip shapes from accumulating into a mushy composite pose. A dominant
 * viseme owns each sample, with a small secondary budget for coarticulation.
 */
function limitConcurrentLipActivation(
  curves: Record<string, AnimationCurve>
): Record<string, AnimationCurve> {
  const lipKeys = Object.keys(curves).filter((key) => key !== JAW_AU);
  if (lipKeys.length <= 1) return curves;

  const sampleTimes = collectLipSampleTimes(curves);
  if (sampleTimes.length === 0) return curves;

  const normalized: Record<string, AnimationCurve> = Object.fromEntries(
    lipKeys.map((key) => [key, []])
  );

  for (const time of sampleTimes) {
    const values = lipKeys.map((key) => ({
      key,
      visemeId: Number(key),
      value: Math.min(LIP_DOMINANT_CAP, Math.max(0, sampleCurveAt(curves[key], time))),
    }));
    const active = values
      .filter((entry) => entry.value > INTENSITY_EPS)
      .sort((a, b) => b.value - a.value);
    const adjusted = Object.fromEntries(values.map((entry) => [entry.key, entry.value]));

    if (active.length > 1) {
      const dominant = active[0];
      if (
        dominant.visemeId === CANONICAL_VISEMES.B_M_P &&
        dominant.value >= CLOSURE_DOMINANCE_THRESHOLD
      ) {
        fitSecondaryActivation(active, adjusted, CLOSURE_SECONDARY_CAP);
      } else {
        const total = active.reduce((sum, entry) => sum + entry.value, 0);
        if (total > LIP_TOTAL_ACTIVATION_CAP) {
          const budget = Math.max(
            0,
            Math.min(
              LIP_TOTAL_ACTIVATION_CAP - dominant.value,
              dominant.value * LIP_SECONDARY_RATIO,
              LIP_SECONDARY_CAP
            )
          );
          fitSecondaryActivation(active, adjusted, budget);
        }
      }
    }

    lipKeys.forEach((key) => {
      normalized[key].push({
        time,
        intensity: adjusted[key] ?? 0,
      });
    });
  }

  return Object.fromEntries(
    lipKeys.map((key) => [key, trimInactivePadding(deduplicateCurve(normalized[key]))])
  );
}

function trimInactivePadding(curve: AnimationCurve): AnimationCurve {
  const firstActive = curve.findIndex((frame) => frame.intensity > INTENSITY_EPS);
  if (firstActive < 0) return [];

  let lastActive = curve.length - 1;
  while (lastActive >= 0 && curve[lastActive].intensity <= INTENSITY_EPS) {
    lastActive--;
  }

  const start = Math.max(0, firstActive - 1);
  const end = Math.min(curve.length - 1, lastActive + 1);
  return curve.slice(start, end + 1);
}

function reduceLipKeys(
  curves: Record<string, AnimationCurve>
): Record<string, AnimationCurve> {
  return Object.fromEntries(
    Object.entries(curves).map(([key, curve]) => [
      key,
      key === JAW_AU
        ? deduplicateCurve(curve.sort((a, b) => a.time - b.time))
        : reduceCurveKeys(Number(key), deduplicateCurve(curve.sort((a, b) => a.time - b.time))),
    ])
  );
}

function pushJawFrame(curve: AnimationCurve, time: number, intensity: number): void {
  if (!Number.isFinite(time) || !Number.isFinite(intensity)) return;

  const frame = {
    time: Math.max(0, time),
    intensity: Math.max(0, Math.min(2, intensity)),
  };
  const previous = curve[curve.length - 1];

  if (previous && Math.abs(previous.time - frame.time) < 0.001) {
    previous.intensity = frame.intensity;
    return;
  }

  curve.push(frame);
}

function buildJawCurve(events: VisemeEvent[], jawScale: number): AnimationCurve {
  const sortedEvents = [...events].sort((a, b) => a.offsetMs - b.offsetMs);
  const jawCurve: AnimationCurve = [];

  for (let i = 0; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const previous = sortedEvents[i - 1];
    const next = sortedEvents[i + 1];
    const startSec = event.offsetMs / 1000;
    const durationSec = event.durationMs / 1000;
    const endSec = startSec + durationSec;
    const jawAmount = Math.min(2, getJawAmountForViseme(event.visemeId) * jawScale);
    const attackSec = Math.min(JAW_ATTACK_SEC, Math.max(0.006, durationSec * 0.35));
    const releaseSec = Math.min(JAW_RELEASE_SEC, Math.max(0.010, durationSec * 0.45));
    const previousEndSec = previous ? (previous.offsetMs + previous.durationMs) / 1000 : 0;
    const startsAfterGap = !previous || startSec - previousEndSec > JAW_LONG_GAP_SEC;

    if (startsAfterGap) {
      pushJawFrame(jawCurve, startSec, 0);
    }

    pushJawFrame(jawCurve, startSec + attackSec, jawAmount);

    if (next) {
      const nextStartSec = next.offsetMs / 1000;
      const gapSec = nextStartSec - endSec;

      if (gapSec > JAW_LONG_GAP_SEC) {
        pushJawFrame(jawCurve, Math.max(startSec + attackSec, endSec - releaseSec), jawAmount);
        pushJawFrame(jawCurve, endSec, 0);
      } else {
        pushJawFrame(jawCurve, Math.max(startSec + attackSec, nextStartSec - JAW_TRANSITION_LEAD_SEC), jawAmount);
      }
    } else {
      pushJawFrame(jawCurve, Math.max(startSec + attackSec, endSec - releaseSec), jawAmount);
      pushJawFrame(jawCurve, endSec, 0);
    }
  }

  return deduplicateCurve(jawCurve.sort((a, b) => a.time - b.time));
}

function reduceCurveKeys(visemeId: number, curve: AnimationCurve): AnimationCurve {
  if (curve.length <= 3) return curve;

  const profile = getEnvelopeProfile(visemeId);
  const reduced: AnimationCurve = [curve[0]];

  for (let i = 1; i < curve.length - 1; i++) {
    const prev = reduced[reduced.length - 1];
    const curr = curve[i];
    const next = curve[i + 1];
    const preservesPeak = curr.intensity >= profile.peak - 0.02;
    const preservesClosure = visemeId === CANONICAL_VISEMES.B_M_P && curr.intensity >= 0.98;
    const nearFlat =
      Math.abs(curr.intensity - prev.intensity) < 0.015 &&
      Math.abs(next.intensity - curr.intensity) < 0.015;

    if (!nearFlat || preservesPeak || preservesClosure) {
      reduced.push(curr);
    }
  }

  reduced.push(curve[curve.length - 1]);
  return reduced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Builder
// ─────────────────────────────────────────────────────────────────────────────

let snippetCounter = 0;

/**
 * Build a vocal animation snippet from viseme events
 */
export function buildVocalSnippet(
  events: VisemeEvent[],
  config?: Partial<VocalConfig>,
  name?: string
): VocalSnippet {
  const cfg: Required<Omit<VocalConfig, 'engine' | 'animationAgency'>> = {
    ...DEFAULT_VOCAL_CONFIG,
    ...config,
  };

  const {
    priority,
    jawScale,
  } = cfg;

  // Generate unique name if not provided
  const snippetName = name ?? `vocal_${Date.now()}_${++snippetCounter}`;

  // Use viseme events exactly as provided.
  const filteredEvents = events;

  if (filteredEvents.length === 0) {
    return {
      name: snippetName,
      snippetCategory: VOCAL_SNIPPET_CATEGORY,
      snippetPriority: priority,
      // Viseme timelines are already scaled before they reach the builder.
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
      snippetJawScale: jawScale,
      loop: false,
      maxTime: 0,
      curves: {},
    };
  }

  // Build curves for each viseme with trapezoidal envelope
  const curves: Record<string, AnimationCurve> = {};

  for (const event of filteredEvents) {
    const key = String(event.visemeId);
    const curve = scaleCurveIntensity(
      buildVisemeCurve(event.visemeId, event.offsetMs, event.durationMs),
      cfg.intensity
    );
    if (curve.length === 0) continue;

    // Merge curves for same viseme
    if (curves[key]) {
      curves[key] = mergeCurves(curves[key], curve);
    } else {
      curves[key] = curve;
    }
  }

  const articulatedCurves = reduceLipKeys(
    limitConcurrentLipActivation(
      applyConstrainedCoarticulation(curves, filteredEvents, COARTICULATION_STRENGTH)
    )
  );
  const jawCurve = buildJawCurve(filteredEvents, jawScale);
  if (jawCurve.length > 0) {
    articulatedCurves[JAW_AU] = jawCurve;
  }

  // Provide an explicit AU26 jaw curve so speech remains visible even when a
  // character has incomplete viseme morph bindings. AnimationService disables
  // auto-generated jaw when this curve is present.

  // Calculate max time from filtered events
  const maxTime = Math.max(
    ...filteredEvents.map((event) => (event.offsetMs + event.durationMs) / 1000),
    ...Object.values(articulatedCurves).flatMap((curve) => curve.map((frame) => frame.time))
  );

  return {
    name: snippetName,
    snippetCategory: VOCAL_SNIPPET_CATEGORY,
    snippetPriority: priority,
    // Keep clip playback neutral so we do not double-apply speech rate.
    snippetPlaybackRate: 1.0,
    snippetIntensityScale: 1.0,
    snippetJawScale: jawScale,
    autoVisemeJaw: false,
    loop: false,
    maxTime,
    curves: articulatedCurves,
  };
}

/**
 * Merge two curves for the same viseme, handling overlaps
 */
function mergeCurves(
  existing: AnimationCurve,
  incoming: AnimationCurve
): AnimationCurve {
  const merged = [...existing, ...incoming];
  // Sort by time
  merged.sort((a, b) => a.time - b.time);
  return deduplicateCurve(merged);
}

/**
 * Build a snippet for a single word
 */
export function buildWordSnippet(
  word: string,
  visemeEvents: VisemeEvent[],
  config?: Partial<VocalConfig>
): VocalSnippet {
  const name = `vocal_${word.toLowerCase().replace(/[^a-z]/g, '')}_${Date.now()}`;
  return buildVocalSnippet(visemeEvents, config, name);
}

/**
 * Build a snippet for text (phrase or sentence)
 */
export function buildTextSnippet(
  text: string,
  visemeEvents: VisemeEvent[],
  config?: Partial<VocalConfig>
): VocalSnippet {
  // Create a short identifier from the text
  const words = text.split(/\s+/).slice(0, 3).join('_').toLowerCase().replace(/[^a-z_]/g, '');
  const name = `vocal_${words}_${Date.now()}`;
  return buildVocalSnippet(visemeEvents, config, name);
}
