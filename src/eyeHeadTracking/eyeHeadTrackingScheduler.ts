/**
 * Eye and Head Tracking Scheduler V2
 * Schedules eye/head tracking animations using animation agency
 * Follows the same pattern as BlinkScheduler
 *
 * Uses continuum animation snippets for each axis:
 * - Eyes Yaw (horizontal): AU 61 (left) ↔ AU 62 (right)
 * - Eyes Pitch (vertical): AU 64 (down) ↔ AU 63 (up)
 * - Head Yaw (horizontal): AU 51 (left) ↔ AU 52 (right)
 * - Head Pitch (vertical): AU 54 (down) ↔ AU 53 (up)
 * - Head Roll (tilt): AU 55 (left) ↔ AU 56 (right)
 */

import type { GazeTarget } from './types';

export interface EyeHeadHostCaps {
  scheduleSnippet: (snippet: any) => string | null;
  updateSnippet?: (snippet: any) => string | null;
  seekSnippet?: (name: string, offsetSec: number) => void;
  pauseSnippet?: (name: string) => void;
  resumeSnippet?: (name: string) => void;
  restartSnippet?: (name: string) => void;
  setSnippetPlaybackRate?: (name: string, rate: number) => void;
  setSnippetIntensityScale?: (name: string, scale: number) => void;
  setSnippetReverse?: (name: string, reverse: boolean) => void;
  removeSnippet: (name: string) => void;
  onSnippetEnd?: (name: string) => void;
}

export interface GazeTransitionConfig {
  duration: number; // ms - how long the transition takes
  eyeIntensity: number; // 0-1 scale factor for eye movement
  headIntensity: number; // 0-1 scale factor for head movement
  eyePriority: number; // Animation priority
  headPriority: number; // Animation priority
}

const DEFAULT_TRANSITION_CONFIG: GazeTransitionConfig = {
  duration: 200, // Snappy but natural eye motion; head follows via headDuration
  eyeIntensity: 1.0,
  headIntensity: 0.5,
  eyePriority: 20,
  headPriority: 15,
};

const EYE_SNIPPET_NAMES = [
  'eyeHeadTracking/eyeYaw',
  'eyeHeadTracking/eyePitch',
] as const;

const HEAD_SNIPPET_NAMES = [
  'eyeHeadTracking/headYaw',
  'eyeHeadTracking/headPitch',
  'eyeHeadTracking/headRoll',
] as const;

type AxisSpec = {
  name: typeof EYE_SNIPPET_NAMES[number] | typeof HEAD_SNIPPET_NAMES[number];
  negativeAU: string;
  positiveAU: string;
  priority: number;
};

type AxisState = {
  currentTime: number;
  targetTime: number;
  lastUpdatedAt: number;
  playbackRate: number;
  direction: 1 | -1;
  timer: ReturnType<typeof globalThis.setTimeout> | null;
};

const CONTROL_CLIP_DURATION_SEC = 1;
const NEUTRAL_TIME_SEC = 0.5;
const MIN_TRAVEL_TIME_SEC = 0.016;
const MIN_PLAYBACK_RATE = 0.001;
const TARGET_EPSILON = 0.001;

// ARKit AU IDs for eye and head movements
export const EYE_HEAD_AUS = {
  // Eye AUs
  EYE_YAW_LEFT: '61',    // Look left
  EYE_YAW_RIGHT: '62',   // Look right
  EYE_PITCH_UP: '63',    // Look up
  EYE_PITCH_DOWN: '64',  // Look down

  // Head AUs (M51-M56 in FACS notation)
  HEAD_YAW_LEFT: '51',   // Turn left
  HEAD_YAW_RIGHT: '52',  // Turn right
  HEAD_PITCH_UP: '53',   // Look up
  HEAD_PITCH_DOWN: '54', // Look down
  HEAD_ROLL_LEFT: '55',  // Tilt left
  HEAD_ROLL_RIGHT: '56', // Tilt right
} as const;

export class EyeHeadTrackingScheduler {
  private host: EyeHeadHostCaps;
  private transitionConfig: GazeTransitionConfig;
  private scheduled = new Set<string>();
  private axisStates = new Map<string, AxisState>();

