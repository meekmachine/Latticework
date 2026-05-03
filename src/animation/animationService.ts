import { Subject, Observable } from 'rxjs';
import { filter, map, distinctUntilChanged, throttleTime, shareReplay } from 'rxjs/operators';
import type {
  Engine,
  ScheduleOpts,
  NormalizedSnippet,
  BakedAnimationEngine,
  BakedRuntimeAnimationState,
  EasingType,
  MixerLoopMode,
  ClipHandle,
} from './types';
import { isRuntimeDebugEnabled } from '../config/runtimeDebug';
import type {
  AnimationEvent,
  SnippetUIState,
  GlobalPlaybackChangedEvent,
  BakedClipInfo,
  BakedAnimationUIState,
  BakedClipsLoadedEvent,
  BakedAnimationStartedEvent,
  BakedAnimationStoppedEvent,
  BakedAnimationProgressEvent,
} from './animationEvents';

type ClipStreamEvent =
  | {
      type: 'keyframe';
      clipName: string;
      keyframeIndex: number;
      totalKeyframes: number;
      currentTime: number;
      duration: number;
      iteration: number;
    }
  | {
      type: 'loop';
      clipName: string;
      iteration: number;
      currentTime: number;
      duration: number;
    }
  | {
      type: 'seek';
      clipName: string;
      currentTime: number;
      duration: number;
      iteration: number;
    }
  | {
      type: 'completed';
      clipName: string;
      currentTime: number;
      duration: number;
      iteration: number;
    };

type StreamClipHandle = ClipHandle & {
  subscribe?: (listener: (event: ClipStreamEvent) => void) => () => void;
};

type RuntimeSched = {
  name: string;
  startsAt: number;
  offset: number;
  enabled: boolean;
};

type SchedulerCurvePoint = {
  time: number;
  intensity: number;
  inherit?: boolean;
};

type PlaybackRunner = {
  snippetName: string;
  active: boolean;
  paused: boolean;
  clipHandle?: StreamClipHandle;
  unsubscribeClipEvents?: () => void;
  stopPromise: Promise<void>;
  stopResolve: () => void;
  seekTime?: number;
};

const EYE_HEAD_IDS = {
  yawNeg: '61',
  yawPos: '62',
  pitchPos: '63',
  pitchNeg: '64',
};

const isNumericId = (value: string) => /^[0-9]+$/.test(value);

function normalizeCurves(
  input?: Record<string, Array<{ t?: number; v?: number; time?: number; intensity?: number; inherit?: boolean }>>,
): Record<string, SchedulerCurvePoint[]> {
  const out: Record<string, SchedulerCurvePoint[]> = {};
  if (!input) return out;
  for (const [key, arr] of Object.entries(input)) {
    const safe = Array.isArray(arr) ? arr : [];
    const norm = safe.map((point: any) => ({
      time: typeof point.time === 'number' ? point.time : (typeof point.t === 'number' ? point.t : 0),
      intensity: typeof point.intensity === 'number' ? point.intensity : (typeof point.v === 'number' ? point.v : 0),
      inherit: !!point.inherit,
    }));
    norm.sort((a, b) => a.time - b.time);
    out[key] = norm;
  }
  return out;
}

function calculateDuration(curves: Record<string, SchedulerCurvePoint[]>): number {
  if (!curves || !Object.keys(curves).length) return 0;
  let maxTime = 0;
  for (const arr of Object.values(curves)) {
    if (arr.length > 0) {
      const lastTime = arr[arr.length - 1].time;
      if (lastTime > maxTime) maxTime = lastTime;
    }
  }
  return maxTime;
}

function normalizeSnippet(sn: any): NormalizedSnippet {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let curves: Record<string, SchedulerCurvePoint[]> = {};

  if (sn?.curves) {
    curves = normalizeCurves(sn.curves);
  } else {
    const mapped: Record<string, SchedulerCurvePoint[]> = {};
    (sn?.au ?? []).forEach((point: any) => {
      const key = String(point.id);
      (mapped[key] ||= []).push({
        time: point.t ?? point.time ?? 0,
        intensity: point.v ?? point.intensity ?? 0,
        inherit: !!point.inherit,
      });
    });
    (sn?.viseme ?? []).forEach((point: any) => {
      const key = String(point.key);
      (mapped[key] ||= []).push({
        time: point.t ?? point.time ?? 0,
        intensity: point.v ?? point.intensity ?? 0,
        inherit: !!point.inherit,
      });
    });
    Object.values(mapped).forEach((arr) => arr.sort((a, b) => a.time - b.time));
    curves = mapped;
  }

  const duration = calculateDuration(curves);
  const mixerLoopMode = sn?.mixerLoopMode ?? (sn?.loop ? 'repeat' : 'once');

  return {
    name: sn?.name ?? `sn_${Date.now()}`,
    curves,
    isPlaying: !!sn?.isPlaying,
    loop: mixerLoopMode !== 'once',
    aiExpressionMetadata: sn?.aiExpressionMetadata ?? undefined,
    loopIteration: typeof sn?.loopIteration === 'number' ? sn.loopIteration : 0,
    loopDirection: sn?.loopDirection === -1 ? -1 : (sn?.mixerReverse ? -1 : 1),
    lastLoopTime: typeof sn?.lastLoopTime === 'number' ? sn.lastLoopTime : 0,
    snippetPlaybackRate: typeof sn?.snippetPlaybackRate === 'number' ? sn.snippetPlaybackRate : 1,
    snippetIntensityScale: typeof sn?.snippetIntensityScale === 'number' ? sn.snippetIntensityScale : 1,
    snippetBlendMode: sn?.snippetBlendMode ?? 'replace',
    snippetJawScale: typeof sn?.snippetJawScale === 'number' ? sn.snippetJawScale : 1.0,
    snippetBalance: typeof sn?.snippetBalance === 'number' ? sn.snippetBalance : 0,
    snippetBalanceMap: sn?.snippetBalanceMap ?? {},
    snippetCategory: sn?.snippetCategory ?? 'default',
    snippetPriority: typeof sn?.snippetPriority === 'number' ? sn.snippetPriority : 0,
    snippetEasing: sn?.snippetEasing ?? 'linear',
    mixerChannel: sn?.mixerChannel,
    mixerBlendMode: sn?.mixerBlendMode,
    mixerWeight: sn?.mixerWeight,
    mixerFadeDurationMs: sn?.mixerFadeDurationMs,
    mixerWarpDurationMs: sn?.mixerWarpDurationMs,
    mixerTimeScale: sn?.mixerTimeScale,
    mixerLoopMode,
    mixerRepeatCount: typeof sn?.mixerRepeatCount === 'number' ? sn.mixerRepeatCount : undefined,
    mixerClampWhenFinished: sn?.mixerClampWhenFinished,
    mixerAdditive: sn?.mixerAdditive,
    mixerReverse: !!sn?.mixerReverse,
    currentTime: typeof sn?.currentTime === 'number' ? sn.currentTime : 0,
    startWallTime: typeof sn?.startWallTime === 'number' ? sn.startWallTime : now,
    duration,
    cursor: sn?.cursor ?? {},
  };
}

