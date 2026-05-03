// Unified types for the Animation Agency (Machine + Service + Scheduler)

import type {
  TransitionHandle,
  ClipOptions,
  ClipHandle,
  Loom3,
  MixerLoopMode,
  AnimationPlayOptions,
  AnimationState,
} from '@lovelace_lol/loom3';

// Re-export from loom3 for convenience
export type { ClipOptions, ClipHandle, MixerLoopMode };

/**
 * Engine interface - Loom3 implements this directly.
 * Used by animation schedulers and services.
 */
export type Engine = Loom3;

/**
 * Easing function types for animation interpolation.
 * - 'linear': No easing, constant speed
 * - 'easeInOut': Smooth acceleration and deceleration (quadratic)
 * - 'easeInOutCubic': Smoother acceleration and deceleration (cubic)
 * - 'easeIn': Start slow, end fast
 * - 'easeOut': Start fast, end slow
 */
export type EasingType = 'linear' | 'easeInOut' | 'easeInOutCubic' | 'easeIn' | 'easeOut';

/** Easing function implementations */
export const EASING_FUNCTIONS: Record<EasingType, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
};

// ---------- Mixer blending (AnimationMixer) ----------
export type MixerBlendMode = 'replace' | 'additive' | 'crossfade' | 'fade' | 'warp';

export type BakedClipChannel = 'face' | 'body' | 'scene';

export interface BakedClipChannelInfo {
  channel: BakedClipChannel;
  trackCount: number;
  playable: boolean;
  blendMode?: 'replace' | 'additive';
}

export type BakedRuntimeClipInfo = {
  name: string;
  duration: number;
  channels?: BakedClipChannelInfo[];
};

export type BakedRuntimeAnimationState = AnimationState & {
  requestedBlendMode?: 'replace' | 'additive';
  channels?: BakedClipChannelInfo[];
};

export type MixerBlendConfig = {
  mixerChannel?: string;              // Logical channel (body/head/face/eyes/etc.)
  mixerBlendMode?: MixerBlendMode;    // How this snippet should blend on the channel
  mixerWeight?: number;               // Effective weight for the action
  mixerFadeDurationMs?: number;       // Fade time when starting/stopping/crossfading
  mixerWarpDurationMs?: number;       // Optional tempo-match window when warping
  mixerTimeScale?: number;            // Playback speed for the action
  mixerLoopMode?: MixerLoopMode;      // Loop policy when using mixer clips
  mixerRepeatCount?: number;          // Number of repetitions when looping (Three.js repetitions)
  mixerClampWhenFinished?: boolean;   // Clamp pose after finishing (LoopOnce)
  mixerAdditive?: boolean;            // Treat clip as additive layer
};

// ---------- Core curve types ----------
export type CurvePoint = {
  time: number;
  intensity: number;
  /** When true, the animation agency re-seeds this keyframe with the current AU value each time the snippet (re)starts. */
  inherit?: boolean;
};
export type CurvesMap = Record<string, CurvePoint[]>;

export type AIExpressionInterpretationMetadata = {
  aus: Record<string, number>;
  explanation: string;
  emotion?: string | null;
  notesByAu?: Record<string, string>;
  summary?: string;
  phases?: Array<{ title: string; description: string }>;
  characterDetailsUsed?: string[];
  eyeNote?: string | null;
  headNote?: string | null;
  pacingNote?: string | null;
  handoffNote?: string | null;
};

export type AIExpressionSnippetMetadata = {
  description: string;
  interpretation?: AIExpressionInterpretationMetadata | null;
};

// ---------- Snippet (authoring form) ----------
export type AUKeyframe = { t: number; id: number; v: number };
export type VisemeKeyframe = { t: number; key: string; v: number };

/**
 * Authoring-time snippet: either AU or Viseme keyframes arrays.
 * Duration is calculated programmatically from the keyframes.
 * This is what editors/loaders typically produce/consume.
 */
