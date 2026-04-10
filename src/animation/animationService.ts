import { Subject, Observable } from 'rxjs';
import { filter, map, distinctUntilChanged, throttleTime, shareReplay } from 'rxjs/operators';
import type { Engine, ScheduleOpts, NormalizedSnippet, BakedAnimationEngine, EasingType, MixerLoopMode } from './types';
import { AnimationRuntime, type AnimationRuntimeEvents } from './animationRuntime';
import type {
  AnimationEvent,
  SnippetUIState,
  KeyframeCompletedEvent,
  GlobalPlaybackChangedEvent,
  BakedClipInfo,
  BakedAnimationUIState,
  BakedClipsLoadedEvent,
  BakedAnimationStartedEvent,
  BakedAnimationStoppedEvent,
  BakedAnimationProgressEvent,
} from './animationEvents';

/**
 * Animation Service
 *
 * This service wraps the animation runtime and exposes a stable API
 * for UI components and other services.
 */
export function createAnimationService(host: Engine) {
  const runtimeEvents: AnimationRuntimeEvents = {
    onSnippetCompleted: (name) => animationEventEmitter.emitSnippetCompleted(name),
    onPlayStateChanged: (name, isPlaying) => animationEventEmitter.emitPlayStateChanged(name, isPlaying),
    onKeyframeCompleted: (data) => animationEventEmitter.emitKeyframeCompleted(data),
  };

  // Always use the new runtime (no legacy fallback).
  const scheduler = new AnimationRuntime(host, runtimeEvents);

  // Wire up RxJS event emitter with snippet accessor
  animationEventEmitter.setSnippetAccessor(() => scheduler.getSnippets() as NormalizedSnippet[]);

  let disposed = false;

  // Baked animation engine state (closure variables)
  let bakedEngine: BakedAnimationEngine | null = null;
  let bakedProgressInterval: ReturnType<typeof setInterval> | null = null;

  const getBakedClipInfo = (clipName: string): BakedClipInfo => {
    const clip = animationEventEmitter.getBakedClips().find((entry) => entry.name === clipName);
    if (clip) return clip;
    const existing = animationEventEmitter.getBakedAnimationState(clipName);
    return {
      name: clipName,
      duration: existing?.duration ?? 0,
    };
  };

  const mergeBakedState = (
    clipName: string,
    patch?: Partial<BakedAnimationUIState> | null
  ): BakedAnimationUIState => {
    const clip = getBakedClipInfo(clipName);
    const current = animationEventEmitter.getBakedAnimationState(clipName);
    return toBakedUIState(clip, {
      ...current,
      ...patch,
    });
  };

  const resolveBakedPlayhead = (state: BakedAnimationUIState): number | undefined => {
    const time = Number.isFinite(state.currentTime) ? state.currentTime : 0;
    const duration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
    const epsilon = 0.001;
    const atStart = time <= epsilon;
    const atEnd = duration > 0 && time >= duration - epsilon;

    if (state.isPaused) {
      return Math.max(0, Math.min(duration, time));
    }

    if (atStart || atEnd) {
      return undefined;
    }

    return Math.max(0, Math.min(duration, time));
  };

  const startBakedAnimationFromState = (
    clipName: string,
    state: BakedAnimationUIState,
    timeOverride?: number,
    pauseAfterStart = false
  ) => {
    if (!bakedEngine) return null;
    const handle = bakedEngine.playAnimation?.(clipName, toBakedPlayOptions(state));
    if (!handle) {
      return null;
    }

    const nextState = toBakedUIState(getBakedClipInfo(clipName), {
      ...state,
      ...handle.getState(),
      source: 'baked',
    });
    animationEventEmitter.emitBakedAnimationStarted(clipName, nextState);

    const seekTime = Math.max(0, Number.isFinite(timeOverride) ? timeOverride ?? 0 : 0);
    if (seekTime > 0) {
      bakedEngine.seekAnimation?.(clipName, seekTime);
      animationEventEmitter.emitBakedAnimationProgress(clipName, seekTime, nextState.duration);
    }

    if (pauseAfterStart) {
      bakedEngine.pauseAnimation?.(clipName);
      animationEventEmitter.emitBakedAnimationPaused(clipName);
    }

    handle.finished.then(() => {
      animationEventEmitter.emitBakedAnimationCompleted(clipName);
    }).catch(() => {
      // Animation may be restarted/stopped before completion.
    });

    return handle;
  };

  const api = {
    // --- Core API (delegated to Scheduler) ---
    loadFromJSON(data: any) {
      const name = scheduler.loadFromJSON(data);
      if (name) animationEventEmitter.emitSnippetAdded(name);
      return name;
    },

    updateSnippet(data: any) {
      const name = scheduler.loadFromJSON(data);
      if (name && scheduler.isPlaying()) {
        scheduler.restartSnippet(name);
      }
      return name;
    },

    schedule(data: any, opts?: ScheduleOpts) {
      const name = scheduler.schedule(data, opts);
      if (name) animationEventEmitter.emitSnippetAdded(name);
      return name;
    },

    remove(name: string) {
      scheduler.remove(name);
      animationEventEmitter.emitSnippetRemoved(name);
    },

    play() {
      scheduler.play();
      animationEventEmitter.emitGlobalPlaybackChanged('playing');
    },

    pause() {
      scheduler.pause();
      animationEventEmitter.emitGlobalPlaybackChanged('paused');
    },

    stop() {
      scheduler.stop();
      animationEventEmitter.emitGlobalPlaybackChanged('stopped');
    },

    enable(name: string, on = true) {
      return scheduler.enable(name, on);
    },

    seek(name: string, offsetSec: number) {
      return scheduler.seek(name, offsetSec);
    },

    // --- State access ---
    getState() {
      return { context: { animations: scheduler.getSnippets() as NormalizedSnippet[] } };
    },

    getScheduleSnapshot() {
      return scheduler.getScheduleSnapshot();
    },

    getCurrentValue(auId: string): number {
      return scheduler.getCurrentValue(auId);
    },

    get playing() {
      return scheduler.isPlaying();
    },

    isPlaying() {
      return scheduler.isPlaying();
    },

    // --- LocalStorage loading ---
    loadFromLocal(key: string, cat = 'default', prio = 0) {
      const str = localStorage.getItem(key);
      if (!str) return null;
      try {
        const obj = JSON.parse(str);
        if (!obj.name) {
          const parts = key.split('/');
          obj.name = parts[parts.length - 1];
        }
        return api.schedule(obj, { priority: prio });
      } catch (e) {
        console.error('[animationService] bad JSON from localStorage', e);
        return null;
      }
    },

    // --- Per-snippet controls ---
    setSnippetPlaybackRate(name: string, rate: number) {
      const sn = getSnippet(name);
      if (!sn) return;

      const newRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
      const oldRate = sn.snippetPlaybackRate ?? 1;

      if (Math.abs(newRate - oldRate) > 0.001) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const currentLocal = ((now - (sn.startWallTime || now)) / 1000) * oldRate;
        sn.startWallTime = now - (currentLocal / newRate) * 1000;
      }
      sn.snippetPlaybackRate = newRate;
      animationEventEmitter.emitParamsChanged(name, { playbackRate: newRate });

      // Update mixer action directly (no reschedule)
      scheduler.updateSnippetParams(name, { rate: newRate });
      host.updateClipParams?.(name, { rate: newRate, reverse: !!sn.mixerReverse });
    },

    setSnippetIntensityScale(name: string, scale: number) {
      const sn = getSnippet(name);
      if (sn) {
        const newScale = Math.max(0, Number.isFinite(scale) ? scale : 1);
        sn.snippetIntensityScale = newScale;
        animationEventEmitter.emitParamsChanged(name, { intensityScale: newScale });

         // Update mixer action directly (no reschedule)
         scheduler.updateSnippetParams(name, { weight: newScale });
         host.updateClipParams?.(name, { weight: newScale });
      }
    },

    setSnippetBlendMode(name: string, mode: 'replace' | 'additive') {
      const sn = getSnippet(name);
      if (!sn) return;
      const nextMode = mode === 'additive' ? 'additive' : 'replace';
      if (sn.snippetBlendMode !== nextMode) {
        sn.snippetBlendMode = nextMode;
        animationEventEmitter.emitParamsChanged(name, { blendMode: nextMode });
      }
    },

    setSnippetBalance(name: string, balance: number) {
      const sn = getSnippet(name);
      if (!sn) return;
      const nextBalance = Math.max(-1, Math.min(1, Number.isFinite(balance) ? balance : 0));
      if (Math.abs(sn.snippetBalance - nextBalance) > 0.001) {
        sn.snippetBalance = nextBalance;
        animationEventEmitter.emitParamsChanged(name, { balance: nextBalance });

        // Balance affects track construction, so rebuild active clip playback to apply it immediately.
        if (sn.isPlaying) {
          scheduler.restartSnippet(name);
        }
      }
    },

    setSnippetEasing(name: string, easing: import('./types').EasingType) {
      const sn = getSnippet(name);
      if (!sn) return;
      if (sn.snippetEasing !== easing) {
        sn.snippetEasing = easing;
        animationEventEmitter.emitParamsChanged(name, { easing });
      }
    },

    setSnippetPriority(name: string, priority: number) {
      const sn = getSnippet(name);
      if (sn) {
        sn.snippetPriority = Number.isFinite(priority) ? priority : 0;
      }
    },

    setSnippetLoopMode(name: string, mode: 'repeat' | 'once' | 'pingpong') {
      const sn = getSnippet(name);
      if (!sn) return;
      sn.mixerLoopMode = mode;
      sn.loop = mode !== 'once';
      animationEventEmitter.emitParamsChanged(name, { mixerLoopMode: mode, loop: sn.loop });
      scheduler.updateSnippetParams(name, { loopMode: mode, repeatCount: sn.mixerRepeatCount });
    },

    setSnippetRepeatCount(name: string, repeatCount?: number) {
      const sn = getSnippet(name);
      if (!sn) return;
      const next = typeof repeatCount === 'number' && repeatCount >= 0 ? repeatCount : undefined;
      sn.mixerRepeatCount = next;
      animationEventEmitter.emitParamsChanged(name, { repeatCount: next });
      scheduler.updateSnippetParams(name, { repeatCount: next });
      host.updateClipParams?.(name, { repeatCount: next });
    },

    setSnippetReverse(name: string, reverse: boolean) {
      const sn = getSnippet(name);
      if (!sn) return;
      sn.mixerReverse = !!reverse;
      animationEventEmitter.emitParamsChanged(name, { reverse: !!reverse });
      scheduler.updateSnippetParams(name, { reverse: !!reverse, rate: sn.snippetPlaybackRate });
    },

    setSnippetPlaying(name: string, playing: boolean) {
      const sn = getSnippet(name);
      if (!sn) return;
      sn.isPlaying = !!playing;

      if (playing) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const currentLocal = sn.currentTime || 0;
        const rate = sn.snippetPlaybackRate ?? 1;
        sn.startWallTime = now - (currentLocal / rate) * 1000;
        scheduler.resumeSnippet(name);
      } else {
        scheduler.pauseSnippet(name);
      }
      animationEventEmitter.emitPlayStateChanged(name, !!playing);
    },

    setSnippetTime(name: string, tSec: number) {
      const time = Math.max(0, tSec || 0);
      scheduler.seek(name, time);
      animationEventEmitter.emitSnippetSeeked(name, time);
    },

    setSnippetLoopState(name: string, iteration: number, localTime?: number) {
      const sn = getSnippet(name);
      if (!sn) return;
      sn.loopIteration = Math.max(0, iteration);
      if (typeof localTime === 'number') sn.lastLoopTime = localTime;
    },

    // --- Playback runner controls ---
    pauseSnippet(name: string) {
      return scheduler.pauseSnippet(name);
    },

    resumeSnippet(name: string) {
      return scheduler.resumeSnippet(name);
    },

    restartSnippet(name: string) {
      return scheduler.restartSnippet(name);
    },

    stopSnippet(name: string) {
      return scheduler.stopSnippet(name);
    },

    // --- Legacy subscription (for backwards compatibility) ---
    onTransition(cb: (snapshot: any) => void) {
      const sub = animationEventEmitter.events.subscribe(() => {
        cb(api.getState());
      });
      return () => sub.unsubscribe();
    },

    // --- Lifecycle ---
    dispose() {
      if (disposed) return;
      disposed = true;
      if (bakedProgressInterval) {
        clearInterval(bakedProgressInterval);
        bakedProgressInterval = null;
      }
      bakedEngine = null;
      animationEventEmitter.emitBakedClipsLoaded([]);
      try { scheduler.dispose(); } catch {}
      //
    },

    // --- Debug ---
    debug() {
      const anims = scheduler.getSnippets();
      anims.forEach((a: any, i: number) => {
        void a;
        void i;
      });
    },

    // --- Baked Animation Controls ---
    setBakedAnimationEngine(engine: BakedAnimationEngine) {
      bakedEngine = engine;
      const clips = engine.getAnimationClips?.() || [];
      animationEventEmitter.emitBakedClipsLoaded(clips.map(c => ({ name: c.name, duration: c.duration })));
      clips.forEach((clip) => {
        animationEventEmitter.updateBakedAnimationState(clip.name, mergeBakedState(clip.name));
      });
      const playing = engine.getPlayingAnimations?.() || [];
      playing.forEach((state) => {
        animationEventEmitter.updateBakedAnimationState(
          state.name,
          toBakedUIState(getBakedClipInfo(state.name), state as Partial<BakedAnimationUIState>)
        );
      });

      if (bakedProgressInterval) {
        clearInterval(bakedProgressInterval);
        bakedProgressInterval = null;
      }
    },

    playBakedAnimation(
      clipName: string,
      options?: Parameters<BakedAnimationEngine['playAnimation']>[1]
    ) {
      if (!bakedEngine) {
        return null;
      }
      const nextPatch: Partial<BakedAnimationUIState> = {
        isPlaying: true,
        isPaused: false,
      };
      if (typeof options?.loop === 'boolean') nextPatch.loop = options.loop;
      if (options?.loopMode) nextPatch.loopMode = options.loopMode;
      if (options?.repeatCount !== undefined) nextPatch.repeatCount = options.repeatCount;
      if (typeof options?.reverse === 'boolean') nextPatch.reverse = options.reverse;
      if (typeof options?.playbackRate === 'number' || typeof options?.speed === 'number') {
        const playbackRate = options?.playbackRate ?? options?.speed ?? 1;
        nextPatch.playbackRate = playbackRate;
        nextPatch.speed = playbackRate;
      }
      if (typeof options?.weight === 'number' || typeof options?.intensity === 'number') {
        const intensityScale = options?.weight ?? options?.intensity ?? 1;
        nextPatch.intensityScale = intensityScale;
        nextPatch.weight = intensityScale;
      }
      if (options?.blendMode) nextPatch.blendMode = options.blendMode;
      if (typeof options?.balance === 'number') nextPatch.balance = options.balance;
      if (options?.easing) nextPatch.easing = options.easing;
      const nextState = mergeBakedState(clipName, {
        ...nextPatch,
      });
      return startBakedAnimationFromState(clipName, nextState, resolveBakedPlayhead(nextState));
    },

    stopBakedAnimation(clipName: string) {
      bakedEngine?.stopAnimation?.(clipName);
      animationEventEmitter.emitBakedAnimationStopped(clipName);
    },

    pauseBakedAnimation(clipName: string) {
      bakedEngine?.pauseAnimation?.(clipName);
      animationEventEmitter.emitBakedAnimationPaused(clipName);
    },

    resumeBakedAnimation(clipName: string) {
      bakedEngine?.resumeAnimation?.(clipName);
      animationEventEmitter.emitBakedAnimationResumed(clipName);
    },

    setBakedAnimationSpeed(clipName: string, speed: number) {
      const nextRate = Number.isFinite(speed) ? Math.max(0.1, speed) : 1;
      bakedEngine?.setAnimationSpeed?.(clipName, nextRate);
      animationEventEmitter.updateBakedAnimationState(clipName, mergeBakedState(clipName, {
        speed: nextRate,
        playbackRate: nextRate,
      }));
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, {
        speed: nextRate,
        playbackRate: nextRate,
      });
    },

    setBakedAnimationWeight(clipName: string, weight: number) {
      const nextWeight = Math.max(0, Number.isFinite(weight) ? weight : 1);
      bakedEngine?.setAnimationIntensity?.(clipName, nextWeight);
      animationEventEmitter.updateBakedAnimationState(clipName, mergeBakedState(clipName, {
        weight: nextWeight,
        intensityScale: nextWeight,
      }));
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, {
        weight: nextWeight,
        intensityScale: nextWeight,
      });
    },

    setBakedAnimationLoop(clipName: string, loop: boolean) {
      const existing = mergeBakedState(clipName);
      const nextLoopMode = loop
        ? (existing.loopMode === 'once' ? 'repeat' : existing.loopMode)
        : 'once';
      const nextState = mergeBakedState(clipName, {
        loop,
        loopMode: nextLoopMode,
      });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, {
        loop,
        loopMode: nextLoopMode,
      });
      bakedEngine?.setAnimationLoopMode?.(clipName, nextLoopMode);
    },

    setBakedAnimationLoopMode(clipName: string, mode: 'repeat' | 'once' | 'pingpong') {
      const nextState = mergeBakedState(clipName, {
        loop: mode !== 'once',
        loopMode: mode,
      });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, {
        loop: mode !== 'once',
        loopMode: mode,
      });
      bakedEngine?.setAnimationLoopMode?.(clipName, mode);
    },

    setBakedAnimationRepeatCount(clipName: string, repeatCount?: number) {
      const nextRepeatCount = typeof repeatCount === 'number' && repeatCount >= 0
        ? Math.floor(repeatCount)
        : undefined;
      const nextState = mergeBakedState(clipName, { repeatCount: nextRepeatCount });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, { repeatCount: nextRepeatCount });
      bakedEngine?.setAnimationRepeatCount?.(clipName, nextRepeatCount);
    },

    setBakedAnimationReverse(clipName: string, reverse: boolean) {
      const nextState = mergeBakedState(clipName, { reverse: !!reverse });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, { reverse: !!reverse });
      bakedEngine?.setAnimationReverse?.(clipName, !!reverse);
    },

    setBakedAnimationBlendMode(clipName: string, mode: 'replace' | 'additive') {
      const nextState = mergeBakedState(clipName, { blendMode: mode });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, { blendMode: mode });
      bakedEngine?.setAnimationBlendMode?.(clipName, mode);
    },

    setBakedAnimationBalance(clipName: string, balance: number) {
      const nextBalance = Math.max(-1, Math.min(1, Number.isFinite(balance) ? balance : 0));
      const nextState = mergeBakedState(clipName, { balance: nextBalance });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, { balance: nextBalance });
    },

    setBakedAnimationEasing(clipName: string, easing: EasingType) {
      const nextState = mergeBakedState(clipName, { easing });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, { easing });
    },

    seekBakedAnimation(clipName: string, time: number) {
      if (!bakedEngine) return false;
      const engineAny = bakedEngine as any;
      const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
      if (typeof engineAny.seekAnimation === 'function') {
        engineAny.seekAnimation(clipName, safeTime);
      } else if (typeof engineAny.setAnimationTime === 'function') {
        engineAny.setAnimationTime(clipName, safeTime);
      } else if (typeof engineAny.setTime === 'function') {
        engineAny.setTime(clipName, safeTime);
      } else {
        return false;
      }
      const existing = mergeBakedState(clipName, { time: safeTime, currentTime: safeTime });
      animationEventEmitter.updateBakedAnimationState(clipName, existing);
      if (existing) {
        animationEventEmitter.emitBakedAnimationProgress(clipName, safeTime, existing.duration);
      }
      return true;
    },

    canSeekBakedAnimation() {
      const engineAny = bakedEngine as any;
      return !!engineAny?.seekAnimation || !!engineAny?.setAnimationTime || !!engineAny?.setTime;
    },

    stopAllBakedAnimations() {
      if (!bakedEngine) return;
      const playing = animationEventEmitter.getPlayingBakedAnimations();
      bakedEngine.stopAllAnimations?.();
      for (const anim of playing) {
        animationEventEmitter.emitBakedAnimationStopped(anim.name);
      }
    },

    getBakedClips() {
      return animationEventEmitter.getBakedClips();
    },

    getPlayingBakedAnimations() {
      return animationEventEmitter.getPlayingBakedAnimations();
    },
  } as const;

  // Helper to get snippet from runtime
  function getSnippet(name: string) {
    const list = scheduler.getSnippets() as any[] || [];
    return list.find((s) => s?.name === name);
  }

  // Expose on window for debugging
  (window as any).anim = api;

  return api;
}

