import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createEyeHeadTrackingService } from '../eyeHeadTrackingService';

class FakeControls {
  target = new THREE.Vector3(0, 1, 0);
  private listeners = new Set<() => void>();

  addEventListener(type: 'change', listener: () => void): void {
    if (type === 'change') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: 'change', listener: () => void): void {
    if (type === 'change') {
      this.listeners.delete(listener);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function createHarness(config: {
  eyeTrackingEnabled?: boolean;
  headTrackingEnabled?: boolean;
  gazeMode?: 'engine' | 'legacy' | 'experimental';
  animationAgency?: any;
} = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 3);

  const controls = new FakeControls();
  const model = new THREE.Object3D();
  const getModel = vi.fn(() => model);

  const engine = {
    transitionContinuum: vi.fn(),
    transitionAU: vi.fn(),
    setAUMixWeight: vi.fn(),
  };

  const service = createEyeHeadTrackingService({
    engine,
    cameraController: {
      camera,
      controls,
      getModel,
    },
    animationAgency: config.animationAgency,
    eyeTrackingEnabled: config.eyeTrackingEnabled ?? true,
    headTrackingEnabled: config.headTrackingEnabled ?? true,
    headFollowEyes: true,
    gazeMode: config.gazeMode,
    useAnimationAgency: false,
  });

  return {
    camera,
    controls,
    engine,
    getModel,
    service,
  };
}

function createAnimationAgency() {
  return {
    playing: false,
    play: vi.fn(),
    schedule: vi.fn((snippet: { name: string }) => snippet.name),
    updateSnippet: vi.fn((snippet: { name: string }) => snippet.name),
    seek: vi.fn(),
    pauseSnippet: vi.fn(),
    resumeSnippet: vi.fn(),
    restartSnippet: vi.fn(),
    remove: vi.fn(),
    onSnippetEnd: vi.fn(),
  };
}

describe('EyeHeadTrackingService camera-relative gaze', () => {
  it('waits until tracking starts before computing the camera-relative offset', () => {
    const harness = createHarness();

    expect(harness.getModel).not.toHaveBeenCalled();
    expect(harness.controls.listenerCount()).toBe(0);

    harness.service.start();

    expect(harness.getModel).toHaveBeenCalledTimes(1);
    expect(harness.controls.listenerCount()).toBe(1);

    harness.service.dispose();
  });

  it('reuses the cached camera-relative offset until the camera changes', () => {
    const harness = createHarness();
    harness.service.start();

    harness.getModel.mockClear();
    harness.engine.transitionContinuum.mockClear();

    harness.service.setGazeTarget({ x: 0.2, y: 0, z: 0 });

    expect(harness.getModel).not.toHaveBeenCalled();

    harness.engine.transitionContinuum.mockClear();
    harness.camera.position.set(3, 1, 3);
    harness.controls.emitChange();

    expect(harness.getModel).toHaveBeenCalledTimes(1);
    expect(harness.engine.transitionContinuum).toHaveBeenCalled();

    const eyeYawCall = harness.engine.transitionContinuum.mock.calls.find(
      ([negAu, posAu]) => negAu === 61 && posAu === 62
    );

    expect(eyeYawCall?.[2]).toBeGreaterThan(0.1);

    harness.service.dispose();
  });

  it('ignores camera change events when tracking is fully disabled', () => {
    const harness = createHarness({
      eyeTrackingEnabled: false,
      headTrackingEnabled: false,
    });
    harness.service.start();

    expect(harness.controls.listenerCount()).toBe(0);
    harness.getModel.mockClear();
    harness.engine.transitionContinuum.mockClear();

    harness.camera.position.set(3, 1, 3);
    harness.controls.emitChange();

    expect(harness.getModel).not.toHaveBeenCalled();
    expect(harness.engine.transitionContinuum).not.toHaveBeenCalled();

    harness.service.dispose();
  });

  it('applies the shared camera-relative offset in experimental gaze mode', () => {
    const harness = createHarness({
      gazeMode: 'experimental',
    });
    harness.service.start();

    harness.engine.transitionContinuum.mockClear();
    harness.service.setGazeTarget({ x: 0, y: 0, z: 0 });

    expect(harness.engine.transitionContinuum).not.toHaveBeenCalled();

    harness.camera.position.set(3, 1, 3);
    harness.controls.emitChange();

    const eyeYawCall = harness.engine.transitionContinuum.mock.calls.find(
      ([negAu, posAu]) => negAu === 61 && posAu === 62
    );

    expect(eyeYawCall?.[2]).toBeGreaterThan(0.05);

    harness.service.dispose();
  });

  it('preserves the production experimental direct-engine runtime when an animation agency is present', () => {
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
    });
    const target = { x: 0.35, y: 0.1, z: 0 };
    const distance = Math.hypot(target.x, target.y);
    const alpha = Math.min(0.7, 0.25 + distance * 0.25);

    harness.service.setGazeTarget(target);

    expect(animationAgency.schedule).not.toHaveBeenCalled();
    const eyeYawCall = harness.engine.transitionContinuum.mock.calls.find(
      ([negAu, posAu]) => negAu === 61 && posAu === 62
    );
    const headYawCall = harness.engine.transitionContinuum.mock.calls.find(
      ([negAu, posAu]) => negAu === 51 && posAu === 52
    );

    expect(eyeYawCall?.[2]).toBeCloseTo(target.x * alpha * 1.2);
    expect(headYawCall?.[2]).toBeCloseTo(target.x * alpha * 0.8);

    harness.service.dispose();
  });

  it('clears active head output when head tracking is disabled', () => {
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
    });

    harness.service.setGazeTarget({ x: 0.35, y: 0.1, z: 0 });
    harness.engine.transitionContinuum.mockClear();
    animationAgency.remove.mockClear();

    harness.service.updateConfig({ headTrackingEnabled: false });

    expect(harness.engine.transitionContinuum).toHaveBeenCalledWith(51, 52, 0, 800);
    expect(harness.engine.transitionContinuum).toHaveBeenCalledWith(54, 53, 0, 800);
    expect(harness.engine.transitionContinuum).toHaveBeenCalledWith(55, 56, 0, 800);
    expect(harness.engine.transitionContinuum).not.toHaveBeenCalledWith(61, 62, 0, expect.any(Number));
    expect(animationAgency.remove).toHaveBeenCalledWith('eyeHeadTracking/headYaw');
    expect(animationAgency.remove).toHaveBeenCalledWith('eyeHeadTracking/headPitch');
    expect(animationAgency.remove).toHaveBeenCalledWith('eyeHeadTracking/headRoll');
    expect(animationAgency.remove).not.toHaveBeenCalledWith('eyeHeadTracking/eyeYaw');

    harness.engine.transitionContinuum.mockClear();
    harness.service.setGazeTarget({ x: 0.2, y: 0.05, z: 0 });

    expect(
      harness.engine.transitionContinuum.mock.calls.some(([negAu, posAu]) => negAu === 61 && posAu === 62)
    ).toBe(true);
    expect(
      harness.engine.transitionContinuum.mock.calls.some(([negAu, posAu]) => negAu === 51 && posAu === 52)
    ).toBe(false);

    harness.service.dispose();
  });

  it('refreshes the camera-relative offset when head tracking is enabled after eye-only tracking', () => {
    const harness = createHarness({
      eyeTrackingEnabled: true,
      headTrackingEnabled: false,
    });

    harness.service.start();
    harness.getModel.mockClear();
    harness.engine.transitionContinuum.mockClear();
    harness.camera.position.set(3, 1, 3);

    harness.service.updateConfig({ headTrackingEnabled: true });

    expect(harness.getModel).toHaveBeenCalledTimes(1);
    expect(
      harness.engine.transitionContinuum.mock.calls.some(([negAu, posAu]) => negAu === 51 && posAu === 52)
    ).toBe(true);

    harness.service.dispose();
  });
});
