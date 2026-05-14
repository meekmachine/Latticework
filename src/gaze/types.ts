export type GazeTarget = { x: number; y: number; z?: number };

export type GazeMode = 'manual' | 'mouse' | 'webcam';

export type GazeCommand =
  | { type: 'set-target'; target: GazeTarget; options?: GazeApplyOptions }
  | { type: 'set-mode'; mode: GazeMode }
  | { type: 'set-active'; active: boolean }
  | { type: 'update-config'; config: Partial<GazeConfig> }
  | { type: 'reset'; durationMs?: number }
  | { type: 'dispose' };

export type GazeEvent =
  | { type: 'target-received'; target: GazeTarget; timestamp: number }
  | { type: 'target-planned'; rawTarget: GazeTarget; target: GazeTarget; eyeDuration: number; headDuration: number; timestamp: number }
  | { type: 'target-ignored'; rawTarget: GazeTarget; target: GazeTarget; reason: 'min-delta' | 'disabled' | 'disposed'; timestamp: number }
  | { type: 'runtime-command'; command: GazeRuntimeCommand; timestamp: number }
  | { type: 'runtime-applied'; command: GazeRuntimeCommand; timestamp: number }
  | { type: 'runtime-skipped'; command: GazeRuntimeCommand; timestamp: number }
  | { type: 'mode-changed'; mode: GazeMode; timestamp: number }
  | { type: 'active-changed'; active: boolean; timestamp: number }
  | { type: 'config-updated'; config: GazeResolvedConfig; timestamp: number }
  | { type: 'disposed'; timestamp: number }
  | { type: 'error'; error: unknown; timestamp: number };

export interface GazeClock {
  now(): number;
}

export interface GazeRuntimeCommand {
  target: GazeTarget;
  rawTarget: GazeTarget;
  mode: GazeMode;
  eyeEnabled: boolean;
  headEnabled: boolean;
  headFollowEyes: boolean;
  eyeIntensity: number;
  headIntensity: number;
  eyeDuration: number;
  headDuration: number;
}

export interface GazeRuntimeResetOptions {
  eyes?: boolean;
  head?: boolean;
}

export interface GazeRuntime {
  apply(command: GazeRuntimeCommand): boolean | Promise<boolean>;
  reset?(durationMs?: number, options?: GazeRuntimeResetOptions): boolean | Promise<boolean>;
  dispose?(): void;
}

export interface GazeApplyOptions {
  eyeEnabled?: boolean;
  headEnabled?: boolean;
  headFollowEyes?: boolean;
  force?: boolean;
}

export interface GazeSetTargetResult {
  accepted: boolean;
  applied: boolean;
  rawTarget: GazeTarget;
  target: GazeTarget;
  eyeDuration: number;
  headDuration: number;
}

export interface GazeConfig {
  /** Drive eyes when true */
  eyesEnabled?: boolean;
  /** Drive head when true */
  headEnabled?: boolean;
  /** Whether head follows eye direction */
  headFollowEyes?: boolean;
  /** Mirror inputs (e.g., webcam already mirrored) */
  mirrored?: boolean;
  /** Optional smoothing factor (0-1, where 1 disables pre-smoothing) */
  smoothFactor?: number;
  /** Min delta before re-scheduling */
  minDelta?: number;
  /** Eye intensity (0-2, default 1.0) */
  eyeIntensity?: number;
  /** Head intensity (0-2, default 0.5) */
  headIntensity?: number;
  /** Preferred runtime bridge for blended animation output */
  runtime?: GazeRuntime | null;
  /** Compatibility bridge for direct AU control when no runtime is supplied */
  engine?: {
    transitionContinuum?: (negAu: number, posAu: number, value: number, durationMs: number) => void;
    transitionAU?: (auId: number, value: number, durationMs: number) => void;
  };
  /** External transport layer toggle */
  useTransport?: boolean;
  /** Injectable clock for deterministic tests */
  clock?: GazeClock;
}

export interface GazeState {
  target: GazeTarget;
  rawTarget: GazeTarget;
  lastAppliedTarget: GazeTarget;
  mode: GazeMode;
  isActive: boolean;
  isApplied: boolean;
  config: GazeResolvedConfig;
}

export type GazeResolvedConfig =
  Required<Pick<
    GazeConfig,
    | 'eyesEnabled'
    | 'headEnabled'
    | 'headFollowEyes'
    | 'mirrored'
    | 'smoothFactor'
    | 'minDelta'
    | 'eyeIntensity'
    | 'headIntensity'
    | 'useTransport'
  >> &
  Pick<GazeConfig, 'runtime' | 'engine' | 'clock'>;

export interface GazePlanInput {
  target: GazeTarget;
  previousTarget: GazeTarget;
  config: Pick<GazeResolvedConfig, 'mirrored' | 'smoothFactor' | 'minDelta'>;
  force?: boolean;
}

export interface GazePlan {
  rawTarget: GazeTarget;
  target: GazeTarget;
  accepted: boolean;
  eyeDuration: number;
  headDuration: number;
}