export type Snippet = {
  name?: string;
  loop?: boolean;
  aiExpressionMetadata?: AIExpressionSnippetMetadata;

  // Category & blending
  snippetCategory?: 'auSnippet' | 'visemeSnippet' | 'eyeHeadTracking' | 'combined' | 'default';
  snippetPriority?: number;        // higher wins ties
  snippetPlaybackRate?: number;    // default 1
  snippetIntensityScale?: number;  // default 1

  /**
   * Blend mode for combining multiple snippets on same AU:
   * - 'replace' (default): Higher priority wins, replaces lower priority values
   * - 'additive': Values are summed together (clamped to [0,1])
   *
   * Example: Head tracking (yaw=0.3) + Prosodic nod (pitch=0.4) with additive mode
   * allows both to contribute simultaneously for natural combined movement.
   */
  snippetBlendMode?: 'replace' | 'additive';

  /**
   * Jaw bone activation multiplier for viseme snippets.
   * Controls how much the jaw bone moves during lip-sync.
   * - 0 = no jaw movement
   * - 1.0 = default jaw movement
   * - 2.0 = exaggerated jaw movement
   */
  snippetJawScale?: number;

  /**
   * Global left/right balance for bilateral AUs in this snippet.
   * Controls asymmetry for AUs with separate L/R morphs (smile, brow, blink, etc.)
   * - -1 = left side only
   * -  0 = both sides equally (default)
   * - +1 = right side only
   */
  snippetBalance?: number;

  /**
   * Per-AU balance overrides. Keys are AU IDs (as strings).
   * Allows different bilateral balance for each AU in the snippet.
   * Example: { "12": -0.5, "4": 0.3 } means AU 12 is left-biased, AU 4 is right-biased
   */
  snippetBalanceMap?: Record<string, number>;

  /**
   * Easing function for keyframe interpolation.
   * Controls how values transition between keyframes.
   * - 'linear': Constant speed (default)
   * - 'easeInOut': Smooth start and end
   * - 'easeInOutCubic': Smoother, more pronounced curves
   * - 'easeIn': Start slow, end fast
   * - 'easeOut': Start fast, end slow
   */
  snippetEasing?: EasingType;

  // Mixer (AnimationMixer) metadata for clip-backed blending
  mixerChannel?: string;
  mixerBlendMode?: MixerBlendMode;
  mixerWeight?: number;
  mixerFadeDurationMs?: number;
  mixerWarpDurationMs?: number;
  mixerTimeScale?: number;
  mixerLoopMode?: MixerLoopMode;
  mixerRepeatCount?: number;
  mixerClampWhenFinished?: boolean;
  mixerAdditive?: boolean;
  /** Play snippet backwards when true (negative mixer time scale) */
  mixerReverse?: boolean;

  // Keyframes (one or both may appear)
  au?: AUKeyframe[];
  viseme?: VisemeKeyframe[];

  // Optional normalized map (some sources already have it)
  curves?: CurvesMap;
};

// A normalized snippet that the machine/scheduler keep in context
export type NormalizedSnippet = {
  name: string;
  curves: CurvesMap;
  isPlaying: boolean;
  loop: boolean;
  aiExpressionMetadata?: AIExpressionSnippetMetadata;
  loopIteration: number;
  loopDirection: 1 | -1;
  lastLoopTime: number;

  snippetPlaybackRate: number;
  snippetIntensityScale: number;
  snippetCategory: 'auSnippet' | 'visemeSnippet' | 'eyeHeadTracking' | 'combined' | 'default';
  snippetPriority: number;
  snippetBlendMode: 'replace' | 'additive';  // Blend mode for AU combination
  snippetJawScale: number;  // Jaw bone activation multiplier for viseme snippets
  snippetBalance: number;  // Global L/R balance for bilateral AUs (-1 to +1)
  snippetBalanceMap: Record<string, number>;  // Per-AU balance overrides
  snippetEasing: EasingType;  // Easing function for keyframe interpolation

  // Mixer (AnimationMixer) metadata
  mixerChannel?: string;
  mixerBlendMode?: MixerBlendMode;
  mixerWeight?: number;
  mixerFadeDurationMs?: number;
  mixerWarpDurationMs?: number;
  mixerTimeScale?: number;
  mixerLoopMode?: MixerLoopMode;
  mixerRepeatCount?: number;
  mixerClampWhenFinished?: boolean;
  mixerAdditive?: boolean;
  mixerReverse?: boolean;

  // Playback bookkeeping (UI/engine parity)
  currentTime: number;
  startWallTime: number;
  duration: number;  // Calculated from keyframes (max time across all curves)
  cursor: Record<string, number>;
};

