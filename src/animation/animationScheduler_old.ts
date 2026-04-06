import type { Snippet, Engine, ScheduleOpts, ClipHandle } from './types';
import type { TransitionHandle } from '@lovelace_lol/loom3';

export type AnimationSchedulerEvents = {
  onSnippetCompleted?: (name: string) => void;
  onPlayStateChanged?: (name: string, isPlaying: boolean) => void;
};

type RuntimeSched = { name: string; startsAt: number; offset: number; enabled: boolean };

/**
 * Active playback runner for a snippet.
 * Tracks the clip-based playback using Three.js mixer.
 */
type PlaybackRunner = {
  /** Name of the snippet this runner belongs to */
  snippetName: string;
  /** Set to false to stop the playback loop */
  active: boolean;
  /** Pause flag for playback */
  paused: boolean;
  /** Currently active TransitionHandles (unused, kept for interface compat) */
  handles: TransitionHandle[];
  /** ClipHandle when using buildClip() */
  clipHandle?: ClipHandle;
  /** Promise that resolves when the runner completes or is stopped */
  promise: Promise<void>;
  /** Optional seek time to apply when starting the clip */
  seekTime?: number;
};

const isNumericId = (value: string) => /^[0-9]+$/.test(value);

type SchedulerCurvePoint = { time: number; intensity: number; inherit?: boolean };

export function normalize(sn: any): Snippet & { curves: Record<string, SchedulerCurvePoint[]> } {
  if (sn && sn.curves) {
    const curves: Record<string, SchedulerCurvePoint[]> = {};
    Object.entries<any[]>(sn.curves).forEach(([key, arr]) => {
      curves[key] = arr.map((k: any) => ({
        time: k.time ?? k.t ?? 0,
        intensity: k.intensity ?? k.v ?? 0,
        inherit: !!k.inherit
      }));
    });
    const mixerLoopMode = sn.mixerLoopMode ?? (sn.loop ? 'repeat' : 'once');
    return {
      name: sn.name ?? `sn_${Date.now()}`,
      loop: mixerLoopMode !== 'once',
      snippetCategory: sn.snippetCategory ?? 'default',
      snippetPriority: sn.snippetPriority ?? 0,
      snippetPlaybackRate: sn.snippetPlaybackRate ?? 1,
      snippetIntensityScale: sn.snippetIntensityScale ?? 1,
      snippetBlendMode: sn.snippetBlendMode ?? 'replace',  // Default to 'replace' for backward compatibility
      snippetJawScale: sn.snippetJawScale ?? 1.0,  // Jaw bone activation for viseme snippets
      snippetBalance: sn.snippetBalance ?? 0,  // Global L/R balance for bilateral AUs
      snippetBalanceMap: sn.snippetBalanceMap ?? {},  // Per-AU balance overrides
      snippetEasing: sn.snippetEasing ?? 'linear',  // Easing function for interpolation
      mixerLoopMode,
      mixerReverse: sn.mixerReverse ?? false,
      curves
    } as any;
  }

  const curves: Record<string, SchedulerCurvePoint[]> = {};
  (sn.au ?? []).forEach((k: any) => {
    const key = String(k.id);
    (curves[key] ||= []).push({
      time: k.t ?? k.time ?? 0,
      intensity: k.v ?? k.intensity ?? 0,
      inherit: !!k.inherit
    });
  });
  (sn.viseme ?? []).forEach((k: any) => {
    const key = String(k.key);
    (curves[key] ||= []).push({
      time: k.t ?? k.time ?? 0,
      intensity: k.v ?? k.intensity ?? 0,
      inherit: !!k.inherit
    });
  });
  Object.values(curves).forEach(arr => arr.sort((a, b) => a.time - b.time));

  const mixerLoopMode = sn.mixerLoopMode ?? (sn.loop ? 'repeat' : 'once');
  return {
    name: sn.name ?? `sn_${Date.now()}`,
    loop: mixerLoopMode !== 'once',
    snippetCategory: sn.snippetCategory ?? 'default',
    snippetPriority: sn.snippetPriority ?? 0,
    snippetPlaybackRate: sn.snippetPlaybackRate ?? 1,
    snippetIntensityScale: sn.snippetIntensityScale ?? 1,
    snippetBlendMode: sn.snippetBlendMode ?? 'replace',
    snippetJawScale: sn.snippetJawScale ?? 1.0,
    snippetBalance: sn.snippetBalance ?? 0,
    snippetBalanceMap: sn.snippetBalanceMap ?? {},
    snippetEasing: sn.snippetEasing ?? 'linear',
    mixerLoopMode,
    mixerReverse: sn.mixerReverse ?? false,
    curves
  } as any;
}