  constructor(host: EyeHeadHostCaps, transitionConfig?: Partial<GazeTransitionConfig>) {
    this.host = host;
    this.transitionConfig = {
      ...DEFAULT_TRANSITION_CONFIG,
      ...transitionConfig,
    };

    // Scheduler initialized
  }

  /**
   * Update transition configuration
   */
  public updateConfig(config: Partial<GazeTransitionConfig>): void {
    this.transitionConfig = {
      ...this.transitionConfig,
      ...config,
    };
  }

  /**
   * Schedule gaze transition - continuum-based version
   * Uses separate continuum snippets for each axis (yaw/pitch/roll)
   * This matches how continuum sliders work - one snippet per axis
   */
  public scheduleGazeTransition(
    target: GazeTarget,
    options?: {
      eyeEnabled?: boolean;
      headEnabled?: boolean;
      headFollowEyes?: boolean;
      headRoll?: number; // Optional head tilt/roll (-1 to 1, left to right)
      duration?: number;
      eyeDuration?: number;
      headDuration?: number;
    }
  ): boolean {
    const {
      eyeEnabled = true,
      headEnabled = true,
      headFollowEyes = true,
      headRoll = 0,
      duration = this.transitionConfig.duration,
      eyeDuration = duration,
      headDuration = duration,
    } = options || {};

    const { x: targetX, y: targetY, z: targetZ = 0 } = target;
    const { eyeIntensity, headIntensity, eyePriority, headPriority } = this.transitionConfig;

    let scheduled = false;

    // Schedule eye movements using continuum snippets
    if (eyeEnabled) {
      scheduled = this.scheduleEyeContinuum(targetX, targetY, eyeIntensity, eyeDuration, eyePriority) || scheduled;
    }

    // Schedule head movements using continuum snippets (yaw, pitch, and roll)
    if (headEnabled && headFollowEyes) {
      scheduled = this.scheduleHeadContinuum(
        targetX,
        targetY,
        headRoll,
        headIntensity,
        headDuration,
        headPriority
      ) || scheduled;
    }

    return scheduled;
  }

  /**
   * Schedule eye continuum snippets for yaw and pitch axes
   */
  private scheduleEyeContinuum(
    x: number,
    y: number,
    intensity: number,
    durationMs: number,
    priority: number
  ): boolean {
    // Yaw (horizontal): Input x already has correct sign from mouse tracking.
    // x is in viewer space: positive = character should look toward viewer's left (AU 62)
    // No additional inversion needed here - the mouse tracking handles it.
    // Value in -1 to +1 range (like blink scheduler uses 0-1)
    const yawOk = this.driveAxis({
      name: 'eyeHeadTracking/eyeYaw',
      negativeAU: EYE_HEAD_AUS.EYE_YAW_LEFT,
      positiveAU: EYE_HEAD_AUS.EYE_YAW_RIGHT,
      priority,
    }, x, intensity, durationMs);

    // Pitch (vertical): -1 (down/AU 64) to +1 (up/AU 63)
    // Value in -1 to +1 range
    const pitchOk = this.driveAxis({
      name: 'eyeHeadTracking/eyePitch',
      negativeAU: EYE_HEAD_AUS.EYE_PITCH_DOWN,
      positiveAU: EYE_HEAD_AUS.EYE_PITCH_UP,
      priority,
    }, y, intensity, durationMs);

    return yawOk || pitchOk;
  }

  /**
   * Schedule head continuum snippets for yaw, pitch, and roll axes
   */
  private scheduleHeadContinuum(
    x: number,
    y: number,
    roll: number,
    intensity: number,
    durationMs: number,
    priority: number
  ): boolean {
    // Yaw (horizontal): Input x already has correct sign from mouse tracking.
    // x is in viewer space: positive = character should look toward viewer's left (AU 52)
    // No additional inversion needed here - the mouse tracking handles it.
    // Value in -1 to +1 range
    const yawOk = this.driveAxis({
      name: 'eyeHeadTracking/headYaw',
      negativeAU: EYE_HEAD_AUS.HEAD_YAW_LEFT,
      positiveAU: EYE_HEAD_AUS.HEAD_YAW_RIGHT,
      priority,
    }, x, intensity, durationMs);

    // Pitch (vertical): -1 (down/AU 54) to +1 (up/AU 53)
    // Value in -1 to +1 range
    const pitchOk = this.driveAxis({
      name: 'eyeHeadTracking/headPitch',
      negativeAU: EYE_HEAD_AUS.HEAD_PITCH_DOWN,
      positiveAU: EYE_HEAD_AUS.HEAD_PITCH_UP,
      priority,
    }, y, intensity, durationMs);

    // Roll (tilt): -1 (left/AU 55) to +1 (right/AU 56)
    // Value in -1 to +1 range
    const rollOk = this.driveAxis({
      name: 'eyeHeadTracking/headRoll',
      negativeAU: EYE_HEAD_AUS.HEAD_ROLL_LEFT,
      positiveAU: EYE_HEAD_AUS.HEAD_ROLL_RIGHT,
      priority,
    }, roll, intensity, durationMs);

    return yawOk || pitchOk || rollOk;
  }

