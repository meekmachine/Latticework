import { describe, expect, it, vi } from 'vitest';
import { GazeService, planGazeTarget } from '../service';
import type { GazeRuntimeCommand } from '../types';

describe('planGazeTarget', () => {
  it('uses the raw target when smoothing is disabled by smoothFactor 1', () => {
    const plan = planGazeTarget({
      target: { x: 0.8, y: -0.4, z: 0 },
      previousTarget: { x: 0.1, y: 0.1, z: 0 },
      config: {
        mirrored: false,
        smoothFactor: 1,
        minDelta: 0.003,
      },
    });

    expect(plan.rawTarget).toEqual({ x: 0.8, y: -0.4, z: 0 });
    expect(plan.target).toEqual(plan.rawTarget);
    expect(plan.accepted).toBe(true);
  });

  it('mirrors the raw target before planning', () => {
    const plan = planGazeTarget({
      target: { x: 0.5, y: 0.2, z: 0 },
      previousTarget: { x: 0, y: 0, z: 0 },
      config: {
        mirrored: true,
        smoothFactor: 1,
        minDelta: 0.003,
      },
    });

    expect(plan.rawTarget).toEqual({ x: -0.5, y: 0.2, z: 0 });
    expect(plan.target).toEqual(plan.rawTarget);
  });
});

describe('GazeService', () => {
  it('applies accepted targets through the runtime and records applied state', () => {
    const apply = vi.fn((_command: GazeRuntimeCommand) => true);
    const service = new GazeService({
      runtime: { apply },
      smoothFactor: 1,
      minDelta: 0.003,
      eyesEnabled: true,
      headEnabled: true,
      clock: { now: () => 100 },
    });

    const result = service.setTarget(
      { x: 0.4, y: -0.2, z: 0 },
      { eyeEnabled: true, headEnabled: false, headFollowEyes: false }
    );

    expect(result).toMatchObject({
      accepted: true,
      applied: true,
      rawTarget: { x: 0.4, y: -0.2, z: 0 },
      target: { x: 0.4, y: -0.2, z: 0 },
    });
    expect(apply).toHaveBeenCalledTimes(1);

    const command = apply.mock.calls[0][0] as GazeRuntimeCommand;
    expect(command).toMatchObject({
      target: { x: 0.4, y: -0.2, z: 0 },
      rawTarget: { x: 0.4, y: -0.2, z: 0 },
      mode: 'manual',
      eyeEnabled: true,
      headEnabled: false,
      headFollowEyes: false,
    });
    expect(service.snapshot.lastAppliedTarget).toEqual({ x: 0.4, y: -0.2, z: 0 });
    expect(service.snapshot.isApplied).toBe(true);

    service.dispose();
  });

  it('does not apply targets below the min delta', () => {
    const apply = vi.fn((_command: GazeRuntimeCommand) => true);
    const service = new GazeService({
      runtime: { apply },
      smoothFactor: 1,
      minDelta: 0.5,
    });

    const result = service.setTarget({ x: 0.1, y: 0.1, z: 0 });

    expect(result.accepted).toBe(false);
    expect(result.applied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(service.snapshot.target).toEqual({ x: 0.1, y: 0.1, z: 0 });
    expect(service.snapshot.isApplied).toBe(false);

    service.dispose();
  });

  it('falls back to direct engine continuum output when no runtime is supplied', () => {
    const engine = {
      transitionContinuum: vi.fn(),
      transitionAU: vi.fn(),
    };
    const service = new GazeService({
      engine,
      smoothFactor: 1,
      minDelta: 0.003,
      eyesEnabled: true,
      headEnabled: true,
      headFollowEyes: true,
      eyeIntensity: 1,
      headIntensity: 0.5,
    });

    const result = service.setTarget({ x: 0.5, y: -0.25, z: 0 });

    expect(result.applied).toBe(true);
    expect(engine.transitionContinuum).toHaveBeenCalledWith(61, 62, 0.5, expect.any(Number));
    expect(engine.transitionContinuum).toHaveBeenCalledWith(64, 63, -0.25, expect.any(Number));
    expect(engine.transitionContinuum).toHaveBeenCalledWith(51, 52, 0.25, expect.any(Number));
    expect(engine.transitionContinuum).toHaveBeenCalledWith(54, 53, -0.125, expect.any(Number));
    expect(engine.transitionAU).not.toHaveBeenCalled();

    service.dispose();
  });
});
