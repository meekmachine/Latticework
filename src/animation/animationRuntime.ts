import { Effect } from 'effect';
import type { Engine, ScheduleOpts, ClipHandle, NormalizedSnippet } from './types';

export type AnimationRuntimeEvents = {
  onSnippetCompleted?: (name: string) => void;
  onPlayStateChanged?: (name: string, isPlaying: boolean) => void;
  onKeyframeCompleted?: (data: {
    snippetName: string;
    keyframeIndex: number;
    totalKeyframes: number;
    currentTime: number;
    duration: number;
  }) => void;
};

type RuntimeSched = { name: string; startsAt: number; offset: number; enabled: boolean };

type SchedulerCurvePoint = { time: number; intensity: number; inherit?: boolean };

type PlaybackRunner = {
  snippetName: string;
  active: boolean;
  paused: boolean;
  clipHandle?: ClipHandle;
  stopPromise: Promise<void>;
  stopResolve: () => void;
  seekTime?: number;
};

const isNumericId = (value: string) => /^[0-9]+$/.test(value);
const EYE_HEAD_IDS = {
  yawNeg: '61',
  yawPos: '62',
  pitchPos: '63',
  pitchNeg: '64',
};

function normalizeCurves(input?: Record<string, Array<{ t?: number; v?: number; time?: number; intensity?: number; inherit?: boolean }>>): Record<string, SchedulerCurvePoint[]> {
  const out: Record<string, SchedulerCurvePoint[]> = {};
  if (!input) return out;
  for (const [key, arr] of Object.entries(input)) {
    const safe = Array.isArray(arr) ? arr : [];
    const norm = safe.map((k: any) => ({
      time: typeof k.time === 'number' ? k.time : (typeof k.t === 'number' ? k.t : 0),
      intensity: typeof k.intensity === 'number' ? k.intensity : (typeof k.v === 'number' ? k.v : 0),
      inherit: !!k.inherit,
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
    (sn?.au ?? []).forEach((k: any) => {
      const key = String(k.id);
      (mapped[key] ||= []).push({
        time: k.t ?? k.time ?? 0,
        intensity: k.v ?? k.intensity ?? 0,
        inherit: !!k.inherit,
      });
    });
    (sn?.viseme ?? []).forEach((k: any) => {
      const key = String(k.key);
      (mapped[key] ||= []).push({
        time: k.t ?? k.time ?? 0,
        intensity: k.v ?? k.intensity ?? 0,
        inherit: !!k.inherit,
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

export class AnimationRuntime {
  private host: Engine;
  private events?: AnimationRuntimeEvents;
  private snippets: NormalizedSnippet[] = [];
  private sched = new Map<string, RuntimeSched>();
  private playing = false;
  private playTimeSec = 0;
  private ended = new Set<string>();
  private playbackRunners = new Map<string, PlaybackRunner>();
  private pendingClipParams = new Map<string, { weight?: number; rate?: number; loopMode?: 'once' | 'repeat' | 'pingpong'; repeatCount?: number; reverse?: boolean }>();

  constructor(host: Engine, events?: AnimationRuntimeEvents) {
    this.host = host;
    this.events = events;
  }

  getSnippets() {
    return this.snippets;
  }

  private getSnippetByName(snippetName: string) {
    return this.snippets.find((s) => s.name === snippetName) ?? null;
  }

  private upsertSnippet(sn: NormalizedSnippet, isPlaying: boolean) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const next = { ...sn, isPlaying, startWallTime: now };
    const idx = this.snippets.findIndex((s) => s.name === next.name);
    if (idx >= 0) {
      const arr = this.snippets.slice();
      arr[idx] = next;
      this.snippets = arr;
      return;
    }
    this.snippets = [...this.snippets, next];
  }

  private ensureSched(snName: string) {
    if (!this.sched.has(snName)) this.sched.set(snName, { name: snName, startsAt: 0, offset: 0, enabled: true });
    return this.sched.get(snName)!;
  }

  private sampleCurveAt(arr: SchedulerCurvePoint[], t: number) {
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

  private getEyeHeadSeekTime(sn: NormalizedSnippet) {
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

    const currentYaw = this.getCurrentValue(yawPos) - this.getCurrentValue(yawNeg);
    const currentPitch = this.getCurrentValue(pitchPos) - this.getCurrentValue(pitchNeg);

    let bestTime = samples[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const t of samples) {
      const yaw = this.sampleCurveAt(yawPosCurve, t) - this.sampleCurveAt(yawNegCurve, t);
      const pitch = this.sampleCurveAt(pitchPosCurve, t) - this.sampleCurveAt(pitchNegCurve, t);
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

  private totalDuration(sn: NormalizedSnippet) {
    const curves = sn.curves || {};
    if (!Object.keys(curves).length) return 0;
    return Math.max(0, ...Object.values(curves).map(arr => arr.length ? arr[arr.length - 1].time : 0));
  }

  private eyeHeadUsesInheritedStart(sn: NormalizedSnippet) {
    if (sn.snippetCategory !== 'eyeHeadTracking') return false;
    return Object.values(sn.curves || {}).some((arr) => !!arr?.[0]?.inherit);
  }

  private getKeyframeTimes(sn: NormalizedSnippet) {
    const times = new Set<number>();
    times.add(0);
    for (const arr of Object.values(sn.curves || {})) {
      for (const kf of arr) {
        const t = typeof kf.time === 'number' ? kf.time : 0;
        if (Number.isFinite(t)) times.add(Math.max(0, t));
      }
    }
    return Array.from(times).sort((a, b) => a - b);
  }

  private findKeyframeIndex(times: number[], currentTime: number) {
    if (!times.length) return -1;
    const target = Math.max(0, currentTime) + 1e-3;
    let lo = 0;
    let hi = times.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= target) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return idx;
  }

  private async trackKeyframes(
    snippetName: string,
    runner: PlaybackRunner,
    clipHandle: ClipHandle,
    keyframeTimes: number[],
    duration: number
  ) {
    if (!keyframeTimes.length) return;
    const totalKeyframes = keyframeTimes.length;
    let lastIndex = -1;
    const tickMs = 40;

    while (runner.active && runner.clipHandle === clipHandle) {
      if (!runner.paused) {
        const currentTime = clipHandle.getTime();
        const nextIndex = this.findKeyframeIndex(keyframeTimes, currentTime);
        if (nextIndex !== lastIndex) {
          lastIndex = nextIndex;
          const snUpdate = this.getSnippetByName(snippetName);
          if (snUpdate) snUpdate.currentTime = currentTime;
          this.events?.onKeyframeCompleted?.({
            snippetName,
            keyframeIndex: Math.max(0, nextIndex),
            totalKeyframes,
            currentTime,
            duration,
          });
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, tickMs));
    }
  }

  loadFromJSON(data: any) {
    const sn = normalizeSnippet(data);
    this.upsertSnippet(sn, false);
    return sn.name;
  }

  schedule(data: any, opts: ScheduleOpts = {}) {
    const sn = normalizeSnippet(data);
    if (typeof opts.priority === 'number') sn.snippetPriority = opts.priority;

    // autoPlay snippets are always marked as playing regardless of global state
    const shouldPlay = opts.autoPlay || this.playing;
    this.upsertSnippet(sn, shouldPlay);

    const rt = this.ensureSched(sn.name);
    const tPlay = this.playing ? this.playTimeSec : 0;
    const relStart = (typeof opts.startAtSec === 'number')
      ? Math.max(0, opts.startAtSec)
      : Math.max(0, tPlay + (opts.startInSec ?? 0));
    rt.startsAt = relStart;
    rt.offset = opts.offsetSec ?? 0;
    rt.enabled = true;
    this.sched.set(sn.name, rt);

    // Start playback if global playing OR if autoPlay is requested
    if (shouldPlay && sn.name) {
      this.startPlaybackRunner(sn.name);
    }

    return sn.name;
  }

  remove(name: string) {
    this.stopPlaybackRunner(name, true);
    this.pendingClipParams.delete(name);
    this.snippets = this.snippets.filter((s) => s.name !== name);
    this.ended.delete(name);
    try { this.host.cleanupSnippet?.(name); } catch {}
  }

  enable(name: string, on = true) {
    const rt = this.ensureSched(name);
    rt.enabled = !!on;

    const sn = this.getSnippetByName(name);
    if (sn) sn.isPlaying = !!on;

    if (!on) {
      this.pausePlaybackRunner(name);
      this.events?.onPlayStateChanged?.(name, false);
      return;
    }

    if (this.playing) {
      this.startPlaybackRunner(name);
      this.events?.onPlayStateChanged?.(name, true);
    }
  }

  play() {
    if (this.playing) return;
    this.playing = true;

    for (const sn of this.snippets) {
      const rt = this.ensureSched(sn.name);
      if (!rt.enabled) continue;
      sn.isPlaying = true;
      this.startPlaybackRunner(sn.name);
      this.events?.onPlayStateChanged?.(sn.name, true);
    }
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;

    for (const sn of this.snippets) {
      sn.isPlaying = false;
    }

    for (const [name] of this.playbackRunners) {
      this.pausePlaybackRunner(name);
      this.events?.onPlayStateChanged?.(name, false);
    }
  }

  stop() {
    this.playing = false;
    this.playTimeSec = 0;
    for (const [name] of this.playbackRunners) {
      this.stopPlaybackRunner(name, true);
      this.pendingClipParams.delete(name);
    }
    this.pendingClipParams.clear();
    this.sched.forEach((r) => { r.enabled = false; r.startsAt = 0; r.offset = 0; });
    for (const sn of this.snippets) {
      sn.isPlaying = false;
    }
  }

  isPlaying() {
    return !!this.playing;
  }

  seek(name: string, offsetSec: number) {
    const seekTime = Math.max(0, offsetSec);
    const rt = this.ensureSched(name);
    rt.startsAt = this.playTimeSec;
    rt.offset = seekTime;
    rt.enabled = true;
    this.ended.delete(name);

    const sn = this.getSnippetByName(name);
    if (sn) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const rate = sn.snippetPlaybackRate || 1;
      sn.currentTime = seekTime;
      sn.startWallTime = now - (seekTime / rate) * 1000;
      sn.isPlaying = true;
    }

    this.seekClipTo(name, seekTime);
  }

  pauseSnippet(name: string) {
    const rt = this.ensureSched(name);
    rt.enabled = false;
    this.pausePlaybackRunner(name);
    const sn = this.getSnippetByName(name);
    if (sn) sn.isPlaying = false;
  }

  resumeSnippet(name: string) {
    const rt = this.ensureSched(name);
    rt.enabled = true;
    if (this.playbackRunners.has(name)) {
      this.resumePlaybackRunner(name);
    } else if (this.playing) {
      this.startPlaybackRunner(name);
    }
    const sn = this.getSnippetByName(name);
    if (sn) sn.isPlaying = true;
  }

  restartSnippet(name: string) {
    this.stopPlaybackRunner(name, true);
    const rt = this.ensureSched(name);
    rt.enabled = true;
    this.startPlaybackRunner(name);
    const sn = this.getSnippetByName(name);
    if (sn) sn.isPlaying = true;
  }

  stopSnippet(name: string) {
    const rt = this.ensureSched(name);
    rt.enabled = false;
    rt.startsAt = 0;
    rt.offset = 0;
    this.stopPlaybackRunner(name, true);
    this.pendingClipParams.delete(name);
    this.snippets = this.snippets.filter((s) => s.name !== name);
    this.ended.add(name);
  }

  updateSnippetParams(name: string, params: { weight?: number; rate?: number; loopMode?: 'once' | 'repeat' | 'pingpong'; repeatCount?: number; reverse?: boolean }) {
    const current = this.pendingClipParams.get(name) || {};
    const next = { ...current, ...params };
    this.pendingClipParams.set(name, next);

    const sn = this.getSnippetByName(name);
    if (sn) {
      if (next.loopMode) {
        sn.mixerLoopMode = next.loopMode;
        sn.loop = next.loopMode !== 'once';
      }
      if (typeof next.repeatCount === 'number') sn.mixerRepeatCount = next.repeatCount;
      if (typeof next.rate === 'number') sn.snippetPlaybackRate = next.rate;
      if (typeof next.weight === 'number') sn.snippetIntensityScale = next.weight;
      if (typeof next.reverse === 'boolean') sn.mixerReverse = next.reverse;
    }

    const runner = this.playbackRunners.get(name);
    const handle = runner?.clipHandle as any;
    const weightChanged = typeof params.weight === 'number' && params.weight !== current.weight;

    if (weightChanged && runner && this.host.buildClip) {
      const seekTime = handle?.getTime?.() ?? sn?.currentTime ?? 0;
      const wasPaused = runner.paused;
      this.stopPlaybackRunner(name, true);
      this.startPlaybackRunner(name, { seekTime, paused: wasPaused });
      return;
    }

    const { weight: _weight, ...clipParams } = next;
    if (this.host.updateClipParams && Object.keys(clipParams).length > 0) {
      try { this.host.updateClipParams(name, { ...clipParams, actionId: handle?.actionId }); } catch {}
    }
    if (handle?.setPlaybackRate && typeof next.rate === 'number') {
      const signedRate = next.reverse ? -next.rate : next.rate;
      try { handle.setPlaybackRate(signedRate); } catch {}
    }
    if (handle?.setLoop && next.loopMode) {
      try { handle.setLoop(next.loopMode as any, next.repeatCount); } catch {}
    }
  }

  getScheduleSnapshot() {
    return this.snippets.map((sn) => {
      const name = sn.name || '';
      const rt = this.ensureSched(name);
      const rate = sn.snippetPlaybackRate ?? 1;
      const dur = this.totalDuration(sn);
      const runner = this.playbackRunners.get(name);
      const local = runner?.clipHandle?.getTime?.() ?? sn.currentTime ?? 0;
      const loopMode = sn.mixerLoopMode ?? (sn.loop ? 'repeat' : 'once');
      return {
        name,
        enabled: rt.enabled,
        startsAt: rt.startsAt,
        offset: rt.offset,
        localTime: local,
        duration: dur,
        loop: loopMode !== 'once',
        priority: sn.snippetPriority ?? 0,
        playbackRate: rate,
        intensityScale: sn.snippetIntensityScale ?? 1,
      };
    });
  }

  getCurrentValue(auId: string): number {
    if (this.host.getAU && isNumericId(auId)) {
      try { return this.host.getAU(Number(auId)); } catch {}
    }
    return 0;
  }

  dispose() {
    for (const [name] of this.playbackRunners) {
      try { this.stopPlaybackRunner(name, true); } catch {}
    }
    try { this.stop(); } catch {}
  }

  private startPlaybackRunner(snippetName: string, opts: { seekTime?: number; paused?: boolean } = {}) {
    this.stopPlaybackRunner(snippetName, false);

    const sn = this.getSnippetByName(snippetName);
    if (!sn || !sn.curves) return;

    if (!this.host.buildClip) {
      console.error(`[Runtime] buildClip not available - cannot play "${snippetName}"`);
      return;
    }

    let stopResolve = () => {};
    const stopPromise = new Promise<void>((resolve) => { stopResolve = resolve; });
    const autoSeekTime = (opts.seekTime === undefined && sn.snippetCategory === 'eyeHeadTracking' && !this.eyeHeadUsesInheritedStart(sn))
      ? this.getEyeHeadSeekTime(sn)
      : undefined;
    const seekTime = typeof opts.seekTime === 'number' && Number.isFinite(opts.seekTime)
      ? Math.max(0, opts.seekTime)
      : (typeof autoSeekTime === 'number' ? autoSeekTime : undefined);
    const runner: PlaybackRunner = {
      snippetName,
      active: true,
      paused: !!opts.paused,
      stopPromise,
      stopResolve,
      seekTime,
    };
    this.playbackRunners.set(snippetName, runner);

    Effect.runFork(Effect.sync(() => {
      void this.runClipBasedPlayback(snippetName, runner);
    }));
  }

  private async runClipBasedPlayback(snippetName: string, runner: PlaybackRunner): Promise<void> {
    const sn = this.getSnippetByName(snippetName);
    if (!sn || !sn.curves) {
      this.playbackRunners.delete(snippetName);
      return;
    }

    const pendingParams = this.pendingClipParams.get(snippetName) || {};
    const rate = pendingParams.rate ?? sn.snippetPlaybackRate ?? 1;
    const reverse = pendingParams.reverse ?? sn.mixerReverse ?? false;
    const signedRate = reverse ? -rate : rate;
    // Weight slider maps to clip intensity scale (mixer weight stays separate).
    const scale = pendingParams.weight ?? (sn.snippetIntensityScale ?? 1);
    const mixerWeight = typeof sn.mixerWeight === 'number' ? sn.mixerWeight : undefined;
    const balance = sn.snippetBalance ?? 0;
    const balanceMap = sn.snippetBalanceMap ?? {};
    const jawScale = sn.snippetJawScale ?? 1.0;
    const loopMode = pendingParams.loopMode || sn.mixerLoopMode || (sn.loop ? 'repeat' : 'once');
    const repeatCount = pendingParams.repeatCount ?? sn.mixerRepeatCount;

    const clipCurves: Record<string, Array<{ time: number; intensity: number }>> = {};
    const applyInherit = (curveId: string, arr: Array<{ time: number; intensity: number; inherit?: boolean }>) => {
      const baseCurve = arr.map(({ time, intensity }) => ({ time, intensity }));
      if (!arr.length) return baseCurve;
      const first = arr[0];

      if (sn.snippetCategory === 'eyeHeadTracking') {
        if (first?.inherit) {
          const base = this.getCurrentValue(curveId);
          const next = baseCurve.slice();
          next[0] = { ...next[0], intensity: base };
          return next;
        }
        if ((loopMode as any) !== 'once' && baseCurve.length > 1) {
          const firstIntensity = baseCurve[0].intensity;
          const lastIdx = baseCurve.length - 1;
          if (Math.abs(baseCurve[lastIdx].intensity - firstIntensity) > 1e-4) {
            baseCurve[lastIdx] = { ...baseCurve[lastIdx], intensity: firstIntensity };
          }
        }
        return baseCurve;
      }

      if (!first?.inherit) return baseCurve;

      const base = this.getCurrentValue(curveId);
      const offset = base - (first.intensity ?? 0);
      return arr.map(({ time, intensity }) => ({ time, intensity: (intensity ?? 0) + offset }));
    };

    for (const [curveId, arr] of Object.entries(sn.curves)) {
      clipCurves[curveId] = applyInherit(curveId, arr);
    }

    const useVisemeCategory = sn.snippetCategory === 'visemeSnippet' || sn.snippetCategory === 'combined';
    const snippetCategory = useVisemeCategory ? 'visemeSnippet' : undefined;
    const hasJawCurve = Object.prototype.hasOwnProperty.call(sn.curves || {}, '26');
    const autoVisemeJawOverride =
      typeof (sn as any).autoVisemeJaw === 'boolean' ? (sn as any).autoVisemeJaw : undefined;
    const autoVisemeJaw = autoVisemeJawOverride ?? (hasJawCurve ? false : undefined);

    const clipHandle = this.host.buildClip(
      snippetName,
      clipCurves,
      {
        loopMode: loopMode as any,
        reverse,
        playbackRate: signedRate,
        balance,
        balanceMap: balanceMap as any,
        jawScale,
        mixerWeight,
        repeatCount,
        intensityScale: scale,
        snippetCategory,
        autoVisemeJaw,
      } as any
    );

    if (!clipHandle) {
      console.error(`[Runtime] buildClip failed for "${snippetName}"`);
      try { this.host.cleanupSnippet?.(snippetName); } catch {}
      this.playbackRunners.delete(snippetName);
      return;
    }

    this.applyPendingClipParams(snippetName, clipHandle);
    runner.clipHandle = clipHandle;
    clipHandle.play();
    if (typeof runner.seekTime === 'number') {
      try { clipHandle.setTime(runner.seekTime); } catch {}
      if (sn) sn.currentTime = runner.seekTime;
    }
    if (runner.paused) {
      try { clipHandle.pause(); } catch {}
    }

    const keyframeTimes = this.getKeyframeTimes(sn);
    void this.trackKeyframes(snippetName, runner, clipHandle, keyframeTimes, clipHandle.getDuration());

    const expectEnd = loopMode === 'once' || (typeof repeatCount === 'number' && Number.isFinite(repeatCount));

    try {
      if (expectEnd) {
        await Promise.race([
          clipHandle.finished.catch(() => undefined),
          this.waitForClipEnd(clipHandle, runner, clipHandle.getDuration()),
          runner.stopPromise,
        ]);
      } else {
        await Promise.race([clipHandle.finished.catch(() => undefined), runner.stopPromise]);
      }
    } catch {}

    const finalTime = clipHandle.getTime();
    const snUpdate = this.getSnippetByName(snippetName);
    if (snUpdate) snUpdate.currentTime = finalTime;
    runner.clipHandle = undefined;

    if (runner.active) {
      this.ended.add(snippetName);
      if (snUpdate) snUpdate.isPlaying = false;
      this.events?.onSnippetCompleted?.(snippetName);
      this.events?.onPlayStateChanged?.(snippetName, false);
      try { this.host.onSnippetEnd?.(snippetName); } catch {}
    }

    this.playbackRunners.delete(snippetName);
  }

  private async waitForClipEnd(clipHandle: ClipHandle, runner: PlaybackRunner, durationSec: number) {
    const targetTime = Math.max(0, durationSec);
    const tickMs = 40;
    while (runner.active && runner.clipHandle === clipHandle) {
      if (!runner.paused) {
        const currentTime = clipHandle.getTime();
        if (currentTime >= targetTime - 1e-3) return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, tickMs));
    }
  }

  private stopPlaybackRunner(snippetName: string, cleanupHost: boolean) {
    const runner = this.playbackRunners.get(snippetName);
    if (!runner) {
      if (cleanupHost) {
        try { this.host.cleanupSnippet?.(snippetName); } catch {}
      }
      return;
    }

    runner.active = false;
    runner.stopResolve();

    if (runner.clipHandle) {
      try { runner.clipHandle.stop(); } catch {}
      runner.clipHandle = undefined;
    }

    this.playbackRunners.delete(snippetName);

    if (cleanupHost) {
      try { this.host.cleanupSnippet?.(snippetName); } catch {}
    }
  }

  private pausePlaybackRunner(snippetName: string) {
    const runner = this.playbackRunners.get(snippetName);
    if (!runner) return;
    runner.paused = true;
    if (runner.clipHandle) {
      try { runner.clipHandle.pause(); } catch {}
    }
  }

  private resumePlaybackRunner(snippetName: string) {
    const runner = this.playbackRunners.get(snippetName);
    if (!runner) return;
    runner.paused = false;
    if (runner.clipHandle) {
      try { runner.clipHandle.resume(); } catch {}
    }
  }

  private applyPendingClipParams(name: string, handle?: ClipHandle) {
    const pending = this.pendingClipParams.get(name);
    if (!pending) return;

    const { weight: _weight, ...clipParams } = pending;
    if (this.host.updateClipParams && Object.keys(clipParams).length > 0) {
      try { this.host.updateClipParams(name, { ...clipParams, actionId: handle?.actionId }); } catch {}
    }

    if (handle) {
      if (handle.setPlaybackRate && typeof pending.rate === 'number') {
        const signedRate = pending.reverse ? -pending.rate : pending.rate;
        try { handle.setPlaybackRate(signedRate); } catch {}
      }
      if (handle.setLoop && pending.loopMode) {
        try { handle.setLoop(pending.loopMode as any, pending.repeatCount); } catch {}
      }
    }
  }

  private seekClipTo(name: string, timeSec: number) {
    let runner = this.playbackRunners.get(name);
    let handle = runner?.clipHandle;

    if (!handle && this.host.buildClip) {
      const sn = this.getSnippetByName(name);
      if (sn?.curves) {
        const applyInherit = (curveId: string, arr: Array<{ time: number; intensity: number; inherit?: boolean }>) => {
          const baseCurve = arr.map(({ time, intensity }) => ({ time, intensity }));
          if (!arr.length) return baseCurve;
          const first = arr[0];
          if (sn.snippetCategory === 'eyeHeadTracking') {
            if (first?.inherit) {
              const base = this.getCurrentValue(curveId);
              const next = baseCurve.slice();
              next[0] = { ...next[0], intensity: base };
              return next;
            }
            return baseCurve;
          }
          if (!first?.inherit) return baseCurve;
          const base = this.getCurrentValue(curveId);
          const offset = base - (first.intensity ?? 0);
          return arr.map(({ time, intensity }) => ({ time, intensity: (intensity ?? 0) + offset }));
        };
        const clipCurves: Record<string, Array<{ time: number; intensity: number }>> = {};
        for (const [curveId, arr] of Object.entries(sn.curves)) {
          clipCurves[curveId] = applyInherit(curveId, arr);
        }

        const playbackRate = sn.snippetPlaybackRate ?? 1;
        const loopMode = sn.mixerLoopMode ?? (sn.loop ? 'repeat' : 'once');
        const balance = sn.snippetBalance ?? 0;
        const balanceMap = sn.snippetBalanceMap ?? {};
        const jawScale = sn.snippetJawScale ?? 1.0;
        const scale = sn.snippetIntensityScale ?? 1;
        const mixerWeight = typeof sn.mixerWeight === 'number' ? sn.mixerWeight : undefined;
        const useVisemeCategory = sn.snippetCategory === 'visemeSnippet' || sn.snippetCategory === 'combined';
        const snippetCategory = useVisemeCategory ? 'visemeSnippet' : undefined;
        const hasJawCurve = Object.prototype.hasOwnProperty.call(sn.curves || {}, '26');
        const autoVisemeJawOverride =
          typeof (sn as any).autoVisemeJaw === 'boolean' ? (sn as any).autoVisemeJaw : undefined;
        const autoVisemeJaw = autoVisemeJawOverride ?? (hasJawCurve ? false : undefined);
        handle = this.host.buildClip(name, clipCurves, {
          loopMode,
          repeatCount: sn.mixerRepeatCount,
          reverse: sn.mixerReverse ?? false,
          playbackRate,
          balance,
          balanceMap: balanceMap as any,
          jawScale,
          mixerWeight,
          intensityScale: scale,
          snippetCategory,
          autoVisemeJaw,
        } as any);
        if (handle) {
          try { handle.pause(); } catch {}
          if (!runner) {
            let stopResolve = () => {};
            const stopPromise = new Promise<void>((resolve) => { stopResolve = resolve; });
            runner = {
              snippetName: name,
              active: false,
              paused: true,
              stopPromise,
              stopResolve,
            };
          }
          runner.clipHandle = handle;
          runner.active = false;
          runner.paused = true;
          this.playbackRunners.set(name, runner);
        }
      }
    }

    if (handle?.setTime) {
      try { handle.setTime(timeSec); } catch {}
    }
  }
}
