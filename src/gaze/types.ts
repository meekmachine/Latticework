// Experimental gaze agency types (engine-first with optional transport)

export type GazeTarget = { x: number; y: number; z?: number };

export type GazeMode = 'manual' | 'mouse' | 'webcam';

export interface GazeConfig {
  /** Drive eyes via engine when true */
  eyesEnabled?: boolean;
  /** Drive head via engine when true */
  headEnabled?: boolean;
  /** Whether head follows eye direction */
  headFollowEyes?: boolean;
  /** Mirror inputs (e.g., webcam already mirrored) */
  mirrored?: boolean;
  /** Optional smoothing factor (0-1) */
  smoothFactor?: number;
  /** Min delta before re-scheduling */
  minDelta?: number;
  /** Eye intensity (0-2, default 1.0) */
  eyeIntensity?: number;
  /** Head intensity (0-2, default 0.5) */
  headIntensity?: number;
  /** Engine bridge for direct AU control */
  engine?: {
    transitionContinuum?: (negAu: number, posAu: number, value: number, durationMs: number) => void;
  };
  /** External transport layer toggle (e.g., Most.js stream) */
  useTransport?: boolean;
}

export interface GazeState {
  target: GazeTarget;
  mode: GazeMode;
  isActive: boolean;
}