  private driveAxis(
    spec: AxisSpec,
    rawValue: number,
    intensity: number,
    durationMs: number
  ): boolean {
    const name = spec.name;
    if (!this.ensureAxisSnippet(spec)) {
      return false;
    }

    const nextIntensity = Math.max(0, Number.isFinite(intensity) ? intensity : 1);
    this.host.setSnippetIntensityScale?.(name, nextIntensity);

    const currentTime = this.getEstimatedAxisTime(name);
    const targetTime = this.valueToControlTime(rawValue);
    const delta = targetTime - currentTime;
    const distance = Math.abs(delta);
    const now = this.now();
    const state = this.getAxisState(name, now);

    this.clearAxisTimer(name);

    if (distance <= TARGET_EPSILON) {
      this.host.seekSnippet?.(name, targetTime);
      this.host.pauseSnippet?.(name);
      state.currentTime = targetTime;
      state.targetTime = targetTime;
      state.lastUpdatedAt = now;
      state.playbackRate = 0;
      state.direction = delta < 0 ? -1 : 1;
      return true;
    }

    const travelSec = Math.max(MIN_TRAVEL_TIME_SEC, durationMs / 1000);
    const direction: 1 | -1 = delta < 0 ? -1 : 1;
    const playbackRate = Math.max(MIN_PLAYBACK_RATE, distance / travelSec);

    state.currentTime = currentTime;
    state.targetTime = targetTime;
    state.lastUpdatedAt = now;
    state.playbackRate = playbackRate;
    state.direction = direction;

    this.host.seekSnippet?.(name, currentTime);
    this.host.setSnippetReverse?.(name, direction < 0);
    this.host.setSnippetPlaybackRate?.(name, playbackRate);
    this.host.resumeSnippet?.(name);

    state.timer = globalThis.setTimeout(() => {
      this.host.seekSnippet?.(name, targetTime);
      this.host.pauseSnippet?.(name);
      state.currentTime = targetTime;
      state.targetTime = targetTime;
      state.lastUpdatedAt = this.now();
      state.playbackRate = 0;
    }, Math.ceil(travelSec * 1000));

    return true;
  }

  private ensureAxisSnippet(spec: AxisSpec): boolean {
    const name = spec.name;
    if (this.scheduled.has(name)) {
      return true;
    }

    try {
      const scheduledName = this.host.scheduleSnippet(this.buildControlSnippet(spec));
      if (!scheduledName) {
        return false;
      }

      this.scheduled.add(name);
      this.getAxisState(name, this.now());
      this.host.seekSnippet?.(name, NEUTRAL_TIME_SEC);
      this.host.pauseSnippet?.(name);
      return true;
    } catch {
      return false;
    }
  }

  private buildControlSnippet(spec: AxisSpec): any {
    return {
      name: spec.name,
      curves: this.buildControlCurves(spec.negativeAU, spec.positiveAU),
      maxTime: CONTROL_CLIP_DURATION_SEC,
      loop: false,
      mixerClampWhenFinished: true,
      snippetCategory: 'eyeHeadTracking',
      snippetPriority: spec.priority,
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
      currentTime: NEUTRAL_TIME_SEC,
    };
  }