// Export the type for the animation service
export type AnimationService = ReturnType<typeof createAnimationService>;

// ============================================================================
// RxJS Event Emitter - Singleton for Animation Events
// ============================================================================

/**
 * Converts a NormalizedSnippet to minimal SnippetUIState for React components.
 */
function toUIState(sn: NormalizedSnippet): SnippetUIState {
  const loopMode = sn.mixerLoopMode || (sn.loop ? 'repeat' : 'once');
  const loop = loopMode !== 'once';
  return {
    name: sn.name,
    isPlaying: sn.isPlaying,
    loop,
    loopMode,
    repeatCount: sn.mixerRepeatCount,
    reverse: !!sn.mixerReverse,
    currentTime: sn.currentTime,
    duration: sn.duration,
    playbackRate: sn.snippetPlaybackRate,
    intensityScale: sn.snippetIntensityScale,
    blendMode: sn.snippetBlendMode,
    balance: sn.snippetBalance,
    category: sn.snippetCategory,
    easing: sn.snippetEasing,
  };
}

function toBakedUIState(
  clip: BakedClipInfo,
  state?: Partial<BakedAnimationUIState> | null
): BakedAnimationUIState {
  const currentTime = state?.currentTime ?? state?.time ?? 0;
  const playbackRate = state?.playbackRate ?? state?.speed ?? 1;
  const intensityScale = state?.intensityScale ?? state?.weight ?? 1;
  const loopMode = state?.loopMode ?? ((state?.loop ?? false) ? 'repeat' : 'once');
  return {
    source: 'baked',
    name: clip.name,
    time: currentTime,
    currentTime,
    duration: state?.duration ?? clip.duration ?? 0,
    speed: playbackRate,
    playbackRate,
    weight: state?.weight ?? intensityScale,
    intensityScale,
    isPlaying: !!state?.isPlaying,
    isPaused: !!state?.isPaused,
    loop: state?.loop ?? loopMode !== 'once',
    loopMode,
    reverse: !!state?.reverse,
    repeatCount: state?.repeatCount,
    blendMode: state?.blendMode ?? 'replace',
    balance: Math.max(-1, Math.min(1, Number.isFinite(state?.balance) ? state?.balance ?? 0 : 0)),
    category: 'baked',
    easing: state?.easing ?? 'linear',
  };
}

