import type { GazeRuntime, GazeRuntimeCommand } from './types';

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
    reset(durationMs = 300): boolean {
      let applied = false;
      [61, 62, 63, 64, 51, 52, 53, 54].forEach((au) => {
        if (engine.transitionAU) {
          engine.transitionAU(au, 0, durationMs);
          applied = true;
        }
      });
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
  if (engine.transitionContinuum) {
    engine.transitionContinuum(negativeAu, positiveAu, value, durationMs);
    return true;
  }

  if (!engine.transitionAU) {
    return false;
  }

  if (value < 0) {
    engine.transitionAU(negativeAu, Math.abs(value), durationMs);
    engine.transitionAU(positiveAu, 0, durationMs);
  } else {
    engine.transitionAU(negativeAu, 0, durationMs);
    engine.transitionAU(positiveAu, value, durationMs);
  }

  return true;
}
