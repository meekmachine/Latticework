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

/**
 * Easing function for smooth, natural transitions
 * Uses ease-in-out cubic for human-like deceleration
 */
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class EyeHeadTrackingScheduler {
  private host: EyeHeadHostCaps;
  private transitionConfig: GazeTransitionConfig;
  private scheduled = new Set<string>();

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
    const eyeDurationSec = Math.max(0.001, eyeDuration) / 1000;
    const headDurationSec = Math.max(0.001, headDuration) / 1000;

    let scheduled = false;

    // Schedule eye movements using continuum snippets
    if (eyeEnabled) {
      scheduled = this.scheduleEyeContinuum(targetX, targetY, eyeIntensity, eyeDurationSec, eyePriority) || scheduled;
    }

    // Schedule head movements using continuum snippets (yaw, pitch, and roll)
    if (headEnabled && headFollowEyes) {
      scheduled = this.scheduleHeadContinuum(
        targetX,
        targetY,
        headRoll,
        headIntensity,
        headDurationSec,
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
    duration: number,
    priority: number
  ): boolean {
    // Yaw (horizontal): Input x already has correct sign from mouse tracking.
    // x is in viewer space: positive = character should look toward viewer's left (AU 62)
    // No additional inversion needed here - the mouse tracking handles it.
    // Value in -1 to +1 range (like blink scheduler uses 0-1)
    const yaw = x * intensity;
    const yawCurves = this.buildContinuumCurves(
      EYE_HEAD_AUS.EYE_YAW_LEFT,
      EYE_HEAD_AUS.EYE_YAW_RIGHT,
      yaw,
      duration
    );

    const yawOk = this.upsertSnippet({
      name: 'eyeHeadTracking/eyeYaw',
      curves: yawCurves,
      maxTime: duration,
      loop: false,
      mixerClampWhenFinished: true,
      snippetCategory: 'eyeHeadTracking',
      snippetPriority: priority,
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
    });

    // Pitch (vertical): -1 (down/AU 64) to +1 (up/AU 63)
    // Value in -1 to +1 range
    const pitch = y * intensity;
    const pitchCurves = this.buildContinuumCurves(
      EYE_HEAD_AUS.EYE_PITCH_DOWN,
      EYE_HEAD_AUS.EYE_PITCH_UP,
      pitch,
      duration
    );

    const pitchOk = this.upsertSnippet({
      name: 'eyeHeadTracking/eyePitch',
      curves: pitchCurves,
      maxTime: duration,
      loop: false,
      mixerClampWhenFinished: true,
      snippetCategory: 'eyeHeadTracking',
      snippetPriority: priority,
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
    });

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
    duration: number,
    priority: number
  ): boolean {
    // Yaw (horizontal): Input x already has correct sign from mouse tracking.
    // x is in viewer space: positive = character should look toward viewer's left (AU 52)
    // No additional inversion needed here - the mouse tracking handles it.
    // Value in -1 to +1 range
    const yaw = x * intensity;
    const yawCurves = this.buildContinuumCurves(
      EYE_HEAD_AUS.HEAD_YAW_LEFT,
      EYE_HEAD_AUS.HEAD_YAW_RIGHT,
      yaw,
      duration
    );

    const yawOk = this.upsertSnippet({
      name: 'eyeHeadTracking/headYaw',
      curves: yawCurves,
      maxTime: duration,
      loop: false,
      mixerClampWhenFinished: true,
      snippetCategory: 'eyeHeadTracking',
      snippetPriority: priority,
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
    });

    // Pitch (vertical): -1 (down/AU 54) to +1 (up/AU 53)
    // Value in -1 to +1 range
    const pitch = y * intensity;
    const pitchCurves = this.buildContinuumCurves(
      EYE_HEAD_AUS.HEAD_PITCH_DOWN,
      EYE_HEAD_AUS.HEAD_PITCH_UP,
      pitch,
      duration
    );

    const pitchOk = this.upsertSnippet({
      name: 'eyeHeadTracking/headPitch',
      curves: pitchCurves,
      maxTime: duration,
      loop: false,
      mixerClampWhenFinished: true,
      snippetCategory: 'eyeHeadTracking',
      snippetPriority: priority,
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
    });

    // Roll (tilt): -1 (left/AU 55) to +1 (right/AU 56)
    // Value in -1 to +1 range
    const rollValue = roll * intensity;
    const rollCurves = this.buildContinuumCurves(
      EYE_HEAD_AUS.HEAD_ROLL_LEFT,
      EYE_HEAD_AUS.HEAD_ROLL_RIGHT,
      rollValue,
      duration
    );

    const rollOk = this.upsertSnippet({
      name: 'eyeHeadTracking/headRoll',
      curves: rollCurves,
      maxTime: duration,
      loop: false,
      mixerClampWhenFinished: true,
      snippetCategory: 'eyeHeadTracking',
      snippetPriority: priority,
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
    });

    return yawOk || pitchOk || rollOk;
  }

  /**
   * Schedule a snippet. Always schedules fresh - the mixer's crossfade handles
   * smooth transitions from the previous value to the new target.
   * Returns true if the snippet is active after this call.
   */
  private upsertSnippet(snippet: any): boolean {
    const name = snippet?.name || '';

    try {
      // Remove existing snippet first to ensure clean transition
      if (this.scheduled.has(name)) {
        this.host.removeSnippet(name);
        this.scheduled.delete(name);
      }

      // Schedule new snippet - mixer crossfade handles the transition
      const scheduledName = this.host.scheduleSnippet(snippet) ?? name;
      if (scheduledName) {
        this.scheduled.add(scheduledName);
        this.host.resumeSnippet?.(scheduledName);
        return true;
      }
    } catch {
      // Scheduling failed
    }

    return false;
  }

  /**
   * Build continuum curves for a bidirectional axis
   * Value: negative values use negativeAU, positive values use positiveAU
   * This matches the continuum slider behavior
   *
   * Uses a SINGLE keyframe at the target position. The mixer's crossfade
   * handles smooth blending from current to target. This avoids the reset-to-zero
   * issue that occurs with two-keyframe animations that start at 0.
   */
  private buildContinuumCurves(
    negativeAU: string,
    positiveAU: string,
    value: number,
    duration: number
  ): Record<string, Array<{ time: number; intensity: number; inherit?: boolean }>> {
    const curves: Record<string, Array<{ time: number; intensity: number; inherit?: boolean }>> = {};
    const endTime = Math.max(0.001, duration);

    // Start from the current AU values and animate to the requested target.
    // The runtime resolves the inherited first keyframe against the live pose,
    // which removes the slow asymptotic chase in experimental scheduler mode.
    if (value < 0) {
      curves[negativeAU] = [
        { time: 0, intensity: 0, inherit: true },
        { time: endTime, intensity: Math.abs(value) }
      ];
      curves[positiveAU] = [
        { time: 0, intensity: 0, inherit: true },
        { time: endTime, intensity: 0 }
      ];
    } else {
      curves[negativeAU] = [
        { time: 0, intensity: 0, inherit: true },
        { time: endTime, intensity: 0 }
      ];
      curves[positiveAU] = [
        { time: 0, intensity: 0, inherit: true },
        { time: endTime, intensity: value }
      ];
    }

    return curves;
  }


  /**
   * Stop and remove all tracking snippets
   */
  public stop(): void {
    // Remove eye tracking snippets
    this.host.removeSnippet('eyeHeadTracking/eyeYaw');
    this.host.removeSnippet('eyeHeadTracking/eyePitch');

    // Remove head tracking snippets
    this.host.removeSnippet('eyeHeadTracking/headYaw');
    this.host.removeSnippet('eyeHeadTracking/headPitch');
    this.host.removeSnippet('eyeHeadTracking/headRoll');
    this.scheduled.clear();

    // Stopped - removed all gaze tracking snippets
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
  public resetToNeutral(duration: number = 300): void {
    this.scheduleGazeTransition({ x: 0, y: 0, z: 0 }, { duration });
  }

  /**
   * Cleanup and release resources
   */
  public dispose(): void {
    this.stop();
  }
}