function toBakedPlayOptions(state: BakedAnimationUIState) {
  return {
    loop: state.loop,
    loopMode: state.loopMode,
    repeatCount: state.repeatCount,
    reverse: state.reverse,
    playbackRate: state.playbackRate,
    weight: state.intensityScale,
    blendMode: state.blendMode,
  };
}

/**
 * AnimationEventEmitter - Central event stream for animation state changes.
 *
 * Emits discrete events (not snapshots) when:
 * - Keyframe transitions complete
 * - Snippet play/pause/stop state changes
 * - Loop iterations complete
 * - Snippets are added/removed
 * - Parameters change (rate, intensity, loop mode)
 *
 * React hooks subscribe to events and read state from the animation runtime on demand.
 * No intermediate state copying - events are just notifications.
 */
class AnimationEventEmitter {
  private event$ = new Subject<AnimationEvent>();
  private _getSnippets: (() => NormalizedSnippet[]) | null = null;
  private _globalState: 'playing' | 'paused' | 'stopped' = 'stopped';

  // Baked animation state storage
  private _bakedClips: BakedClipInfo[] = [];
  private _playingBakedAnimations = new Map<string, BakedAnimationUIState>();

  /** Observable stream of discrete animation events */
  get events(): Observable<AnimationEvent> {
    return this.event$.asObservable();
  }