/**
 * @deprecated Legacy scheduler retained as a fallback.
 * Prefer animationRuntime (clip-based mixer playback) for new work.
 */
export class AnimationSchedulerOld {
  private host: Engine;
  private machine: any;
  private events?: AnimationSchedulerEvents;
  private sched = new Map<string, RuntimeSched>();
  private playing = false;
  private playTimeSec = 0;
  /** Track snippets already notified as completed to avoid duplicate callbacks */
  private ended = new Set<string>();
  /** Active playback runners per snippet - legacy path uses time-based delays between keyframes */
  private playbackRunners = new Map<string, PlaybackRunner>();
  /** Latest requested clip params per snippet so slider updates stick even if no handle yet. */
  private pendingClipParams = new Map<string, { weight?: number; rate?: number; loopMode?: 'once' | 'repeat' | 'pingpong'; repeatCount?: number; reverse?: boolean }>();

  // Defensive: ensure actor is running before any send, recover if stopped
  private ensureActorRunning() {
    try {
      // XState v5 actors expose .start(); safe to call if already running (no-op)
      if (this.machine?.start) this.machine.start();
    } catch {}
  }
  private safeSend(evt: any) {
    try {
      this.ensureActorRunning();
      this.machine?.send?.(evt);
    } catch {
      // Try one more time after forcing a start (covers "stopped actor" edge)
      try { this.machine?.start?.(); this.machine?.send?.(evt); } catch {}
    }
  }

  constructor(machine: any, host: Engine, events?: AnimationSchedulerEvents) {
    this.machine = machine;
    this.host = host;
    this.events = events;
    this.ensureActorRunning();
  }

  // ============================================================================
  // PLAYBACK SYSTEM
  // Each playing snippet gets an async runner that:
  // 1. Extracts keyframe times from curves
  // 2. Fires transitions at each keyframe boundary
  // 3. Waits for the keyframe duration to fire the next transition
  // 4. Completion and looping are handled by the mixer action
  // ============================================================================

  /**
   * Start an async playback runner for a snippet.
   * Prefers buildClip() when available (entire clip built upfront, mixer handles interpolation).
   * Falls back to keyframe-by-keyframe transitions for backwards compatibility.
   */
  private startPlaybackRunner(snippetName: string, opts: { seekTime?: number; paused?: boolean } = {}) {
    // Stop any existing runner for this snippet
    this.stopPlaybackRunner(snippetName, false);

    // Get snippet from machine context
    const sn = this.getSnippetByName(snippetName);
    if (!sn || !sn.curves) return;

    // Create runner and add to map
    const seekTime = typeof opts.seekTime === 'number' && Number.isFinite(opts.seekTime)
      ? Math.max(0, opts.seekTime)
      : undefined;
    const runner: PlaybackRunner = {
      snippetName,
      active: true,
      paused: !!opts.paused,
      handles: [],
      promise: Promise.resolve(), // Placeholder, will be replaced
      seekTime,
    };

    this.playbackRunners.set(snippetName, runner);

    // Use buildClip() - mixer handles all interpolation
    if (!this.host.buildClip) {
      console.error(`[Scheduler] ✗ buildClip not available - cannot play "${snippetName}"`);
      this.playbackRunners.delete(snippetName); // avoid leaving a runner with no clip handle
      return;
    }
    //
    runner.promise = this.runClipBasedPlayback(snippetName, runner);
  }