function sampleCurveAt(arr: SchedulerCurvePoint[], t: number) {
  if (!arr.length) return 0;
  if (t <= arr[0].time) return arr[0].intensity ?? 0;
  const last = arr[arr.length - 1];
  if (t >= last.time) return last.intensity ?? 0;
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (t >= a.time && t <= b.time) {
      const dt = Math.max(1e-6, b.time - a.time);
      const p = (t - a.time) / dt;
      return (a.intensity ?? 0) + ((b.intensity ?? 0) - (a.intensity ?? 0)) * p;
    }
  }
  return last.intensity ?? 0;
}

function eyeHeadUsesInheritedStart(sn: NormalizedSnippet) {
  if (sn.snippetCategory !== 'eyeHeadTracking') return false;
  return Object.values(sn.curves || {}).some((arr) => !!arr?.[0]?.inherit);
}

function getEyeHeadSeekTime(
  sn: NormalizedSnippet,
  getCurrentValue: (curveId: string) => number,
) {
  const { yawNeg, yawPos, pitchPos, pitchNeg } = EYE_HEAD_IDS;
  const curves = sn.curves || {};
  const yawNegCurve = curves[yawNeg];
  const yawPosCurve = curves[yawPos];
  const pitchPosCurve = curves[pitchPos];
  const pitchNegCurve = curves[pitchNeg];

  if (!yawNegCurve || !yawPosCurve || !pitchPosCurve || !pitchNegCurve) return undefined;

  const times = new Set<number>();
  [yawNegCurve, yawPosCurve, pitchPosCurve, pitchNegCurve].forEach((arr) => {
    arr.forEach((kf) => times.add(kf.time));
  });
  const samples = Array.from(times).sort((a, b) => a - b);
  if (!samples.length) return undefined;

  const currentYaw = getCurrentValue(yawPos) - getCurrentValue(yawNeg);
  const currentPitch = getCurrentValue(pitchPos) - getCurrentValue(pitchNeg);

  let bestTime = samples[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of samples) {
    const yaw = sampleCurveAt(yawPosCurve, t) - sampleCurveAt(yawNegCurve, t);
    const pitch = sampleCurveAt(pitchPosCurve, t) - sampleCurveAt(pitchNegCurve, t);
    const dYaw = yaw - currentYaw;
    const dPitch = pitch - currentPitch;
    const dist = dYaw * dYaw + dPitch * dPitch;
    if (dist < bestDist) {
      bestDist = dist;
      bestTime = t;
    }
  }

  return bestTime;
}

function buildClipCurves(
  sn: NormalizedSnippet,
  getCurrentValue: (curveId: string) => number,
  loopMode: 'once' | 'repeat' | 'pingpong',
) {
  const clipCurves: Record<string, Array<{ time: number; intensity: number }>> = {};

  const applyInherit = (
    curveId: string,
    arr: Array<{ time: number; intensity: number; inherit?: boolean }>,
  ) => {
    const baseCurve = arr.map(({ time, intensity }) => ({ time, intensity }));
    if (!arr.length) return baseCurve;
    const first = arr[0];

    if (sn.snippetCategory === 'eyeHeadTracking') {
      if (first?.inherit) {
        const base = getCurrentValue(curveId);
        const next = baseCurve.slice();
        next[0] = { ...next[0], intensity: base };
        return next;
      }
      if (loopMode !== 'once' && baseCurve.length > 1) {
        const firstIntensity = baseCurve[0].intensity;
        const lastIdx = baseCurve.length - 1;
        if (Math.abs(baseCurve[lastIdx].intensity - firstIntensity) > 1e-4) {
          baseCurve[lastIdx] = { ...baseCurve[lastIdx], intensity: firstIntensity };
        }
      }
      return baseCurve;
    }

    if (!first?.inherit) return baseCurve;

    const base = getCurrentValue(curveId);
    const offset = base - (first.intensity ?? 0);
    return arr.map(({ time, intensity }) => ({ time, intensity: (intensity ?? 0) + offset }));
  };

  for (const [curveId, arr] of Object.entries(sn.curves || {})) {
    clipCurves[curveId] = applyInherit(curveId, arr);
  }

  return clipCurves;
}

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, time);
  return Math.max(0, Math.min(duration, time));
}

