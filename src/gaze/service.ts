import type { GazeConfig, GazeTarget, GazeMode } from './types';
import { GazeStateStore } from './state';
import { NoopTransport, type GazeTransport } from './transport';

/**
 * Experimental gaze service.
 * Engine-first; can route targets through a transport when enabled.
 * Uses simple smoothing to avoid snaps. This is intentionally minimal;
 * you can layer GOAP/planning logic on top later.
 */
export class GazeService {
  private config: GazeConfig;
  private store = new GazeStateStore();
  private transport: GazeTransport;
  private lastTarget: GazeTarget = { x: 0, y: 0, z: 0 };

  constructor(config?: Partial<GazeConfig>, transport?: GazeTransport) {
    this.config = {
      eyesEnabled: true,
      headEnabled: true,
      headFollowEyes: true,
      mirrored: false,
      smoothFactor: 0.25,
      minDelta: 0.01,
      eyeIntensity: 1.0,
      headIntensity: 0.5,
      useTransport: false,
      ...config,
    };
    this.transport = transport || new NoopTransport();
  }

  get state$() {
    return this.store.state$;
  }

  updateConfig(config: Partial<GazeConfig>) {
    this.config = { ...this.config, ...config };
  }

  setMode(mode: GazeMode) {
    this.store.setMode(mode);
  }

  /**
   * Set a new gaze target. Applies smoothing and forwards to engine or transport.
   */
  setTarget(target: GazeTarget) {
    const smoothed = this.smoothTarget(target);
    if (!this.shouldApply(smoothed)) {
      this.store.setTarget(smoothed);
      return;
    }

    const applied = this.apply(smoothed);
    if (applied) {
      this.store.setTarget(smoothed);
      this.lastTarget = smoothed;
    }
  }

  dispose() {
    this.store.dispose();
    this.transport.dispose();
  }

  private smoothTarget(target: GazeTarget): GazeTarget {
    const prev = this.lastTarget;
    const tx = this.config.mirrored ? -target.x : target.x;
    const ty = target.y;

    // Adaptive alpha: larger movements get faster response, small movements get more smoothing
    const distance = Math.hypot(tx - prev.x, ty - prev.y);
    const baseAlpha = this.config.smoothFactor ?? 0.2;
    const alpha = Math.min(0.7, baseAlpha + distance * 0.25);

    return {
      x: prev.x + (tx - prev.x) * alpha,
      y: prev.y + (ty - prev.y) * alpha,
      z: target.z ?? 0,
    };
  }

  private shouldApply(target: GazeTarget): boolean {
    const minDelta = this.config.minDelta ?? 0.003;
    const dx = target.x - this.lastTarget.x;
    const dy = target.y - this.lastTarget.y;
    return Math.hypot(dx, dy) >= minDelta;
  }

  private apply(target: GazeTarget): boolean {
    if (this.config.useTransport) {
      void this.transport.sendTarget(target);
      return true;
    }

    const engine = this.config.engine;
    if (!engine) return false;

    const eyes = this.config.eyesEnabled !== false;
    const head = this.config.headEnabled !== false && this.config.headFollowEyes !== false;
    const eyeIntensity = this.config.eyeIntensity ?? 1.0;
    const headIntensity = this.config.headIntensity ?? 0.5;

    // Distance-based duration scaling: small moves are quick, large moves take longer
    const distance = Math.hypot(target.x - this.lastTarget.x, target.y - this.lastTarget.y);
    const eyeDuration = Math.round(120 + distance * 300);   // 120-420ms
    const headDuration = Math.round(180 + distance * 400);  // 180-580ms

    if (eyes) {
      // Use continuum pairs: 61/62 yaw, 64/63 pitch
      const eyeYaw = target.x * eyeIntensity;
      const eyePitch = target.y * eyeIntensity;
      engine.transitionContinuum?.(61, 62, eyeYaw, eyeDuration);
      engine.transitionContinuum?.(64, 63, eyePitch, eyeDuration);
    }

    if (head) {
      // Head follows with configured intensity and slightly longer duration for natural lag
      const headYaw = target.x * headIntensity;
      const headPitch = target.y * headIntensity;
      engine.transitionContinuum?.(51, 52, headYaw, headDuration);
      engine.transitionContinuum?.(54, 53, headPitch, headDuration);
    }

    return true;
  }
}