  /**
   * Get a snippet from the machine context by name.
   */
  private getSnippetByName(snippetName: string): (Snippet & { curves: Record<string, SchedulerCurvePoint[]> }) | null {
    try {
      const st = this.machine.getSnapshot?.();
      const arr = st?.context?.animations as any[] || [];
      return arr.find((s: any) => s?.name === snippetName) ?? null;
    } catch { return null; }
  }

  /**
   * Run clip-based playback using buildClip().
   * Builds entire clip upfront and lets Three.js mixer handle all interpolation.
   */
  private async runClipBasedPlayback(snippetName: string, runner: PlaybackRunner): Promise<void> {
    const sn = this.getSnippetByName(snippetName);
    if (!sn || !sn.curves) {
      this.playbackRunners.delete(snippetName);
      return;
    }

    const curves = sn.curves as Record<string, SchedulerCurvePoint[]>;
    const pendingParams = this.pendingClipParams.get(snippetName) || {};
    const rate = pendingParams.rate ?? sn.snippetPlaybackRate ?? 1;
    const reverse = pendingParams.reverse ?? (sn as any).mixerReverse ?? false;
    const signedRate = reverse ? -rate : rate;
    const scale = pendingParams.weight ?? (sn.snippetIntensityScale ?? 1);
    const balance = (sn as any).snippetBalance ?? 0;
    const balanceMap = (sn as any).snippetBalanceMap ?? {};
    const jawScale = (sn as any).snippetJawScale ?? 1.0;
    const mixerWeight = typeof (sn as any).mixerWeight === 'number' ? (sn as any).mixerWeight : undefined;
    const loopMode = pendingParams.loopMode || (sn as any).mixerLoopMode || ((sn.loop ?? false) ? 'repeat' : 'once');
    const repeatCount = pendingParams.repeatCount ?? (sn as any).mixerRepeatCount;

    const clipCurves: Record<string, Array<{ time: number; intensity: number; inherit?: boolean }>> = {};
    for (const [curveId, arr] of Object.entries(curves)) {
      clipCurves[curveId] = arr.map(kf => ({
        time: kf.time,
        intensity: kf.intensity,
        inherit: kf.inherit,
      }));
    }

    const useVisemeCategory =
      sn.snippetCategory === 'visemeSnippet' || sn.snippetCategory === 'combined';
    const snippetCategory = useVisemeCategory ? 'visemeSnippet' : undefined;
    const clipName = snippetName;
    const clipHandle = this.host.buildClip!(
      clipName,
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
      } as any
    );

    if (!clipHandle) {
      console.error(`[Scheduler] buildClip failed for "${snippetName}" - mixer controls unavailable`);
      // Cleanup any stale mixer actions for this name to avoid ghosts
      try { this.host.cleanupSnippet?.(snippetName); } catch {}
      this.playbackRunners.delete(snippetName);
      return;
    }

    this.applyPendingClipParams(snippetName, clipHandle);
    runner.clipHandle = clipHandle;
    clipHandle.play();
    if (typeof runner.seekTime === 'number') {
      try { clipHandle.setTime(runner.seekTime); } catch {}
      if (sn) (sn as any).currentTime = runner.seekTime;
    }
    if (runner.paused) {
      try { clipHandle.pause(); } catch {}
    }

    const expectEnd = loopMode === 'once' || (typeof repeatCount === 'number' && Number.isFinite(repeatCount));
    try {
      if (expectEnd) {
        await Promise.race([
          clipHandle.finished.catch(() => undefined),
          this.waitForClipEnd(clipHandle, runner, clipHandle.getDuration()),
        ]);
      } else {
        await clipHandle.finished.catch(() => undefined);
      }
    } catch {
      // Clip was stopped/cancelled
    }

    const finalTime = clipHandle.getTime();
    const snUpdate = this.getSnippetByName(snippetName);
    if (snUpdate) {
      (snUpdate as any).currentTime = finalTime;
    }
    runner.clipHandle = undefined;

    if (runner.active) {
      this.ended.add(snippetName);
      if (snUpdate) (snUpdate as any).isPlaying = false;
      this.events?.onSnippetCompleted?.(snippetName);
      try { this.host.onSnippetEnd?.(snippetName); } catch {}
      // Notify UI that playback state ended so controls flip back to Play
      this.events?.onPlayStateChanged?.(snippetName, false);
    }