// ---------- Animation machine context ----------
export interface AnimContext {
  animations: NormalizedSnippet[];

  // live blend-shape values for UI & inspection
  currentAUs: Record<string | number, number>;
  currentVisemes: Record<string, number>;

  // scheduler → UI easing markers
  scheduledTransitions?: string[];

  // manual slider overrides
  manualOverrides: Record<string | number, number>;
}

// ---------- Events (Bethos-style parity) ----------
export interface LoadAnimationEvent {
  type: 'LOAD_ANIMATION';
  data?: Partial<NormalizedSnippet> & Partial<Snippet> & {
    curves?: Record<string, Array<
      | { time: number; intensity: number; inherit?: boolean }
      | { t?: number; v?: number; time?: number; intensity?: number; inherit?: boolean }
    >>;
  };
}
export interface RemoveAnimationEvent { type: 'REMOVE_ANIMATION'; name: string; }
export interface PlayAllEvent    { type: 'PLAY_ALL' }
export interface PauseAllEvent   { type: 'PAUSE_ALL' }
export interface StopAllEvent    { type: 'STOP_ALL' }

export interface CurveChangedEvent {
  type: 'CURVE_CHANGED';
  nameOrId: string;              // snippet name or identifier
  auId: string | number;         // curve id
  curve: CurvePoint[];           // replacement curve
}

export interface KeyframeHitEvent {
  type: 'KEYFRAME_HIT';
  data: Array<{
    tAbs: number;
    snippet: NormalizedSnippet;
    curveId: string;
    kfIdx: number;
  }>;
}

export interface ManualSetEvent {
  type: 'MANUAL_SET';
  id: string | number;
  value: number;
  isViseme?: boolean;
}
export interface ManualClearEvent { type: 'MANUAL_CLEAR'; id: string | number; }

export interface SnippetLoopEvent {
  type: 'SNIPPET_LOOPED';
  name: string;
  iteration: number;
  localTime: number;
}

export interface SetLoopStateEvent {
  type: 'SET_LOOP_STATE';
  name: string;
  iteration: number;
  localTime?: number;
}

export interface SeekSnippetEvent {
  type: 'SEEK_SNIPPET';
  name: string;
  time: number;
}

export type AnimEvent =
  | LoadAnimationEvent
  | RemoveAnimationEvent
  | PlayAllEvent
  | PauseAllEvent
  | StopAllEvent
  | CurveChangedEvent
  | KeyframeHitEvent
  | ManualSetEvent
  | ManualClearEvent
  | SnippetLoopEvent
  | SetLoopStateEvent
  | SeekSnippetEvent;

// ---------- Scheduler plumbing ----------
export type RuntimeSched = { name: string; startsAt: number; offset: number; enabled: boolean };
export type ScheduleOpts = {
  startInSec?: number;
  startAtSec?: number;
  offsetSec?: number;
  priority?: number;
  /** If true, the snippet will auto-play immediately regardless of global play state */
  autoPlay?: boolean;
};

// ---------- Baked Animation Engine Interface ----------

/**
 * Interface for baked animation engine capabilities.
 * Used by animation service to control baked animations from GLB/GLTF files.
 */
export interface BakedAnimationEngine {
  getAnimationClips(): BakedRuntimeClipInfo[];
  getPlayingAnimations(): BakedRuntimeAnimationState[];
  playAnimation(clipName: string, options?: AnimationPlayOptions): {
    getState: () => BakedRuntimeAnimationState;
    finished: Promise<void>;
  } | null;
  stopAnimation(clipName: string): void;
  pauseAnimation(clipName: string): void;
  resumeAnimation(clipName: string): void;
  setAnimationSpeed(clipName: string, speed: number): void;
  setAnimationIntensity(clipName: string, weight: number): void;
  setAnimationLoopMode?(clipName: string, loopMode: MixerLoopMode): void;
  setAnimationRepeatCount?(clipName: string, repeatCount?: number): void;
  setAnimationReverse?(clipName: string, reverse: boolean): void;
  setAnimationBlendMode?(clipName: string, blendMode: 'replace' | 'additive'): void;
  seekAnimation?(clipName: string, time: number): void;
  stopAllAnimations(): void;
}

// ---------- Narrow utilities ----------
export const isNumericId = (s: string) => /^\d+$/.test(s);
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