  private buildControlCurves(
    negativeAU: string,
    positiveAU: string
  ): Record<string, Array<{ time: number; intensity: number }>> {
    return {
      [negativeAU]: [
        { time: 0, intensity: 1 },
        { time: NEUTRAL_TIME_SEC, intensity: 0 },
        { time: CONTROL_CLIP_DURATION_SEC, intensity: 0 },
      ],
      [positiveAU]: [
        { time: 0, intensity: 0 },
        { time: NEUTRAL_TIME_SEC, intensity: 0 },
        { time: CONTROL_CLIP_DURATION_SEC, intensity: 1 },
      ],
    };
  }

  private valueToControlTime(value: number): number {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    return NEUTRAL_TIME_SEC + clamped * NEUTRAL_TIME_SEC;
  }

  private getEstimatedAxisTime(name: string): number {
    const now = this.now();
    const state = this.getAxisState(name, now);
    if (state.playbackRate <= 0 || state.currentTime === state.targetTime) {
      return state.currentTime;
    }

    const elapsedSec = Math.max(0, (now - state.lastUpdatedAt) / 1000);
    const estimated = state.currentTime + elapsedSec * state.playbackRate * state.direction;
    const reachedTarget = state.direction > 0
      ? estimated >= state.targetTime
      : estimated <= state.targetTime;

    if (reachedTarget) {
      state.currentTime = state.targetTime;
      state.lastUpdatedAt = now;
      state.playbackRate = 0;
      return state.targetTime;
    }

    return Math.max(0, Math.min(CONTROL_CLIP_DURATION_SEC, estimated));
  }

  private getAxisState(name: string, now: number): AxisState {
    let state = this.axisStates.get(name);
    if (!state) {
      state = {
        currentTime: NEUTRAL_TIME_SEC,
        targetTime: NEUTRAL_TIME_SEC,
        lastUpdatedAt: now,
        playbackRate: 0,
        direction: 1,
        timer: null,
      };
      this.axisStates.set(name, state);
    }
    return state;
  }

  private clearAxisTimer(name: string): void {
    const state = this.axisStates.get(name);
    if (state?.timer) {
      globalThis.clearTimeout(state.timer);
      state.timer = null;
    }
  }

  private now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  /**
   * Stop and remove all tracking snippets
   */
  public stop(): void {
    this.stopEyes();
    this.stopHead();

    // Stopped - removed all gaze tracking snippets
  }

  public stopEyes(): void {
    this.removeSnippets(EYE_SNIPPET_NAMES);
  }

  public stopHead(): void {
    this.removeSnippets(HEAD_SNIPPET_NAMES);
  }

  public pause(): void {
    if (this.host.pauseSnippet) {
      this.host.pauseSnippet('eyeHeadTracking/eyeYaw');
      this.host.pauseSnippet('eyeHeadTracking/eyePitch');
      this.host.pauseSnippet('eyeHeadTracking/headYaw');
      this.host.pauseSnippet('eyeHeadTracking/headPitch');
      this.host.pauseSnippet('eyeHeadTracking/headRoll');
      return;
    }

    this.stop();
  }

  public resume(): void {
    if (!this.host.resumeSnippet) return;
    this.host.resumeSnippet('eyeHeadTracking/eyeYaw');
    this.host.resumeSnippet('eyeHeadTracking/eyePitch');
    this.host.resumeSnippet('eyeHeadTracking/headYaw');
    this.host.resumeSnippet('eyeHeadTracking/headPitch');
    this.host.resumeSnippet('eyeHeadTracking/headRoll');
  }

  /**
   * Reset gaze to center (neutral position)
   */
  public resetToNeutral(
    duration: number = 300,
    options?: {
      eyeEnabled?: boolean;
      headEnabled?: boolean;
      headFollowEyes?: boolean;
    }
  ): boolean {
    const {
      eyeEnabled = true,
      headEnabled = true,
      headFollowEyes = true,
    } = options || {};

    if (!eyeEnabled && !headEnabled) {
      return false;
    }

    return this.scheduleGazeTransition(
      { x: 0, y: 0, z: 0 },
      { duration, eyeEnabled, headEnabled, headFollowEyes }
    );
  }

  /**
   * Cleanup and release resources
   */
  public dispose(): void {
    this.stop();
  }

  private removeSnippets(names: readonly string[]): void {
    names.forEach((name) => {
      this.clearAxisTimer(name);
      this.host.removeSnippet(name);
      this.scheduled.delete(name);
      this.axisStates.delete(name);
    });
  }
}
