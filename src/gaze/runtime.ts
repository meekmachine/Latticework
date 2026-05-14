import type { GazeRuntime, GazeRuntimeCommand, GazeRuntimeResetOptions } from './types';

export interface GazeEngineRuntimeHost {
  transitionContinuum?: (negAu: number, posAu: number, value: number, durationMs: number) => void;
  transitionAU?: (auId: number, value: number, durationMs: number) => void;
}

export function createEngineGazeRuntime(engine: GazeEngineRuntimeHost | undefined | null): GazeRuntime | null {
  if (!engine) return null;

  return {
    apply(command: GazeRuntimeCommand): boolean {
      let applied = false;

      if (command.eyeEnabled) {
        const eyeYaw = command.target.x * command.eyeIntensity;
        const eyePitch = command.target.y * command.eyeIntensity;
        applied = applyContinuum(engine, 61, 62, eyeYaw, command.eyeDuration) || applied;
        applied = applyContinuum(engine, 64, 63, eyePitch, command.eyeDuration) || applied;
      }

      if (command.headEnabled && command.headFollowEyes) {
        const headYaw = command.target.x * command.headIntensity;
        const headPitch = command.target.y * command.headIntensity;
        applied = applyContinuum(engine, 51, 52, headYaw, command.headDuration) || applied;
        applied = applyContinuum(engine, 54, 53, headPitch, command.headDuration) || applied;
      }

      return applied;
    },
    reset(durationMs = 300, options: GazeRuntimeResetOptions = {}): boolean {
      let applied = false;
      const resetEyes = options.eyes ?? true;
      const resetHead = options.head ?? true;

      if (resetEyes) {
        applied = applyContinuum(engine, 61, 62, 0, durationMs) || applied;
        applied = applyContinuum(engine, 64, 63, 0, durationMs) || applied;
      }

      if (resetHead) {
        applied = applyContinuum(engine, 51, 52, 0, durationMs) || applied;
        applied = applyContinuum(engine, 54, 53, 0, durationMs) || applied;
        applied = applyContinuum(engine, 55, 56, 0, durationMs) || applied;
      }

      return applied;
    },
  };
}

function applyContinuum(
  engine: GazeEngineRuntimeHost,
  negativeAu: number,
  positiveAu: number,
  value: number,
  durationMs: number
): boolean {
  if (!engine.transitionContinuum) {
    return false;
  }

  engine.transitionContinuum(negativeAu, positiveAu, value, durationMs);
  return true;
}