  /**
   * Set the function to retrieve snippets from the animation runtime.
   * Called during service creation.
   */
  setSnippetAccessor(getSnippets: () => NormalizedSnippet[]) {
    this._getSnippets = getSnippets;
  }

  /** Read current snippets from runtime (for initial hook values) */
  getSnippets(): SnippetUIState[] {
    if (!this._getSnippets) return [];
    return this._getSnippets().map(toUIState);
  }

  /** Get raw snippets with full data including curves (for curve editors) */
  getRawSnippets(): NormalizedSnippet[] {
    if (!this._getSnippets) return [];
    return this._getSnippets();
  }

  /** Get a single snippet by name */
  getSnippet(name: string): SnippetUIState | null {
    if (!this._getSnippets) return null;
    const sn = this._getSnippets().find(s => s.name === name);
    return sn ? toUIState(sn) : null;
  }

  /** Get current global playback state */
  getGlobalState(): 'playing' | 'paused' | 'stopped' {
    return this._globalState;
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // ============ Event Emitters (just emit, no state copying) ============

  emitSnippetAdded(snippetName: string) {
    this.event$.next({
      type: 'SNIPPET_ADDED',
      snippetName,
      timestamp: this.now(),
    });
  }

  emitSnippetRemoved(snippetName: string) {
    this.event$.next({
      type: 'SNIPPET_REMOVED',
      snippetName,
      timestamp: this.now(),
    });
  }

  emitPlayStateChanged(snippetName: string, isPlaying: boolean) {
    this.event$.next({
      type: 'SNIPPET_PLAY_STATE_CHANGED',
      snippetName,
      isPlaying,
      timestamp: this.now(),
    });
  }

  emitSnippetLooped(data: { snippetName: string; iteration: number; localTime: number }) {
    this.event$.next({
      type: 'SNIPPET_LOOPED',
      ...data,
      timestamp: this.now(),
    });
  }

  emitSnippetCompleted(snippetName: string) {
    this.event$.next({
      type: 'SNIPPET_COMPLETED',
      snippetName,
      timestamp: this.now(),
    });
    // Keep play/pause buttons in sync when a clip finishes
    this.emitPlayStateChanged(snippetName, false);
  }

  emitKeyframeCompleted(data: {
    snippetName: string;
    keyframeIndex: number;
    totalKeyframes: number;
    currentTime: number;
    duration: number;
  }) {
    this.event$.next({
      type: 'KEYFRAME_COMPLETED',
      ...data,
      timestamp: this.now(),
    });
  }

  emitGlobalPlaybackChanged(state: 'playing' | 'paused' | 'stopped') {
    this._globalState = state;
    this.event$.next({
      type: 'GLOBAL_PLAYBACK_CHANGED',
      state,
      timestamp: this.now(),
    });
  }

  emitSnippetSeeked(snippetName: string, time: number) {
    this.event$.next({
      type: 'SNIPPET_SEEKED',
      snippetName,
      time,
      timestamp: this.now(),
    });
  }

  emitParamsChanged(snippetName: string, params: {
    playbackRate?: number;
    intensityScale?: number;
    loop?: boolean;
    mixerLoopMode?: 'once' | 'repeat' | 'pingpong';
    repeatCount?: number;
    reverse?: boolean;
    blendMode?: 'replace' | 'additive';
    balance?: number;
    easing?: import('./types').EasingType;
  }) {
    this.event$.next({
      type: 'SNIPPET_PARAMS_CHANGED',
      snippetName,
      params,
      timestamp: this.now(),
    });
  }

  // ============ Baked Animation Event Emitters ============

  emitBakedClipsLoaded(clips: BakedClipInfo[]) {
    this._bakedClips = clips;
    const nextStates = new Map<string, BakedAnimationUIState>();
    clips.forEach((clip) => {
      const existing = this._playingBakedAnimations.get(clip.name);
      nextStates.set(clip.name, toBakedUIState(clip, existing));
    });
    this._playingBakedAnimations = nextStates;
    this.event$.next({
      type: 'BAKED_CLIPS_LOADED',
      clips,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationStarted(clipName: string, state: BakedAnimationUIState) {
    this._playingBakedAnimations.set(clipName, state);
    this.event$.next({
      type: 'BAKED_ANIMATION_STARTED',
      clipName,
      state,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationStopped(clipName: string) {
    const clip = this._bakedClips.find((entry) => entry.name === clipName) ?? { name: clipName, duration: 0 };
    const existing = this._playingBakedAnimations.get(clipName);
    this._playingBakedAnimations.set(clipName, toBakedUIState(clip, {
      ...existing,
      isPlaying: false,
      isPaused: false,
      time: 0,
      currentTime: 0,
    }));
    this.event$.next({
      type: 'BAKED_ANIMATION_STOPPED',
      clipName,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationPaused(clipName: string) {
    const state = this._playingBakedAnimations.get(clipName);
    if (state) {
      state.isPaused = true;
      state.isPlaying = false;
    }
    this.event$.next({
      type: 'BAKED_ANIMATION_PAUSED',
      clipName,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationResumed(clipName: string) {
    const state = this._playingBakedAnimations.get(clipName);
    if (state) {
      state.isPaused = false;
      state.isPlaying = true;
    }
    this.event$.next({
      type: 'BAKED_ANIMATION_RESUMED',
      clipName,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationCompleted(clipName: string) {
    const clip = this._bakedClips.find((entry) => entry.name === clipName) ?? { name: clipName, duration: 0 };
    const existing = this._playingBakedAnimations.get(clipName);
    const terminalTime = existing?.reverse ? 0 : (existing?.duration ?? clip.duration);
    this._playingBakedAnimations.set(clipName, toBakedUIState(clip, {
      ...existing,
      isPlaying: false,
      isPaused: false,
      time: terminalTime,
      currentTime: terminalTime,
    }));
    this.event$.next({
      type: 'BAKED_ANIMATION_COMPLETED',
      clipName,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationProgress(clipName: string, time: number, duration: number) {
    const state = this._playingBakedAnimations.get(clipName);
    if (state) {
      state.time = time;
      state.currentTime = time;
      state.duration = duration;
    }
    this.event$.next({
      type: 'BAKED_ANIMATION_PROGRESS',
      clipName,
      time,
      duration,
      timestamp: this.now(),
    });
  }

  emitBakedAnimationParamsChanged(clipName: string, params: {
    speed?: number;
    playbackRate?: number;
    weight?: number;
    intensityScale?: number;
    loop?: boolean;
    loopMode?: MixerLoopMode;
    reverse?: boolean;
    repeatCount?: number;
    blendMode?: 'replace' | 'additive';
    balance?: number;
    easing?: import('./types').EasingType;
  }) {
    const state = this._playingBakedAnimations.get(clipName);
    if (state) {
      if (params.speed !== undefined) state.speed = params.speed;
      if (params.playbackRate !== undefined) state.playbackRate = params.playbackRate;
      if (params.weight !== undefined) state.weight = params.weight;
      if (params.intensityScale !== undefined) state.intensityScale = params.intensityScale;
      if (params.loop !== undefined) state.loop = params.loop;
      if (params.loopMode !== undefined) state.loopMode = params.loopMode;
      if (params.reverse !== undefined) state.reverse = params.reverse;
      if (params.repeatCount !== undefined) state.repeatCount = params.repeatCount;
      if (params.blendMode !== undefined) state.blendMode = params.blendMode;
      if (params.balance !== undefined) state.balance = params.balance;
      if (params.easing !== undefined) state.easing = params.easing;
    }
    this.event$.next({
      type: 'BAKED_ANIMATION_PARAMS_CHANGED',
      clipName,
      params,
      timestamp: this.now(),
    });
  }

  // ============ Baked Animation State Getters ============

  getBakedClips(): BakedClipInfo[] {
    return this._bakedClips;
  }

  getPlayingBakedAnimations(): BakedAnimationUIState[] {
    return Array.from(this._playingBakedAnimations.values()).filter((animation) => animation.isPlaying || animation.isPaused);
  }

  getBakedAnimationState(clipName: string): BakedAnimationUIState | null {
    return this._playingBakedAnimations.get(clipName) ?? null;
  }

  updateBakedAnimationState(clipName: string, state: BakedAnimationUIState) {
    this._playingBakedAnimations.set(clipName, state);
  }
}

// Singleton instance - shared by scheduler and service
export const animationEventEmitter = new AnimationEventEmitter();

// ============================================================================
// Derived Observables - Event-based subscriptions (no snapshots)
// ============================================================================

/**
 * Observable of snippet list changes (add/remove only).
 * Reads from runtime on each event - no intermediate state copying.
 */
export const snippetList$: Observable<string[]> = animationEventEmitter.events.pipe(
  filter(e => e.type === 'SNIPPET_ADDED' || e.type === 'SNIPPET_REMOVED'),
  map(() => animationEventEmitter.getSnippets().map((s: SnippetUIState) => s.name)),
  distinctUntilChanged((a, b) => a.length === b.length && a.every((v: string, i: number) => v === b[i])),
  shareReplay(1)
);

/**
 * Factory for per-snippet state observables.
 * Listens to discrete events that affect a specific snippet's state.
 * Does NOT react to continuous progress updates - only meaningful state changes.
 */
export function snippetState$(snippetName: string): Observable<SnippetUIState | null> {
  return animationEventEmitter.events.pipe(
    // Only react to discrete state changes for this snippet
    filter(e => {
      if (e.type === 'SNIPPET_ADDED' || e.type === 'SNIPPET_REMOVED') return true;
      // Discrete state change events for this snippet
      if (e.type === 'SNIPPET_PLAY_STATE_CHANGED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_COMPLETED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_LOOPED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_PARAMS_CHANGED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_SEEKED' && e.snippetName === snippetName) return true;
      // NOTE: KEYFRAME_COMPLETED removed - no continuous progress updates
      return false;
    }),
    // Read current state from runtime
    map(() => animationEventEmitter.getSnippet(snippetName)),
    distinctUntilChanged((a, b) => {
      if (!a || !b) return a === b;
      // No time comparison - only discrete state changes matter
      return (
        a.isPlaying === b.isPlaying &&
        a.loopMode === b.loopMode &&
        a.repeatCount === b.repeatCount &&
        a.reverse === b.reverse &&
        a.playbackRate === b.playbackRate &&
        a.intensityScale === b.intensityScale &&
        a.blendMode === b.blendMode &&
        a.balance === b.balance &&
        a.easing === b.easing
      );
    }),
    shareReplay(1)
  );
}

/**
 * Throttled currentTime updates for a specific snippet.
 * Uses event data directly - no state reading needed.
 */
export function snippetTime$(snippetName: string, throttleMs = 100): Observable<number> {
  return animationEventEmitter.events.pipe(
    filter((e): e is KeyframeCompletedEvent =>
      e.type === 'KEYFRAME_COMPLETED' && e.snippetName === snippetName
    ),
    map(e => e.currentTime),
    throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
    distinctUntilChanged((a, b) => Math.abs(a - b) < 0.05),
    shareReplay(1)
  );
}

/**
 * Global playback state observable.
 * Uses event data directly.
 */
export const globalPlaybackState$: Observable<'playing' | 'paused' | 'stopped'> =
  animationEventEmitter.events.pipe(
    filter((e): e is GlobalPlaybackChangedEvent => e.type === 'GLOBAL_PLAYBACK_CHANGED'),
    map(e => e.state),
    distinctUntilChanged(),
    shareReplay(1)
  );

// ============================================================================
// Baked Animation Observables
// ============================================================================

/**
 * Observable of baked clip list changes.
 * Emits when clips are loaded from a model.
 */
export const bakedClipList$: Observable<BakedClipInfo[]> = animationEventEmitter.events.pipe(
  filter((e): e is BakedClipsLoadedEvent => e.type === 'BAKED_CLIPS_LOADED'),
  map(e => e.clips),
  shareReplay(1)
);

/**
 * Observable of playing baked animations list.
 * Updates on start/stop/pause/resume/complete events.
 */
export const playingBakedAnimations$: Observable<BakedAnimationUIState[]> =
  animationEventEmitter.events.pipe(
    filter(e =>
      e.type === 'BAKED_ANIMATION_STARTED' ||
      e.type === 'BAKED_ANIMATION_STOPPED' ||
      e.type === 'BAKED_ANIMATION_PAUSED' ||
      e.type === 'BAKED_ANIMATION_RESUMED' ||
      e.type === 'BAKED_ANIMATION_COMPLETED' ||
      e.type === 'BAKED_ANIMATION_PARAMS_CHANGED'
      // NOTE: BAKED_ANIMATION_PROGRESS removed - no polling, only discrete events
    ),
    map(() => animationEventEmitter.getPlayingBakedAnimations()),
    distinctUntilChanged((a, b) => {
      if (a.length !== b.length) return false;
      // Shallow comparison of animation states (no time comparison - only discrete state changes matter)
      for (let i = 0; i < a.length; i++) {
        if (a[i].name !== b[i].name) return false;
        if (a[i].isPlaying !== b[i].isPlaying) return false;
        if (a[i].isPaused !== b[i].isPaused) return false;
        if (a[i].loop !== b[i].loop) return false;
        if (a[i].playbackRate !== b[i].playbackRate) return false;
        if (a[i].intensityScale !== b[i].intensityScale) return false;
        if (a[i].loopMode !== b[i].loopMode) return false;
        if (a[i].repeatCount !== b[i].repeatCount) return false;
        if (a[i].reverse !== b[i].reverse) return false;
        if (a[i].blendMode !== b[i].blendMode) return false;
        if (a[i].balance !== b[i].balance) return false;
        if (a[i].easing !== b[i].easing) return false;
      }
      return true;
    }),
    shareReplay(1)
  );

/**
 * Factory for per-baked-animation state observables.
 * Listens to events that affect a specific baked animation.
 */
export function bakedAnimationState$(clipName: string): Observable<BakedAnimationUIState | null> {
  return animationEventEmitter.events.pipe(
    filter(e => {
      // Only react to discrete state changes, not continuous progress
      if (e.type === 'BAKED_ANIMATION_STARTED' && e.clipName === clipName) return true;
      if (e.type === 'BAKED_ANIMATION_STOPPED' && e.clipName === clipName) return true;
      if (e.type === 'BAKED_ANIMATION_PAUSED' && e.clipName === clipName) return true;
      if (e.type === 'BAKED_ANIMATION_RESUMED' && e.clipName === clipName) return true;
      if (e.type === 'BAKED_ANIMATION_COMPLETED' && e.clipName === clipName) return true;
      if (e.type === 'BAKED_ANIMATION_PARAMS_CHANGED' && e.clipName === clipName) return true;
      // NOTE: BAKED_ANIMATION_PROGRESS removed - no polling
      return false;
    }),
    map(() => animationEventEmitter.getBakedAnimationState(clipName)),
    distinctUntilChanged((a, b) => {
      if (!a || !b) return a === b;
      // No time comparison - only discrete state changes matter
      return (
        a.isPlaying === b.isPlaying &&
        a.isPaused === b.isPaused &&
        a.playbackRate === b.playbackRate &&
        a.intensityScale === b.intensityScale &&
        a.loop === b.loop &&
        a.loopMode === b.loopMode &&
        a.repeatCount === b.repeatCount &&
        a.reverse === b.reverse &&
        a.blendMode === b.blendMode &&
        a.balance === b.balance &&
        a.easing === b.easing
      );
    }),
    shareReplay(1)
  );
}

/**
 * Throttled progress updates for a specific baked animation.
 */
export function bakedAnimationProgress$(clipName: string, throttleMs = 100): Observable<{ time: number; duration: number }> {
  return animationEventEmitter.events.pipe(
    filter((e): e is BakedAnimationProgressEvent =>
      e.type === 'BAKED_ANIMATION_PROGRESS' && e.clipName === clipName
    ),
    map(e => ({ time: e.time, duration: e.duration })),
    throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
    distinctUntilChanged((a, b) => Math.abs(a.time - b.time) < 0.05),
    shareReplay(1)
  );
}