    this.playbackRunners.delete(snippetName);
  }

  /**
   * Fallback completion detection for mixer clips that never emit "finished".
   */
  private async waitForClipEnd(clipHandle: ClipHandle, runner: PlaybackRunner, durationSec: number) {
    const targetTime = Math.max(0, durationSec);
    const tickMs = 40;

    while (runner.active && runner.clipHandle === clipHandle) {
      if (!runner.paused) {
        const currentTime = clipHandle.getTime();
        if (currentTime >= targetTime - 1e-3) {
          return;
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, tickMs));
    }
  }

  /**
   * Stop the playback runner for a snippet.
   * Cancels all active transitions/clips and marks the runner as inactive.
   */
  private stopPlaybackRunner(snippetName: string, captureCurrent: boolean = false, cleanupHost: boolean = false) {
    const runner = this.playbackRunners.get(snippetName);
    void captureCurrent;
    if (!runner) {
      if (cleanupHost) {
        try { this.host.cleanupSnippet?.(snippetName); } catch {}
      }
      return;
    }

    runner.active = false;
    // Stop clip if using buildClip() path
    if (runner.clipHandle) {
      try { runner.clipHandle.stop(); } catch {}
      runner.clipHandle = undefined;
    }

    // Cancel any active transition handles
    for (const handle of runner.handles) {
      try { handle.cancel(); } catch {}
    }
    runner.handles = [];
    this.playbackRunners.delete(snippetName);

    if (cleanupHost) {
      try { this.host.cleanupSnippet?.(snippetName); } catch {}
    }
  }

  /**
   * Pause the playback runner for a snippet.
   */
  private pausePlaybackRunner(snippetName: string) {
    const runner = this.playbackRunners.get(snippetName);
    if (!runner) return;

    runner.paused = true;

    // Pause clip
    if (runner.clipHandle) {
      try { runner.clipHandle.pause(); } catch {}
    }

    // Pause any active transition handles
    for (const handle of runner.handles) {
      try { handle.pause(); } catch {}
    }
  }

  /**
   * Resume the playback runner for a snippet.
   */
  private resumePlaybackRunner(snippetName: string) {
    const runner = this.playbackRunners.get(snippetName);
    if (!runner) return;

    runner.paused = false;

    // Resume clip
    if (runner.clipHandle) {
      try { runner.clipHandle.resume(); } catch {}
    }

    // Resume any active transition handles
    for (const handle of runner.handles) {
      try { handle.resume(); } catch {}
    }
  }

  private currentSnippets() {
    return this.machine.getSnapshot().context.animations as any[] as Array<Snippet & { curves: Record<string, SchedulerCurvePoint[]> }>;
  }

  /** Expose current snippets for external state reads (UI/event emitter). */
  getSnippets() {
    return this.currentSnippets() as any;
  }

  /** Calculate duration from keyframes - find the latest keyframe time across all curves */
  private totalDuration(sn: Snippet) {
    const curves = (sn as any).curves || {};
    if (!Object.keys(curves).length) return 0;
    return Math.max(0, ...Object.values<any[]>(curves).map(arr => arr.length ? arr[arr.length - 1].time : 0));
  }

  private ensureSched(snName: string) {
    if (!this.sched.has(snName)) this.sched.set(snName, { name: snName, startsAt: 0, offset: 0, enabled: true });
    return this.sched.get(snName)!;
  }


  load(snippet: Snippet) {
    this.safeSend({ type: 'LOAD_ANIMATION', data: snippet });
    return snippet.name;
  }

  loadFromJSON(data: any) {
    const sn = normalize(data);
    return this.load(sn as any);
  }

  remove(name: string) {
    // Stop any active playback runner for this snippet
    this.stopPlaybackRunner(name, false, true);
    this.pendingClipParams.delete(name);
    this.safeSend({ type: 'REMOVE_ANIMATION', name });
    this.ended.delete(name);
    // Give host a chance to uncache/cleanup any mixer actions for this snippet name
    try { this.host.cleanupSnippet?.(name); } catch {}
  }

  schedule(data: any, opts: ScheduleOpts = {}) {
    const sn = normalize(data);
    if (typeof opts.priority === 'number') sn.snippetPriority = opts.priority;
    this.load(sn);

    const rt = this.ensureSched(sn.name || `sn_${Date.now()}`);
    // Play-time (seconds) since the last play() anchor. If not playing yet, treat as 0.
    const tPlay = this.playing ? this.playTimeSec : 0;
    // Respect explicit startAtSec if provided; otherwise schedule relative to current play-time plus startInSec.
    const relStart = (typeof opts.startAtSec === 'number')
      ? Math.max(0, opts.startAtSec)
      : Math.max(0, tPlay + (opts.startInSec ?? 0));
    rt.startsAt = relStart;
    rt.offset = opts.offsetSec ?? 0;
    rt.enabled = true;
    this.sched.set(sn.name || '', rt);

    // If already playing, start a playback runner for the new snippet immediately
    if (this.playing && sn.name) {
      this.startPlaybackRunner(sn.name);
    }

    return sn.name;
  }

  enable(name: string, on = true) {
    const r = this.sched.get(name);
    if (r) r.enabled = !!on;
    try {
      const st = this.machine.getSnapshot?.();
      const arr = st?.context?.animations as any[] || [];
      const sn = arr.find((s:any) => s?.name === name);
      if (sn) sn.isPlaying = !!on;
    } catch {}
  }

  /**
   * Seek to a specific time in a snippet and immediately apply the values.
   * This is used for scrubbing - values are applied instantly (no transitions).
   */
  seek(name: string, offsetSec: number) {
    const seekTime = Math.max(0, offsetSec);

    // Update runtime schedule
    const rt = this.ensureSched(name);
    rt.startsAt = this.playTimeSec;
    rt.offset = seekTime;
    rt.enabled = true;
    this.ended.delete(name);

    // Send SEEK_SNIPPET event to machine - this creates new state and triggers UI updates
    this.safeSend({ type: 'SEEK_SNIPPET', name, time: seekTime });

    const sn = this.getSnippetByName(name);
    if (sn) (sn as any).currentTime = seekTime;

    // Scrub the mixer clip if available (no per-AU application here).
    this.seekClipTo(name, seekTime);
  }

  /** Scrub a clip-backed snippet to a specific time without rebuilding AU logic. */
  private seekClipTo(name: string, timeSec: number) {
    let runner = this.playbackRunners.get(name);
    let handle = runner?.clipHandle;

    if (!handle && this.host.buildClip) {
      const sn = this.getSnippetByName(name);
      if (sn?.curves) {
        const playbackRate = sn.snippetPlaybackRate ?? 1;
        const loopMode = (sn as any).mixerLoopMode ?? (sn.loop ? 'repeat' : 'once');
        const balance = (sn as any).snippetBalance ?? 0;
        const balanceMap = (sn as any).snippetBalanceMap ?? {};
        handle = this.host.buildClip(name, sn.curves, {
          loopMode,
          repeatCount: (sn as any).mixerRepeatCount,
          reverse: (sn as any).mixerReverse ?? false,
          playbackRate,
          balance,
          balanceMap: balanceMap as any,
        } as any);
        if (handle) {
          try { handle.pause(); } catch {}
          if (!runner) {
            runner = {
              snippetName: name,
              active: false,
              paused: true,
              handles: [],
              promise: Promise.resolve(),
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

  play() {
    if (this.playing) return;
    this.playing = true;
    // Ensure state machine is playing before any tick
    this.safeSend({ type: 'PLAY_ALL' });

    // Start playback runners for all snippets marked as playing
    const snippets = this.currentSnippets();
    for (const sn of snippets) {
      if (sn.name && (sn as any).isPlaying !== false) {
        this.startPlaybackRunner(sn.name);
      }
    }
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.safeSend({ type: 'PAUSE_ALL' });

    // Pause all playback runners
    for (const [name] of this.playbackRunners) {
      this.pausePlaybackRunner(name);
    }
  }

  stop() {
    this.playing = false;
    this.playTimeSec = 0;
    // Stop all playback runners
    for (const [name] of this.playbackRunners) {
      this.stopPlaybackRunner(name, true, true);
      this.pendingClipParams.delete(name);
    }
    this.pendingClipParams.clear();
    // Clear all scheduled snippets
    this.sched.forEach((r) => { r.enabled = false; r.startsAt = 0; r.offset = 0; });
    this.safeSend({ type: 'STOP_ALL' });
  }

  /** Return playing state for external checks */
  isPlaying() {
    return !!this.playing;
  }

  dispose() {
    // Stop all playback runners first
    for (const [name] of this.playbackRunners) {
      try { this.stopPlaybackRunner(name); } catch {}
    }
    try { this.stop(); } catch {}
    try { this.machine?.stop?.(); } catch {}
  }
  /** Pause a single snippet without removing it. */
  pauseSnippet(name: string) {
    const rt = this.sched.get(name);
    if (rt) rt.enabled = false;
    // Pause the playback runner (pauses active TransitionHandles)
    this.pausePlaybackRunner(name);
    try {
      const st = this.machine.getSnapshot?.();
      const arr = st?.context?.animations as any[] || [];
      const sn = arr.find((s:any) => s?.name === name);
      if (sn) sn.isPlaying = false;
    } catch {}
  }

  /** Resume a previously paused snippet. */
  resumeSnippet(name: string) {
    const rt = this.sched.get(name) || this.ensureSched(name);
    rt.enabled = true;
    // Resume the playback runner (resumes active TransitionHandles)
    // If no runner exists, start a new one
    if (this.playbackRunners.has(name)) {
      this.resumePlaybackRunner(name);
    } else if (this.playing) {
      this.startPlaybackRunner(name);
    }
    try {
      const st = this.machine.getSnapshot?.();
      const arr = st?.context?.animations as any[] || [];
      const sn = arr.find((s:any) => s?.name === name);
      if (sn) sn.isPlaying = true;
    } catch {}
  }

  /** Restart a snippet's playback runner to rebuild clips using updated curves. */
  restartSnippet(name: string, captureCurrent: boolean = false) {
    this.stopPlaybackRunner(name, captureCurrent, true);
    const rt = this.sched.get(name) || this.ensureSched(name);
    rt.enabled = true;
    this.startPlaybackRunner(name);
    try {
      const st = this.machine.getSnapshot?.();
      const arr = st?.context?.animations as any[] || [];
      const sn = arr.find((s:any) => s?.name === name);
      if (sn) sn.isPlaying = true;
    } catch {}
  }

  /** Stop (cancel) a snippet and remove it from the machine. */
  stopSnippet(name: string) {
    const rt = this.sched.get(name);
    if (rt) { rt.enabled = false; rt.startsAt = 0; rt.offset = 0; }
    // Stop the playback runner (cancels active TransitionHandles)
    this.stopPlaybackRunner(name, false, true);
    this.pendingClipParams.delete(name);
    try { this.remove(name); } catch {}
    // Do not call onSnippetEnd here — this is an explicit user stop, not a natural completion.
    this.ended.add(name);
  }

  /** Live-update clip params (weight, playback rate, loop mode) without rebuilding when possible. */
  updateSnippetParams(name: string, params: { weight?: number; rate?: number; loopMode?: 'once' | 'repeat' | 'pingpong'; repeatCount?: number; reverse?: boolean }) {
    const current = this.pendingClipParams.get(name) || {};
    const next = { ...current, ...params };
    this.pendingClipParams.set(name, next);

    const sn = this.getSnippetByName(name);
    if (sn) {
      if (next.loopMode) {
        (sn as any).mixerLoopMode = next.loopMode;
        sn.loop = next.loopMode !== 'once';
      }
      if (typeof next.repeatCount === 'number') (sn as any).mixerRepeatCount = next.repeatCount;
      if (typeof next.rate === 'number') sn.snippetPlaybackRate = next.rate;
      if (typeof next.weight === 'number') sn.snippetIntensityScale = next.weight;
    }

    // Grab active runner/clip (if any) before attempting live mixer updates
    const runner = this.playbackRunners.get(name);
    const handle = runner?.clipHandle as any;

    // Debug trace so we can see every param update attempt
    try {
      console.log('[Scheduler] updateSnippetParams', {
        name,
        params: next,
        hasRunner: !!runner,
        hasHandle: !!handle,
        handleActionId: handle?.actionId
      });
    } catch {}

    // Try host-level update if supported (pass actionId when available)
    let updated = false;
    if (this.host.updateClipParams) {
      try { updated = this.host.updateClipParams(name, { ...next, actionId: handle?.actionId }); } catch { updated = false; }
      if (!updated) {
        try {
          console.warn('[Scheduler] host.updateClipParams returned false', { name, next, actionId: handle?.actionId });
        } catch {}
      }
    }

    // Also update the live clip handle if present (mixer action)
    if (handle?.setWeight && typeof next.weight === 'number') {
      try { handle.setWeight(next.weight); updated = true; } catch {}
    }
    if (handle?.setPlaybackRate && typeof next.rate === 'number') {
      const signedRate = next.reverse ? -next.rate : next.rate;
      try { handle.setPlaybackRate(signedRate); updated = true; } catch {}
    }
    if (handle?.setLoop && next.loopMode) {
      try { handle.setLoop(next.loopMode as any, next.repeatCount); updated = true; } catch {}
    }

    // No restarts here — mirror baked clips by updating the existing mixer action in place.
  }

  /** Apply any cached params to a clip handle (used when a clip is first created/looped). */
  private applyPendingClipParams(name: string, handle?: ClipHandle) {
    const pending = this.pendingClipParams.get(name);
    if (!pending) return;

    if (this.host.updateClipParams) {
      try { this.host.updateClipParams(name, { ...pending, actionId: handle?.actionId }); } catch {}
    }

    if (handle) {
      if (handle.setWeight && typeof pending.weight === 'number') {
        try { handle.setWeight(pending.weight); } catch {}
      }
      if (handle.setPlaybackRate && typeof pending.rate === 'number') {
        const signedRate = pending.reverse ? -pending.rate : pending.rate;
        try { handle.setPlaybackRate(signedRate); } catch {}
      }
      if (handle.setLoop && pending.loopMode) {
        try { handle.setLoop(pending.loopMode as any, pending.repeatCount); } catch {}
      }
    }
  }

  /** Introspection: snapshot of current schedule with computed local times. */
  getScheduleSnapshot() {
    const snippets = this.currentSnippets();
    return snippets.map(sn => {
      const name = sn.name || '';
      const rt = this.ensureSched(name);
      const rate = sn.snippetPlaybackRate ?? 1;
      const dur  = this.totalDuration(sn);
      const runner = this.playbackRunners.get(name);
      const local = runner?.clipHandle?.getTime?.() ?? (sn as any).currentTime ?? 0;

      const loopMode = (sn as any).mixerLoopMode ?? (sn.loop ? 'repeat' : 'once');
      return {
        name,
        enabled: rt.enabled,
        startsAt: rt.startsAt, // Keep for backwards compatibility
        offset: rt.offset,      // Keep for backwards compatibility
        localTime: local,
        duration: dur,
        loop: loopMode !== 'once',
        priority: sn.snippetPriority ?? 0,
        playbackRate: rate,
        intensityScale: sn.snippetIntensityScale ?? 1
      };
    });
  }

  /**
   * Get the current value of an AU or morph target.
   * This is the value that was most recently applied to the engine.
   * Useful for smooth continuity when scheduling new snippets that should
   * start from the current state instead of jumping back to 0.
   *
   * @param auId - AU ID as string (e.g., '31', '33', '61') or morph name
   * @returns Current value (0-1), or 0 if never applied
   */
  getCurrentValue(auId: string): number {
    if (this.host.getAU && isNumericId(auId)) {
      try { return this.host.getAU(Number(auId)); } catch {}
    }
    return 0;
  }
}
