/**
 * Vocal Agency Types
 *
 * Type definitions for lip sync and vocal animation.
 * Uses the canonical 15-slot viseme order matching the existing VisemeMapper.
 *
 * Canonical viseme reference:
 *   0 = EE       5 = U        10 = S_Z
 *   1 = Ah       6 = W        11 = B_M_P
 *   2 = Oh       7 = L        12 = K_G_H_NG
 *   3 = OO       8 = F_V      13 = AE
 *   4 = I        9 = Th       14 = R
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

/** Animation keyframe with time and intensity */
export interface Keyframe {
  time: number;
  intensity: number;
}

/** Animation curve for a single AU/viseme */
export type AnimationCurve = Keyframe[];

/** Complete animation snippet matching the JSON format */
export interface VocalSnippet {
  name: string;
  description?: string;
  snippetCategory: 'visemeSnippet' | 'combined';
  snippetPriority: number;
  snippetPlaybackRate: number;
  snippetIntensityScale: number;
  snippetJawScale?: number;
  loop: boolean;
  maxTime: number;
  curves: Record<string, AnimationCurve>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phoneme & Viseme Types
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical viseme ID (0-14) */
export type VisemeId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** Viseme event from TTS or analysis */
export interface VisemeEvent {
  visemeId: VisemeId;
  offsetMs: number;
  durationMs: number;
}

/** Word with timing info */
export interface WordTiming {
  word: string;
  startMs: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface VocalConfig {
  /** Master intensity scale (0-2, default 1.0) */
  intensity?: number;

  /** Speech rate multiplier (0.5-2, default 1.0) */
  speechRate?: number;

  /** Jaw contribution scale (0-2, default 1.0) */
  jawScale?: number;

  /** Transition ramp time in ms (default 15) */
  rampMs?: number;

  /** Hold time before decay in ms (default 40) */
  holdMs?: number;


  /** Animation snippet priority (default 50) */
  priority?: number;

  /** Engine reference for direct AU control */
  engine?: {
    setAU?: (au: number, value: number) => void;
    transitionAU?: (au: number, value: number, durationMs: number) => void;
  };

  /** Animation agency for snippet scheduling */
  animationAgency?: {
    schedule?: (snippet: VocalSnippet) => string | null;
    remove?: (name: string) => void;
    pauseSnippet?: (name: string) => void;
    resumeSnippet?: (name: string) => void;
    seek?: (name: string, offsetSec: number) => void;
  };
}

export interface VocalState {
  isSpeaking: boolean;
  currentWord: string | null;
  currentViseme: VisemeId | null;
  snippetName: string | null;
  startTime: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_VOCAL_CONFIG: Required<Omit<VocalConfig, 'engine' | 'animationAgency'>> = {
  intensity: 1.0,
  speechRate: 1.0,
  jawScale: 1.0,
  rampMs: 15,
  holdMs: 40,
  priority: 50,
};

/** AU 26 is jaw drop in the animation system */
export const JAW_AU = '26';

/** Snippet category for vocal animations - 'combined' allows both viseme (0-14) and AU (26) curves */
export const VOCAL_SNIPPET_CATEGORY = 'combined' as const;
