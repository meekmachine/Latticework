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
  animationAgency?: any;
  agencyTransitionDuration?: number;
  returnToNeutralEnabled?: boolean;
  returnToNeutralDelay?: number;
  returnToNeutralDuration?: number;
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
    agencyTransitionDuration: config.agencyTransitionDuration,
    returnToNeutralEnabled: config.returnToNeutralEnabled,
    returnToNeutralDelay: config.returnToNeutralDelay,
    returnToNeutralDuration: config.returnToNeutralDuration,
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
    schedule: vi.fn((snippet: any) => snippet.name),
    updateSnippet: vi.fn((snippet: any) => snippet.name),
    setSnippetTime: vi.fn(),
    setSnippetPlaybackRate: vi.fn(),
    setSnippetIntensityScale: vi.fn(),
    setSnippetReverse: vi.fn(),
    seek: vi.fn(),
    pauseSnippet: vi.fn(),
    resumeSnippet: vi.fn(),
    restartSnippet: vi.fn(),
    remove: vi.fn(),
    onSnippetEnd: vi.fn(),
  };
}

function clearAnimationAgencyMocks(animationAgency: ReturnType<typeof createAnimationAgency>) {
  for (const value of Object.values(animationAgency)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear();
    }
  }
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

  it('routes experimental gaze output through the animation scheduler when an animation agency is present', () => {
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
    });
    const target = { x: 0.35, y: 0.1, z: 0 };

    harness.service.setGazeTarget(target);

    expect(harness.engine.transitionContinuum).not.toHaveBeenCalled();
    expect(animationAgency.schedule).toHaveBeenCalled();

    const scheduledSnippets = animationAgency.schedule.mock.calls.map(([snippet]) => snippet);
    const eyeYawSnippet = scheduledSnippets.find(
      (snippet) => snippet.name === 'eyeHeadTracking/eyeYaw'
    );
    const headYawSnippet = scheduledSnippets.find(
      (snippet) => snippet.name === 'eyeHeadTracking/headYaw'
    );

    expect(eyeYawSnippet?.maxTime).toBe(1);
    expect(eyeYawSnippet?.currentTime).toBe(0.5);
    expect(eyeYawSnippet?.curves['61']).toEqual([
      { time: 0, intensity: 1 },
      { time: 0.5, intensity: 0 },
      { time: 1, intensity: 0 },
    ]);
    expect(eyeYawSnippet?.curves['62']).toEqual([
      { time: 0, intensity: 0 },
      { time: 0.5, intensity: 0 },
      { time: 1, intensity: 1 },
    ]);
    expect(headYawSnippet?.maxTime).toBe(1);
    expect(animationAgency.setSnippetIntensityScale).toHaveBeenCalledWith('eyeHeadTracking/eyeYaw', 1.2);
    expect(animationAgency.setSnippetIntensityScale).toHaveBeenCalledWith('eyeHeadTracking/headYaw', 0.8);
    expect(animationAgency.setSnippetReverse).toHaveBeenCalledWith('eyeHeadTracking/eyeYaw', false);
    expect(animationAgency.setSnippetReverse).toHaveBeenCalledWith('eyeHeadTracking/headYaw', false);
    expect(animationAgency.setSnippetPlaybackRate).toHaveBeenCalledWith(
      'eyeHeadTracking/eyeYaw',
      expect.any(Number)
    );

    harness.service.dispose();
  });

  it('uses agency transition duration to plan scheduled gaze smoothness', () => {
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
      agencyTransitionDuration: 700,
    });

    harness.service.setGazeTarget({ x: 0.5, y: 0, z: 0 });

    const scheduledSnippets = animationAgency.schedule.mock.calls.map(([snippet]) => snippet);
    const eyeYawSnippet = scheduledSnippets.find(
      (snippet) => snippet.name === 'eyeHeadTracking/eyeYaw'
    );
    const headYawSnippet = scheduledSnippets.find(
      (snippet) => snippet.name === 'eyeHeadTracking/headYaw'
    );

    expect(eyeYawSnippet?.maxTime).toBe(1);
    expect(headYawSnippet?.maxTime).toBe(1);

    const eyeYawRate = animationAgency.setSnippetPlaybackRate.mock.calls.find(
      ([name]) => name === 'eyeHeadTracking/eyeYaw'
    )?.[1];
    const headYawRate = animationAgency.setSnippetPlaybackRate.mock.calls.find(
      ([name]) => name === 'eyeHeadTracking/headYaw'
    )?.[1];

    expect(eyeYawRate).toBeGreaterThan(0);
    expect(headYawRate).toBeGreaterThan(0);
    expect(headYawRate).toBeLessThan(eyeYawRate ?? 0);

    harness.service.dispose();
  });

  it('schedules return to neutral when the feature is enabled after a gaze target is active', () => {
    vi.useFakeTimers();
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
      returnToNeutralDelay: 100,
      returnToNeutralDuration: 700,
    });

    try {
      harness.service.setGazeTarget({ x: 0.35, y: 0.1, z: 0 });
      clearAnimationAgencyMocks(animationAgency);

      harness.service.updateConfig({ returnToNeutralEnabled: true });
      vi.advanceTimersByTime(99);
      expect(animationAgency.schedule).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);

      expect(animationAgency.schedule).not.toHaveBeenCalled();
      expect(animationAgency.setSnippetPlaybackRate).toHaveBeenCalledWith(
        'eyeHeadTracking/eyeYaw',
        expect.any(Number)
      );
      expect(animationAgency.setSnippetPlaybackRate).toHaveBeenCalledWith(
        'eyeHeadTracking/headYaw',
        expect.any(Number)
      );

      vi.advanceTimersByTime(700);

      expect(animationAgency.setSnippetTime).toHaveBeenCalledWith('eyeHeadTracking/eyeYaw', 0.5);
      expect(animationAgency.setSnippetTime).toHaveBeenCalledWith('eyeHeadTracking/headYaw', 0.5);
      expect(harness.service.getState().targetGaze).toEqual({ x: 0, y: 0, z: 0 });
    } finally {
      harness.service.dispose();
      vi.useRealTimers();
    }
  });

  it('auto-returns after quiet tracking input outside manual mode', () => {
    vi.useFakeTimers();
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
      returnToNeutralEnabled: true,
      returnToNeutralDelay: 100,
      returnToNeutralDuration: 500,
    });

    try {
      (harness.service as any).trackingMode = 'mouse';
      harness.service.setGazeTarget({ x: 0.35, y: 0.1, z: 0 });
      clearAnimationAgencyMocks(animationAgency);

      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(500);

      expect(animationAgency.schedule).not.toHaveBeenCalled();
      expect(animationAgency.setSnippetTime).toHaveBeenCalledWith('eyeHeadTracking/eyeYaw', 0.5);
      expect(animationAgency.setSnippetTime).toHaveBeenCalledWith('eyeHeadTracking/headYaw', 0.5);
    } finally {
      harness.service.dispose();
      vi.useRealTimers();
    }
  });

  it('clears active head output when head tracking is disabled', () => {
    const animationAgency = createAnimationAgency();
    const harness = createHarness({
      gazeMode: 'experimental',
      animationAgency,
    });

    harness.service.setGazeTarget({ x: 0.35, y: 0.1, z: 0 });
    harness.engine.transitionContinuum.mockClear();
    clearAnimationAgencyMocks(animationAgency);

    harness.service.updateConfig({ headTrackingEnabled: false });

    expect(harness.engine.transitionContinuum).not.toHaveBeenCalled();
    expect(animationAgency.remove).toHaveBeenCalledWith('eyeHeadTracking/headYaw');
    expect(animationAgency.remove).toHaveBeenCalledWith('eyeHeadTracking/headPitch');
    expect(animationAgency.remove).toHaveBeenCalledWith('eyeHeadTracking/headRoll');
    expect(animationAgency.remove).not.toHaveBeenCalledWith('eyeHeadTracking/eyeYaw');
    const resetNames = animationAgency.schedule.mock.calls.map(([snippet]) => snippet.name);
    expect(resetNames).toEqual(expect.arrayContaining([
      'eyeHeadTracking/headYaw',
      'eyeHeadTracking/headPitch',
      'eyeHeadTracking/headRoll',
    ]));
    expect(resetNames).not.toContain('eyeHeadTracking/eyeYaw');

    harness.engine.transitionContinuum.mockClear();
    clearAnimationAgencyMocks(animationAgency);
    harness.service.setGazeTarget({ x: 0.2, y: 0.05, z: 0 });
    const trackingNames = animationAgency.schedule.mock.calls.map(([snippet]) => snippet.name);

    expect(harness.engine.transitionContinuum).not.toHaveBeenCalled();
    expect(trackingNames).toEqual([]);
    expect(animationAgency.setSnippetPlaybackRate).toHaveBeenCalledWith(
      'eyeHeadTracking/eyeYaw',
      expect.any(Number)
    );
    expect(animationAgency.setSnippetPlaybackRate.mock.calls.some(
      ([name]) => name === 'eyeHeadTracking/headYaw'
    )).toBe(false);
    expect(trackingNames).not.toContain('eyeHeadTracking/headYaw');

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