/**
 * Animation Service
 *
 * This service uses Loom3 clip handles as the runtime source of truth and
 * keeps only snippet metadata and UI state locally.
 */
export function createAnimationService(host: Engine) {
  let snippets: NormalizedSnippet[] = [];
  const sched = new Map<string, RuntimeSched>();
  const playbackRunners = new Map<string, PlaybackRunner>();
  let playing = false;
  let disposed = false;

  animationEventEmitter.setSnippetAccessor(() => snippets);

  const getSnippet = (name: string) => snippets.find((entry) => entry.name === name) ?? null;

  const ensureSched = (name: string) => {
    if (!sched.has(name)) {
      sched.set(name, { name, startsAt: 0, offset: 0, enabled: true });
    }
    return sched.get(name)!;
  };

  const upsertSnippet = (snippet: NormalizedSnippet, isPlaying: boolean) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const next = { ...snippet, isPlaying, startWallTime: now };
    const index = snippets.findIndex((entry) => entry.name === next.name);
    if (index >= 0) {
      const updated = snippets.slice();
      updated[index] = next;
      snippets = updated;
      return;
    }
    snippets = [...snippets, next];
  };

  const getCurrentValue = (auId: string) => {
    if (host.getAU && isNumericId(auId)) {
      try {
        return host.getAU(Number(auId));
      } catch {}
    }
    return 0;
  };

  const updateSnippetTime = (snippet: NormalizedSnippet, time: number, duration = snippet.duration) => {
    snippet.currentTime = clampTime(time, duration);
  };

  const refreshStartWallTime = (snippet: NormalizedSnippet) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const rate = Math.max(1e-6, snippet.snippetPlaybackRate || 1);
    snippet.startWallTime = now - (snippet.currentTime / rate) * 1000;
  };

  const captureRunnerTime = (name: string, runner?: PlaybackRunner) => {
    const activeRunner = runner ?? playbackRunners.get(name);
    const snippet = getSnippet(name);
    const handle = activeRunner?.clipHandle;
    if (!snippet || !handle) return;
    let currentTime = snippet.currentTime;
    let duration = snippet.duration;
    try {
      currentTime = handle.getTime();
    } catch {}
    try {
      duration = handle.getDuration();
    } catch {}
    updateSnippetTime(snippet, currentTime, duration);
  };

  const updateHostClipParams = (name: string, params: Record<string, unknown>) => {
    const handle = playbackRunners.get(name)?.clipHandle;
    try {
      host.updateClipParams?.(name, { ...params, actionId: handle?.actionId });
    } catch {}
  };

  const stopPlaybackRunner = (name: string, cleanupHost: boolean) => {
    const runner = playbackRunners.get(name);
    if (!runner) {
      if (cleanupHost) {
        try { host.cleanupSnippet?.(name); } catch {}
      }
      return;
    }

    runner.active = false;
    runner.stopResolve();
    if (runner.unsubscribeClipEvents) {
      try { runner.unsubscribeClipEvents(); } catch {}
      runner.unsubscribeClipEvents = undefined;
    }
    if (runner.clipHandle) {
      try { runner.clipHandle.stop(); } catch {}
      runner.clipHandle = undefined;
    }
    playbackRunners.delete(name);

    if (cleanupHost) {
      try { host.cleanupSnippet?.(name); } catch {}
    }
  };

  const subscribeToClipEvents = (
    snippetName: string,
    runner: PlaybackRunner,
    handle: StreamClipHandle,
  ) => {
    if (typeof handle.subscribe !== 'function') return false;

    runner.unsubscribeClipEvents = handle.subscribe((event) => {
      if (!runner.active || runner.clipHandle !== handle) return;
      const snippet = getSnippet(snippetName);
      if (!snippet) return;

      const previousTime = snippet.currentTime;
      if (snippet.mixerLoopMode === 'pingpong') {
        if (event.type === 'loop') {
          snippet.loopDirection = 1;
        } else if (event.currentTime > previousTime + 0.001) {
          snippet.loopDirection = 1;
        } else if (event.currentTime < previousTime - 0.001) {
          snippet.loopDirection = -1;
        }
      } else {
        snippet.loopDirection = snippet.mixerReverse ? -1 : 1;
      }
      updateSnippetTime(snippet, event.currentTime, event.duration);
      if (typeof event.iteration === 'number') {
        snippet.loopIteration = Math.max(0, event.iteration);
      }

      switch (event.type) {
        case 'keyframe':
          animationEventEmitter.emitKeyframeCompleted({
            snippetName,
            keyframeIndex: event.keyframeIndex,
            totalKeyframes: event.totalKeyframes,
            currentTime: event.currentTime,
            duration: event.duration,
          });
          return;
        case 'loop':
          snippet.lastLoopTime = event.currentTime;
          animationEventEmitter.emitSnippetLooped({
            snippetName,
            iteration: event.iteration,
            localTime: event.currentTime,
          });
          return;
        case 'seek':
        case 'completed':
          return;
      }
    });

    return true;
  };

  const runClipPlayback = async (snippetName: string, runner: PlaybackRunner) => {
    const snippet = getSnippet(snippetName);
    if (!snippet || !snippet.curves || !runner.active) {
      playbackRunners.delete(snippetName);
      return;
    }

    if (!host.buildClip) {
      console.error(`[animationService] buildClip not available - cannot play "${snippetName}"`);
      playbackRunners.delete(snippetName);
      return;
    }

    const loopMode = snippet.mixerLoopMode ?? (snippet.loop ? 'repeat' : 'once');
    const playbackRate = snippet.snippetPlaybackRate ?? 1;
    const reverse = !!snippet.mixerReverse;
    const signedRate = reverse ? -playbackRate : playbackRate;
    const clipCurves = buildClipCurves(snippet, getCurrentValue, loopMode);
    const useVisemeCategory = snippet.snippetCategory === 'visemeSnippet' || snippet.snippetCategory === 'combined';
    const snippetCategory = useVisemeCategory ? 'visemeSnippet' : undefined;
    const hasJawCurve = Object.prototype.hasOwnProperty.call(snippet.curves || {}, '26');
    const autoVisemeJawOverride =
      typeof (snippet as any).autoVisemeJaw === 'boolean' ? (snippet as any).autoVisemeJaw : undefined;
    const autoVisemeJaw = autoVisemeJawOverride ?? (hasJawCurve ? false : undefined);

    const handle = host.buildClip(
      snippetName,
      clipCurves,
      {
        loopMode,
        repeatCount: snippet.mixerRepeatCount,
        reverse,
        playbackRate: signedRate,
        balance: snippet.snippetBalance ?? 0,
        balanceMap: snippet.snippetBalanceMap ?? {},
        jawScale: snippet.snippetJawScale ?? 1.0,
        mixerWeight: typeof snippet.mixerWeight === 'number' ? snippet.mixerWeight : undefined,
        intensityScale: snippet.snippetIntensityScale ?? 1,
        snippetCategory,
        autoVisemeJaw,
      } as any,
    ) as StreamClipHandle | null;

    if (!handle) {
      console.error(`[animationService] buildClip failed for "${snippetName}"`);
      snippet.isPlaying = false;
      playbackRunners.delete(snippetName);
      try { host.cleanupSnippet?.(snippetName); } catch {}
      return;
    }

    if (!subscribeToClipEvents(snippetName, runner, handle)) {
      console.error(
        `[animationService] Loom3 clip event streams are required for "${snippetName}". Link the Loom3 stream runtime branch or upgrade the dependency.`,
      );
      snippet.isPlaying = false;
      animationEventEmitter.emitPlayStateChanged(snippetName, false);
      try { handle.stop(); } catch {}
      playbackRunners.delete(snippetName);
      try { host.cleanupSnippet?.(snippetName); } catch {}
      return;
    }

    runner.clipHandle = handle;
    handle.play();

    if (typeof runner.seekTime === 'number') {
      try { handle.setTime?.(runner.seekTime); } catch {}
      updateSnippetTime(snippet, runner.seekTime, handle.getDuration());
    }

    if (runner.paused) {
      try { handle.pause(); } catch {}
    }

    try {
      await Promise.race([handle.finished.catch(() => undefined), runner.stopPromise]);
    } catch {}

    captureRunnerTime(snippetName, runner);
    if (runner.unsubscribeClipEvents) {
      try { runner.unsubscribeClipEvents(); } catch {}
      runner.unsubscribeClipEvents = undefined;
    }
    runner.clipHandle = undefined;

    if (runner.active) {
      snippet.isPlaying = false;
      animationEventEmitter.emitSnippetCompleted(snippetName);
      try { host.onSnippetEnd?.(snippetName); } catch {}
    }

    playbackRunners.delete(snippetName);
  };

  const startPlaybackRunner = (
    snippetName: string,
    opts: { seekTime?: number; paused?: boolean } = {},
  ) => {
    stopPlaybackRunner(snippetName, false);

    const snippet = getSnippet(snippetName);
    if (!snippet || !snippet.curves) return false;

    let stopResolve = () => {};
    const stopPromise = new Promise<void>((resolve) => {
      stopResolve = resolve;
    });
    const autoSeekTime =
      opts.seekTime === undefined &&
      snippet.snippetCategory === 'eyeHeadTracking' &&
      !eyeHeadUsesInheritedStart(snippet)
        ? getEyeHeadSeekTime(snippet, getCurrentValue)
        : undefined;
    const seekTime = typeof opts.seekTime === 'number' && Number.isFinite(opts.seekTime)
      ? Math.max(0, opts.seekTime)
      : autoSeekTime;

    const runner: PlaybackRunner = {
      snippetName,
      active: true,
      paused: !!opts.paused,
      stopPromise,
      stopResolve,
      seekTime,
    };

    if (typeof seekTime === 'number') {
      updateSnippetTime(snippet, seekTime);
    }
    refreshStartWallTime(snippet);
    playbackRunners.set(snippetName, runner);
    void runClipPlayback(snippetName, runner);
    return true;
  };

  const pauseSnippetPlayback = (name: string) => {
    const runner = playbackRunners.get(name);
    const snippet = getSnippet(name);
    if (!snippet) return false;
    captureRunnerTime(name, runner);
    if (runner) {
      runner.paused = true;
      if (runner.clipHandle) {
        try { runner.clipHandle.pause(); } catch {}
      }
    }
    snippet.isPlaying = false;
    return true;
  };

  const resumeSnippetPlayback = (name: string) => {
    const runner = playbackRunners.get(name);
    const snippet = getSnippet(name);
    if (!snippet) return false;

    snippet.isPlaying = true;
    refreshStartWallTime(snippet);

    if (runner?.clipHandle) {
      runner.paused = false;
      try { runner.clipHandle.resume(); } catch {}
      return true;
    }

    return startPlaybackRunner(name, {
      seekTime: snippet.currentTime,
      paused: false,
    });
  };

  const restartSnippetPlayback = (name: string, paused = false) => {
    const snippet = getSnippet(name);
    if (!snippet) return false;
    snippet.isPlaying = !paused;
    return startPlaybackRunner(name, {
      seekTime: paused ? snippet.currentTime : undefined,
      paused,
    });
  };

  const seekSnippetPlayback = (name: string, offsetSec: number) => {
    const snippet = getSnippet(name);
    if (!snippet) return false;

    const time = Math.max(0, offsetSec);
    const schedState = ensureSched(name);
    schedState.offset = time;
    updateSnippetTime(snippet, time);

    const runner = playbackRunners.get(name);
    if (runner?.clipHandle?.setTime) {
      try { runner.clipHandle.setTime(time); } catch {}
      return true;
    }

    const paused = !snippet.isPlaying;
    startPlaybackRunner(name, { seekTime: time, paused });
    return true;
  };

  // Baked animation engine state (closure variables)
  let bakedEngine: BakedAnimationEngine | null = null;

  const getBakedClipInfo = (clipName: string): BakedClipInfo => {
    const clip = animationEventEmitter.getBakedClips().find((entry) => entry.name === clipName);
    if (clip) return clip;
    const existing = animationEventEmitter.getBakedAnimationState(clipName);
    return {
      name: clipName,
      duration: existing?.duration ?? 0,
      channels: existing?.channels ?? [],
    };
  };

  const mergeBakedState = (
    clipName: string,
    patch?: Partial<BakedAnimationUIState> | null,
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

  const toBakedStatePatch = (
    state?: BakedRuntimeAnimationState | null,
  ): Partial<BakedAnimationUIState> | undefined => {
    if (!state) return undefined;
    const {
      source: _source,
      category: _category,
      ...rest
    } = state as BakedRuntimeAnimationState & { category?: unknown };
    return rest as Partial<BakedAnimationUIState>;
  };

  const startBakedAnimationFromState = (
    clipName: string,
    state: BakedAnimationUIState,
    timeOverride?: number,
    pauseAfterStart = false,
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

  const getCurrentBakedEngineState = (clipName: string) => {
    return bakedEngine?.getPlayingAnimations?.().find((state) => state.name === clipName);
  };

  const api = {
    loadFromJSON(data: any) {
      const snippet = normalizeSnippet(data);
      upsertSnippet(snippet, !!snippet.isPlaying);
      ensureSched(snippet.name);
      animationEventEmitter.emitSnippetAdded(snippet.name);
      return snippet.name;
    },

    updateSnippet(data: any) {
      const requestedName = typeof data?.name === 'string' ? data.name : '';
      const existing = requestedName ? getSnippet(requestedName) : null;

      if (!existing) {
        const snippet = normalizeSnippet(data);
        upsertSnippet(snippet, !!snippet.isPlaying);
        ensureSched(snippet.name);
        animationEventEmitter.emitSnippetAdded(snippet.name);
        return snippet.name;
      }

      captureRunnerTime(existing.name);
      const nextCurves = data?.curves ?? existing.curves;
      const hasCurves = Object.keys(nextCurves || {}).length > 0;
      const shouldResume = !!(data?.isPlaying ?? existing.isPlaying) && hasCurves;
      const currentTime = existing.currentTime ?? 0;

      const nextSnippet = normalizeSnippet({
        ...existing,
        ...data,
        name: existing.name,
        currentTime,
        isPlaying: false,
        loopIteration: existing.loopIteration,
        loopDirection: existing.loopDirection,
        lastLoopTime: existing.lastLoopTime,
        cursor: existing.cursor,
      });

      upsertSnippet(nextSnippet, false);

      if (hasCurves) {
        restartSnippetPlayback(nextSnippet.name);
        if (currentTime > 0) {
          seekSnippetPlayback(nextSnippet.name, currentTime);
        }
        if (!shouldResume) {
          pauseSnippetPlayback(nextSnippet.name);
        }
      } else {
        pauseSnippetPlayback(nextSnippet.name);
      }

      animationEventEmitter.emitSnippetUpdated(nextSnippet.name);
      return nextSnippet.name;
    },

    schedule(data: any, opts: ScheduleOpts = {}) {
      const snippet = normalizeSnippet(data);
      if (typeof opts.priority === 'number') snippet.snippetPriority = opts.priority;

      const schedState = ensureSched(snippet.name);
      schedState.startsAt = typeof opts.startAtSec === 'number' ? Math.max(0, opts.startAtSec) : 0;
      schedState.offset = opts.offsetSec ?? 0;
      schedState.enabled = true;

      const shouldPlay = !!opts.autoPlay || playing;
      upsertSnippet(snippet, shouldPlay);
      if (typeof opts.offsetSec === 'number') {
        const updatedSnippet = getSnippet(snippet.name);
        if (updatedSnippet) updateSnippetTime(updatedSnippet, opts.offsetSec);
      }
      if (shouldPlay) {
        startPlaybackRunner(snippet.name, {
          seekTime: schedState.offset || snippet.currentTime || undefined,
          paused: false,
        });
      }
      animationEventEmitter.emitSnippetAdded(snippet.name);
      return snippet.name;
    },

    remove(name: string) {
      stopPlaybackRunner(name, true);
      sched.delete(name);
      snippets = snippets.filter((entry) => entry.name !== name);
      animationEventEmitter.emitSnippetRemoved(name);
    },

    play() {
      if (playing) return;
      playing = true;
      for (const snippet of snippets) {
        const schedState = ensureSched(snippet.name);
        if (!schedState.enabled) continue;
        snippet.isPlaying = true;
        refreshStartWallTime(snippet);
        resumeSnippetPlayback(snippet.name);
        animationEventEmitter.emitPlayStateChanged(snippet.name, true);
      }
      animationEventEmitter.emitGlobalPlaybackChanged('playing');
    },

    pause() {
      if (!playing) return;
      playing = false;
      for (const snippet of snippets) {
        if (!snippet.isPlaying) continue;
        pauseSnippetPlayback(snippet.name);
        animationEventEmitter.emitPlayStateChanged(snippet.name, false);
      }
      animationEventEmitter.emitGlobalPlaybackChanged('paused');
    },

    stop() {
      playing = false;
      for (const runnerName of Array.from(playbackRunners.keys())) {
        stopPlaybackRunner(runnerName, true);
      }
      for (const snippet of snippets) {
        snippet.isPlaying = false;
        snippet.currentTime = 0;
        snippet.loopIteration = 0;
        snippet.loopDirection = snippet.mixerReverse ? -1 : 1;
        snippet.lastLoopTime = 0;
        animationEventEmitter.emitPlayStateChanged(snippet.name, false);
      }
      animationEventEmitter.emitGlobalPlaybackChanged('stopped');
    },

    enable(name: string, on = true) {
      const schedState = ensureSched(name);
      schedState.enabled = !!on;
      const snippet = getSnippet(name);
      if (!snippet) return false;

      if (!on) {
        pauseSnippetPlayback(name);
        animationEventEmitter.emitPlayStateChanged(name, false);
        return true;
      }

      if (playing || snippet.isPlaying) {
        resumeSnippetPlayback(name);
        animationEventEmitter.emitPlayStateChanged(name, true);
      }
      return true;
    },

    seek(name: string, offsetSec: number) {
      return seekSnippetPlayback(name, offsetSec);
    },

    getState() {
      return { context: { animations: snippets } };
    },

    getScheduleSnapshot() {
      return snippets.map((snippet) => {
        const schedState = ensureSched(snippet.name);
        const localTime =
          playbackRunners.get(snippet.name)?.clipHandle?.getTime?.() ?? snippet.currentTime ?? 0;
        const loopMode = snippet.mixerLoopMode ?? (snippet.loop ? 'repeat' : 'once');
        return {
          name: snippet.name,
          enabled: schedState.enabled,
          startsAt: schedState.startsAt,
          offset: schedState.offset,
          localTime,
          duration: snippet.duration,
          loop: loopMode !== 'once',
          priority: snippet.snippetPriority ?? 0,
          playbackRate: snippet.snippetPlaybackRate ?? 1,
          intensityScale: snippet.snippetIntensityScale ?? 1,
        };
      });
    },

    getCurrentValue(auId: string): number {
      return getCurrentValue(auId);
    },

    get playing() {
      return playing;
    },

    isPlaying() {
      return playing;
    },

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

    setSnippetPlaybackRate(name: string, rate: number) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      captureRunnerTime(name);

      const nextRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
      snippet.snippetPlaybackRate = nextRate;
      refreshStartWallTime(snippet);
      animationEventEmitter.emitParamsChanged(name, { playbackRate: nextRate });

      const handle = playbackRunners.get(name)?.clipHandle;
      const signedRate = (snippet.mixerReverse ? -1 : 1) * nextRate;
      if (handle?.setPlaybackRate) {
        try { handle.setPlaybackRate(signedRate); } catch {}
      }
      updateHostClipParams(name, { rate: nextRate, reverse: !!snippet.mixerReverse });
    },

    setSnippetIntensityScale(name: string, scale: number) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      const nextScale = Math.max(0, Number.isFinite(scale) ? scale : 1);
      snippet.snippetIntensityScale = nextScale;
      animationEventEmitter.emitParamsChanged(name, { intensityScale: nextScale });

      const handle = playbackRunners.get(name)?.clipHandle;
      if (handle?.setWeight) {
        try { handle.setWeight(nextScale); } catch {}
      }
      updateHostClipParams(name, { weight: nextScale });
    },

    setSnippetBlendMode(name: string, mode: 'replace' | 'additive') {
      const snippet = getSnippet(name);
      if (!snippet) return;
      const nextMode = mode === 'additive' ? 'additive' : 'replace';
      if (snippet.snippetBlendMode !== nextMode) {
        snippet.snippetBlendMode = nextMode;
        animationEventEmitter.emitParamsChanged(name, { blendMode: nextMode });
      }
    },

    setSnippetBalance(name: string, balance: number) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      const nextBalance = Math.max(-1, Math.min(1, Number.isFinite(balance) ? balance : 0));
      if (Math.abs(snippet.snippetBalance - nextBalance) > 0.001) {
        snippet.snippetBalance = nextBalance;
        animationEventEmitter.emitParamsChanged(name, { balance: nextBalance });
        if (snippet.isPlaying) {
          restartSnippetPlayback(name);
        }
      }
    },

    setSnippetEasing(name: string, easing: import('./types').EasingType) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      if (snippet.snippetEasing !== easing) {
        snippet.snippetEasing = easing;
        animationEventEmitter.emitParamsChanged(name, { easing });
      }
    },

    setSnippetPriority(name: string, priority: number) {
      const snippet = getSnippet(name);
      if (snippet) {
        snippet.snippetPriority = Number.isFinite(priority) ? priority : 0;
      }
    },

    setSnippetLoopMode(name: string, mode: 'repeat' | 'once' | 'pingpong') {
      const snippet = getSnippet(name);
      if (!snippet) return;
      snippet.mixerLoopMode = mode;
      snippet.loop = mode !== 'once';
      animationEventEmitter.emitParamsChanged(name, { mixerLoopMode: mode, loop: snippet.loop });

      const handle = playbackRunners.get(name)?.clipHandle;
      if (handle?.setLoop) {
        try { handle.setLoop(mode, snippet.mixerRepeatCount); } catch {}
      }
      updateHostClipParams(name, { loopMode: mode, repeatCount: snippet.mixerRepeatCount });
    },

    setSnippetRepeatCount(name: string, repeatCount?: number) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      const nextRepeatCount =
        typeof repeatCount === 'number' && repeatCount >= 0 ? repeatCount : undefined;
      snippet.mixerRepeatCount = nextRepeatCount;
      animationEventEmitter.emitParamsChanged(name, { repeatCount: nextRepeatCount });

      const handle = playbackRunners.get(name)?.clipHandle;
      if (handle?.setLoop) {
        try { handle.setLoop(snippet.mixerLoopMode ?? (snippet.loop ? 'repeat' : 'once'), nextRepeatCount); } catch {}
      }
      updateHostClipParams(name, { repeatCount: nextRepeatCount });
    },

    setSnippetReverse(name: string, reverse: boolean) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      snippet.mixerReverse = !!reverse;
      animationEventEmitter.emitParamsChanged(name, { reverse: !!reverse });

      const handle = playbackRunners.get(name)?.clipHandle;
      if (handle?.setPlaybackRate) {
        const signedRate = (snippet.mixerReverse ? -1 : 1) * (snippet.snippetPlaybackRate ?? 1);
        try { handle.setPlaybackRate(signedRate); } catch {}
      }
      updateHostClipParams(name, { reverse: !!reverse, rate: snippet.snippetPlaybackRate });
    },

    setSnippetPlaying(name: string, nextPlaying: boolean) {
      const snippet = getSnippet(name);
      if (!snippet) return;

      snippet.isPlaying = !!nextPlaying;
      if (nextPlaying) {
        resumeSnippetPlayback(name);
      } else {
        pauseSnippetPlayback(name);
      }
      animationEventEmitter.emitPlayStateChanged(name, !!nextPlaying);
    },

    setSnippetTime(name: string, tSec: number) {
      const time = Math.max(0, tSec || 0);
      if (seekSnippetPlayback(name, time)) {
        animationEventEmitter.emitSnippetSeeked(name, time);
      }
    },

    setSnippetLoopState(name: string, iteration: number, localTime?: number) {
      const snippet = getSnippet(name);
      if (!snippet) return;
      snippet.loopIteration = Math.max(0, iteration);
      if (typeof localTime === 'number') snippet.lastLoopTime = localTime;
    },

    pauseSnippet(name: string) {
      return pauseSnippetPlayback(name);
    },

    resumeSnippet(name: string) {
      return resumeSnippetPlayback(name);
    },

    restartSnippet(name: string) {
      return restartSnippetPlayback(name);
    },

    stopSnippet(name: string) {
      stopPlaybackRunner(name, true);
      sched.delete(name);
      snippets = snippets.filter((entry) => entry.name !== name);
      return true;
    },

    onTransition(cb: (snapshot: any) => void) {
      const sub = animationEventEmitter.events.subscribe(() => {
        cb(api.getState());
      });
      return () => sub.unsubscribe();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const name of Array.from(playbackRunners.keys())) {
        stopPlaybackRunner(name, true);
      }
      playing = false;
      bakedEngine = null;
      animationEventEmitter.emitBakedClipsLoaded([]);
    },

    debug() {
      snippets.forEach((animation, index) => {
        void animation;
        void index;
      });
    },

    setBakedAnimationEngine(engine: BakedAnimationEngine) {
      bakedEngine = engine;
      const clips = engine.getAnimationClips?.() || [];
      animationEventEmitter.emitBakedClipsLoaded(clips.map((clip) => ({
        name: clip.name,
        duration: clip.duration,
        channels: clip.channels ?? [],
      })));
      clips.forEach((clip) => {
        animationEventEmitter.updateBakedAnimationState(clip.name, mergeBakedState(clip.name));
      });
      const playingAnimations = engine.getPlayingAnimations?.() || [];
      playingAnimations.forEach((state) => {
        animationEventEmitter.updateBakedAnimationState(
          state.name,
          toBakedUIState(getBakedClipInfo(state.name), toBakedStatePatch(state)),
        );
      });
    },

    playBakedAnimation(
      clipName: string,
      options?: Parameters<BakedAnimationEngine['playAnimation']>[1],
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
      if (options?.blendMode) nextPatch.requestedBlendMode = options.blendMode;
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
      bakedEngine?.setAnimationBlendMode?.(clipName, mode);
      const engineState = getCurrentBakedEngineState(clipName);
      const nextState = mergeBakedState(clipName, {
        ...toBakedStatePatch(engineState),
        requestedBlendMode: mode,
        blendMode: engineState?.blendMode ?? mode,
      });
      animationEventEmitter.updateBakedAnimationState(clipName, nextState);
      animationEventEmitter.emitBakedAnimationParamsChanged(clipName, {
        blendMode: nextState.blendMode,
      });
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
      const playingAnimations = animationEventEmitter.getPlayingBakedAnimations();
      bakedEngine.stopAllAnimations?.();
      for (const animation of playingAnimations) {
        animationEventEmitter.emitBakedAnimationStopped(animation.name);
      }
    },

    getBakedClips() {
      return animationEventEmitter.getBakedClips();
    },

    getPlayingBakedAnimations() {
      return animationEventEmitter.getPlayingBakedAnimations();
    },
  } as const;

  if (typeof window !== 'undefined' && isRuntimeDebugEnabled()) {
    (window as any).anim = api;
  }

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
    loopIteration: sn.loopIteration,
    loopDirection: sn.loopDirection,
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
    requestedBlendMode: state?.requestedBlendMode ?? state?.blendMode ?? 'replace',
    blendMode: state?.blendMode ?? 'replace',
    balance: Math.max(-1, Math.min(1, Number.isFinite(state?.balance) ? state?.balance ?? 0 : 0)),
    category: 'baked',
    easing: state?.easing ?? 'linear',
    channels: state?.channels ?? clip.channels ?? [],
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
    blendMode: state.requestedBlendMode,
  };
}

