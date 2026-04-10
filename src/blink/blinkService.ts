/**
 * Blink Service
 * Provides automatic and manual blinking functionality
 * Follows the Animation Agency architecture pattern
 *
 * Uses Most.js state store for reactive state management
 */

import { BlinkStateStore } from './state';
import { BlinkScheduler } from './blinkScheduler';
import type { BlinkState } from './types';

export interface BlinkServiceAPI {
  enable: () => void;
  disable: () => void;
  triggerBlink: (intensity?: number, duration?: number) => void;
  setFrequency: (frequency: number) => void;
  setDuration: (duration: number) => void;
  setIntensity: (intensity: number) => void;
  setRandomness: (randomness: number) => void;
  setLeftEyeIntensity: (intensity: number | null) => void;
  setRightEyeIntensity: (intensity: number | null) => void;
  reset: () => void;
  getState: () => BlinkState;
  subscribe: (callback: (state: BlinkState) => void) => () => void;
  dispose: () => void;
}

export interface BlinkHostCaps {
  scheduleSnippet: (snippet: any, opts?: { autoPlay?: boolean }) => string | null;
  removeSnippet: (name: string) => void;
}

/**
 * Create a Blink Service with Most.js state store and scheduler
 */
export function createBlinkService(
  hostCaps?: BlinkHostCaps
): BlinkServiceAPI {
  const store = new BlinkStateStore();

  // Host capabilities (animation service integration)
  const host: BlinkHostCaps = hostCaps ?? {
    scheduleSnippet: (snippet: any, opts?: { autoPlay?: boolean }) => {
      // Fallback: Try to use global animation service
      if (typeof window !== 'undefined') {
        const anim = (window as any).anim;
        if (anim && typeof anim.schedule === 'function') {
          return anim.schedule(snippet, opts);
        }
      }
      console.warn('[BlinkService] No animation service available for scheduling');
      return null;
    },
    removeSnippet: (name: string) => {
      if (typeof window !== 'undefined') {
        const anim = (window as any).anim;
        if (anim && typeof anim.remove === 'function') {
          anim.remove(name);
        }
      }
    },
  };

  // Create scheduler
  const state = store.snapshot;

  const scheduler = new BlinkScheduler(
    store,
    host,
    {
      duration: state.duration,
      intensity: state.intensity,
      leftEyeIntensity: state.leftEyeIntensity,
      rightEyeIntensity: state.rightEyeIntensity,
      randomness: state.randomness,
    }
  );

  // Subscribers for state changes
  const subscribers = new Set<(state: BlinkState) => void>();

  // Subscribe to state store changes
  let disposed = false;
  const unsubscribeStore = store.subscribe((newState: BlinkState) => {
    if (disposed) return;

    // Update scheduler config
    scheduler.updateConfig({
      duration: newState.duration,
      intensity: newState.intensity,
      leftEyeIntensity: newState.leftEyeIntensity,
      rightEyeIntensity: newState.rightEyeIntensity,
      randomness: newState.randomness,
    });

    // Update automatic blinking based on enabled state
    if (newState.enabled) {
      scheduler.start(newState.frequency);
    } else {
      scheduler.stop();
    }

    // Notify subscribers
    subscribers.forEach((callback) => callback(newState));
  });

  // Start automatic blinking if enabled by default
  if (state.enabled) {
    scheduler.start(state.frequency);
  }

  // Public API
  return {
    enable(): void {
      store.enable();
    },

    disable(): void {
      store.disable();
    },

    triggerBlink(intensity?: number, duration?: number): void {
      scheduler.triggerBlink(intensity, duration);
    },

    setFrequency(frequency: number): void {
      store.setFrequency(frequency);
    },

    setDuration(duration: number): void {
      store.setDuration(duration);
    },

    setIntensity(intensity: number): void {
      store.setIntensity(intensity);
    },

    setRandomness(randomness: number): void {
      store.setRandomness(randomness);
    },

    setLeftEyeIntensity(intensity: number | null): void {
      store.setLeftEyeIntensity(intensity);
    },

    setRightEyeIntensity(intensity: number | null): void {
      store.setRightEyeIntensity(intensity);
    },

    reset(): void {
      store.resetToDefault();
    },

    getState(): BlinkState {
      return store.snapshot;
    },

    subscribe(callback: (state: BlinkState) => void): () => void {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    dispose(): void {
      disposed = true;
      scheduler.dispose();
      subscribers.clear();
      unsubscribeStore();
      store.dispose();
    },
  };
}

// For class-based usage
export class BlinkService {
  private api: BlinkServiceAPI;

  constructor(hostCaps?: BlinkHostCaps) {
    this.api = createBlinkService(hostCaps);
  }

  public enable(): void {
    this.api.enable();
  }

  public disable(): void {
    this.api.disable();
  }

  public triggerBlink(intensity?: number, duration?: number): void {
    this.api.triggerBlink(intensity, duration);
  }

  public setFrequency(frequency: number): void {
    this.api.setFrequency(frequency);
  }

  public setDuration(duration: number): void {
    this.api.setDuration(duration);
  }

  public setIntensity(intensity: number): void {
    this.api.setIntensity(intensity);
  }

  public setRandomness(randomness: number): void {
    this.api.setRandomness(randomness);
  }

  public setLeftEyeIntensity(intensity: number | null): void {
    this.api.setLeftEyeIntensity(intensity);
  }

  public setRightEyeIntensity(intensity: number | null): void {
    this.api.setRightEyeIntensity(intensity);
  }

  public reset(): void {
    this.api.reset();
  }

  public getState(): BlinkState {
    return this.api.getState();
  }

  public subscribe(callback: (state: BlinkState) => void): () => void {
    return this.api.subscribe(callback);
  }

  public dispose(): void {
    this.api.dispose();
  }
}
