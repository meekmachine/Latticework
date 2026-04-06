import type { GazeTarget } from './types';

export type TrackingMode = 'manual' | 'mouse' | 'webcam';

interface PlannerConfig {
  minDistance: number;
  minPlanDistance: number;
  minIntervalMs: number;
  leadMsMouse: number;
  leadMsWebcam: number;
  leadMsManual: number;
  minEyeDuration: number;
  maxEyeDuration: number;
  minHeadDuration: number;
  maxHeadDuration: number;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  minDistance: 0.004,
  minPlanDistance: 0.01,
  minIntervalMs: 90,
  leadMsMouse: 90,
  leadMsWebcam: 120,
  leadMsManual: 100,
  minEyeDuration: 140,
  maxEyeDuration: 420,
  minHeadDuration: 220,
  maxHeadDuration: 650,
};

export interface PlanResult {
  target: GazeTarget;
  eyeDuration: number;
  headDuration: number;
  shouldSchedule: boolean;
}

interface PlanInput {
  target: GazeTarget;
  mode: TrackingMode;
  nowMs: number;
  lastAgencyTarget: GazeTarget;
  currentGaze: GazeTarget;
  headFollowDelay: number;
}

/**
 * Simple goal/trajectory planner that:
 * - Predicts a short-horizon target from velocity
 * - Throttles scheduling when motion is negligible
 * - Shortens durations when moving fast
 */
export class EyeHeadPlanner {
  private config: PlannerConfig;
  private lastPlannedTarget: GazeTarget = { x: 0, y: 0, z: 0 };
  private lastPlannedTime: number = 0;
  private lastVelocity: { x: number; y: number } = { x: 0, y: 0 };

  constructor(config?: Partial<PlannerConfig>) {
    this.config = { ...DEFAULT_PLANNER_CONFIG, ...config };
  }

  public updateConfig(config: Partial<PlannerConfig>) {
    this.config = { ...this.config, ...config };
  }

  public plan(input: PlanInput): PlanResult {
    const { target, mode, nowMs, lastAgencyTarget, currentGaze, headFollowDelay } = input;
    const dt = Math.max(1, nowMs - (this.lastPlannedTime || nowMs));
    const vx = (target.x - this.lastPlannedTarget.x) / dt;
    const vy = (target.y - this.lastPlannedTarget.y) / dt;

    const leadMs = mode === 'mouse'
      ? this.config.leadMsMouse
      : mode === 'webcam'
        ? this.config.leadMsWebcam
        : this.config.leadMsManual;

    // Predict slightly ahead
    const planned: GazeTarget = {
      x: clamp(target.x + vx * leadMs, -1, 1),
      y: clamp(target.y + vy * leadMs, -1, 1),
      z: 0,
    };

    // Skip if movement is tiny and recent
    const plannedDistance = Math.hypot(planned.x - lastAgencyTarget.x, planned.y - lastAgencyTarget.y);
    if (
      plannedDistance < this.config.minPlanDistance &&
      nowMs - this.lastPlannedTime < this.config.minIntervalMs
    ) {
      return {
        target: planned,
        eyeDuration: this.config.minEyeDuration,
        headDuration: this.config.minHeadDuration + headFollowDelay,
        shouldSchedule: false,
      };
    }

    // Durations based on distance and speed
    const dist = Math.hypot(planned.x - currentGaze.x, planned.y - currentGaze.y);
    const normDist = Math.min(dist / Math.SQRT2, 1);

    const velPerSec = Math.hypot(vx, vy) * 1000;
    const speedFactor = clamp(1 - Math.min(velPerSec, 2) * 0.25, 0.55, 1.0);

    const eyeDuration = Math.round(
      (this.config.minEyeDuration + normDist * (this.config.maxEyeDuration - this.config.minEyeDuration)) *
      speedFactor
    );
    const headBase = Math.round(
      (this.config.minHeadDuration + normDist * (this.config.maxHeadDuration - this.config.minHeadDuration)) *
      speedFactor
    );

    this.lastPlannedTarget = planned;
    this.lastPlannedTime = nowMs;
    this.lastVelocity = { x: vx, y: vy };

    return {
      target: planned,
      eyeDuration,
      headDuration: headBase + headFollowDelay,
      shouldSchedule: true,
    };
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
