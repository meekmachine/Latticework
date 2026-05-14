import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

class FakeWindow {
  innerWidth = 800;
  innerHeight = 600;
  private listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function stubBrowserWindow(): void {
  vi.stubGlobal('window', new FakeWindow());
}

function createHarness(config: {
  eyeTrackingEnabled?: boolean;
  headTrackingEnabled?: boolean;
  gazeMode?: 'engine' | 'legacy' | 'experimental';
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

describe('EyeHeadTrackingService camera-relative gaze', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not compute the camera-relative offset when started in manual mode', () => {
    const harness = createHarness();

    expect(harness.getModel).not.toHaveBeenCalled();
    expect(harness.controls.listenerCount()).toBe(0);

    harness.service.start();

    expect(harness.getModel).not.toHaveBeenCalled();
    expect(harness.controls.listenerCount()).toBe(0);

    harness.service.dispose();
  });

  it('waits until live tracking starts before computing the camera-relative offset', () => {
    stubBrowserWindow();
    const harness = createHarness();

    expect(harness.getModel).not.toHaveBeenCalled();
    expect(harness.controls.listenerCount()).toBe(0);

    harness.service.setMode('mouse');
    harness.service.start();

    expect(harness.getModel).toHaveBeenCalledTimes(1);
    expect(harness.controls.listenerCount()).toBe(1);

    harness.service.dispose();
  });

  it('reuses the cached camera-relative offset until the camera changes', () => {
    stubBrowserWindow();
    const harness = createHarness();
    harness.service.setMode('mouse');
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

  it('unsubscribes from camera changes when switching back to manual mode', () => {
    stubBrowserWindow();
    const harness = createHarness();
    harness.service.setMode('mouse');
    harness.service.start();

    expect(harness.controls.listenerCount()).toBe(1);

    harness.service.setMode('manual');

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
    stubBrowserWindow();
    const harness = createHarness({
      gazeMode: 'experimental',
    });
    harness.service.setMode('mouse');
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
});