function cloneRawSnippet(snippet: NormalizedSnippet): NormalizedSnippet {
  const interpretation = snippet.aiExpressionMetadata?.interpretation;

  return {
    ...snippet,
    curves: Object.fromEntries(
      Object.entries(snippet.curves || {}).map(([curveId, points]) => [
        curveId,
        points.map((point) => ({ ...point })),
      ]),
    ),
    snippetBalanceMap: { ...(snippet.snippetBalanceMap || {}) },
    cursor: { ...(snippet.cursor || {}) },
    aiExpressionMetadata: snippet.aiExpressionMetadata
      ? {
          ...snippet.aiExpressionMetadata,
          interpretation: interpretation
            ? {
                ...interpretation,
                aus: { ...(interpretation.aus || {}) },
                notesByAu: interpretation.notesByAu
                  ? { ...interpretation.notesByAu }
                  : undefined,
              }
            : interpretation,
        }
          : undefined,
  };
}

function bakedChannelsEqual(a: BakedAnimationUIState['channels'], b: BakedAnimationUIState['channels']) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].channel !== b[i].channel) return false;
    if (a[i].trackCount !== b[i].trackCount) return false;
    if (a[i].playable !== b[i].playable) return false;
    if (a[i].blendMode !== b[i].blendMode) return false;
  }
  return true;
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
 * React hooks subscribe to events and read the service-owned UI state on demand.
 * Runtime playback stays in Loom3; these events are frontend notifications.
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
    return this._getSnippets().map(cloneRawSnippet);
  }

  /** Get a single raw snippet with curve data */
  getRawSnippet(name: string): NormalizedSnippet | null {
    if (!this._getSnippets) return null;
    const snippet = this._getSnippets().find((entry) => entry.name === name);
    return snippet ? cloneRawSnippet(snippet) : null;
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

  emitSnippetUpdated(snippetName: string) {
    this.event$.next({
      type: 'SNIPPET_UPDATED',
      snippetName,
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
      if (e.type === 'SNIPPET_UPDATED' && e.snippetName === snippetName) return true;
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
        a.loopIteration === b.loopIteration &&
        a.loopDirection === b.loopDirection &&
        a.reverse === b.reverse &&
        a.duration === b.duration &&
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
    filter((e) => {
      if (e.type === 'KEYFRAME_COMPLETED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_SEEKED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_LOOPED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_COMPLETED' && e.snippetName === snippetName) return true;
      if (e.type === 'SNIPPET_PLAY_STATE_CHANGED' && e.snippetName === snippetName) return true;
      return false;
    }),
    map(e => {
      if (e.type === 'KEYFRAME_COMPLETED') return e.currentTime;
      if (e.type === 'SNIPPET_SEEKED') return e.time;
      if (e.type === 'SNIPPET_LOOPED') return e.localTime;
      return animationEventEmitter.getSnippet(snippetName)?.currentTime ?? 0;
    }),
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
        if (a[i].requestedBlendMode !== b[i].requestedBlendMode) return false;
        if (a[i].blendMode !== b[i].blendMode) return false;
        if (a[i].balance !== b[i].balance) return false;
        if (a[i].easing !== b[i].easing) return false;
        if (!bakedChannelsEqual(a[i].channels, b[i].channels)) return false;
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
        a.requestedBlendMode === b.requestedBlendMode &&
        a.blendMode === b.blendMode &&
        a.balance === b.balance &&
        a.easing === b.easing &&
        bakedChannelsEqual(a.channels, b.channels)
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
