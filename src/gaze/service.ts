import { Effect, Ref } from 'effect';
import { create } from 'most-subject';
import type {
  GazeApplyOptions,
  GazeCommand,
  GazeConfig,
  GazeEvent,
  GazeMode,
  GazePlan,
  GazePlanInput,
  GazeResolvedConfig,
  GazeRuntimeCommand,
  GazeRuntimeResetOptions,
  GazeSetTargetResult,
  GazeState,
  GazeTarget,
} from './types';
import { DEFAULT_GAZE_CONFIG, GazeStateStore } from './state';
import { createEngineGazeRuntime } from './runtime';
import { NoopTransport, type GazeTransport } from './transport';

interface Sink<T> {
  event(time: number, value: T): void;
  end(time: number): void;
}

export function resolveGazeConfig(config: Partial<GazeConfig> = {}): GazeResolvedConfig {
  return {
    ...DEFAULT_GAZE_CONFIG,
    ...config,
    runtime: config.runtime ?? DEFAULT_GAZE_CONFIG.runtime,
    engine: config.engine ?? DEFAULT_GAZE_CONFIG.engine,
    clock: config.clock ?? DEFAULT_GAZE_CONFIG.clock,
  };
}

export function planGazeTarget(input: GazePlanInput): GazePlan {
  const rawTarget = {
    x: input.config.mirrored ? -input.target.x : input.target.x,
    y: input.target.y,
    z: input.target.z ?? 0,
  };
  const previous = input.previousTarget;
  const distance = Math.hypot(rawTarget.x - previous.x, rawTarget.y - previous.y);
  const baseAlpha = Math.max(0, input.config.smoothFactor ?? DEFAULT_GAZE_CONFIG.smoothFactor);
  const alpha = baseAlpha >= 1 ? 1 : Math.min(0.7, baseAlpha + distance * 0.25);
  const target = {
    x: previous.x + (rawTarget.x - previous.x) * alpha,
    y: previous.y + (rawTarget.y - previous.y) * alpha,
    z: rawTarget.z,
  };
  const delta = Math.hypot(target.x - previous.x, target.y - previous.y);
  const accepted = !!input.force || delta >= (input.config.minDelta ?? DEFAULT_GAZE_CONFIG.minDelta);

  return {
    rawTarget,
    target,
    accepted,
    eyeDuration: Math.round(120 + delta * 300),
    headDuration: Math.round(180 + delta * 400),
  };
}

/**
 * Modern gaze agency facade.
 *
 * State and lifecycle refs are Effect-managed while Most streams carry external
 * state/event transport. Runtime output goes through a GazeRuntime adapter so
 * gaze can mix with other animation agencies instead of directly owning engine
 * side effects.
 */
export class GazeService {
  private store = new GazeStateStore();
  private transport: GazeTransport;
  private configRef: Ref.Ref<GazeResolvedConfig>;
  private lastAppliedTargetRef: Ref.Ref<GazeTarget>;
  private stateRef: Ref.Ref<GazeState>;
  private disposedRef: Ref.Ref<boolean>;
  private eventSink: Sink<GazeEvent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private eventStream$: any;

  constructor(config?: Partial<GazeConfig>, transport?: GazeTransport) {
    const resolved = resolveGazeConfig(config);
    this.transport = transport || new NoopTransport(resolved.clock);
    this.configRef = Ref.unsafeMake(resolved);
    this.lastAppliedTargetRef = Ref.unsafeMake<GazeTarget>({ x: 0, y: 0, z: 0 });
    this.disposedRef = Ref.unsafeMake(false);
    this.stateRef = Ref.unsafeMake(this.store.snapshot);
    const [eventSink, eventStream] = create<GazeEvent>();
    this.eventSink = eventSink;
    this.eventStream$ = eventStream;
    this.store.setConfig(resolved);
    this.setState(this.store.snapshot);
  }

  get state$() {
    return this.store.state$;
  }

  get events$() {
    return this.eventStream$;
  }

  get snapshot(): GazeState {
    return Effect.runSync(Ref.get(this.stateRef));
  }

  handle(command: GazeCommand): GazeSetTargetResult | void {
    switch (command.type) {
      case 'set-target':
        return this.setTarget(command.target, command.options);
      case 'set-mode':
        this.setMode(command.mode);
        return;
      case 'set-active':
        this.setActive(command.active);
        return;
      case 'update-config':
        this.updateConfig(command.config);
        return;
      case 'reset':
        this.reset(command.durationMs);
        return;
      case 'dispose':
        this.dispose();
        return;
    }
  }

  updateConfig(config: Partial<GazeConfig>) {
    const current = Effect.runSync(Ref.get(this.configRef));
    const next = resolveGazeConfig({ ...current, ...config });
    Effect.runSync(Ref.set(this.configRef, next));
    this.store.setConfig(next);
    this.setState(this.store.snapshot);
    this.emit({ type: 'config-updated', config: next, timestamp: this.now(next) });
  }

  setMode(mode: GazeMode) {
    this.store.setMode(mode);
    this.setState(this.store.snapshot);
    this.emit({ type: 'mode-changed', mode, timestamp: this.now() });
  }

  setActive(active: boolean) {
    this.store.setActive(active);
    this.setState(this.store.snapshot);
    this.emit({ type: 'active-changed', active, timestamp: this.now() });
  }

  setTarget(target: GazeTarget, options: GazeApplyOptions = {}): GazeSetTargetResult {
    const config = Effect.runSync(Ref.get(this.configRef));
    const timestamp = this.now(config);
    const disposed = Effect.runSync(Ref.get(this.disposedRef));
    const previousTarget = Effect.runSync(Ref.get(this.lastAppliedTargetRef));
    const plan = planGazeTarget({
      target,
      previousTarget,
      config,
      force: options.force,
    });

    if (disposed) {
      return this.toResult(plan, false);
    }

    this.emit({ type: 'target-received', target, timestamp });
    this.store.setTarget(plan.target, plan.rawTarget);

    if (!this.isEnabled(config, options)) {
      this.setState({ ...this.store.snapshot, isApplied: false });
      this.emit({
        type: 'target-ignored',
        rawTarget: plan.rawTarget,
        target: plan.target,
        reason: 'disabled',
        timestamp,
      });
      return this.toResult(plan, false);
    }

    this.emit({
      type: 'target-planned',
      rawTarget: plan.rawTarget,
      target: plan.target,
      eyeDuration: plan.eyeDuration,
      headDuration: plan.headDuration,
      timestamp,
    });

    if (!plan.accepted) {
      this.setState({ ...this.store.snapshot, isApplied: false });
      this.emit({
        type: 'target-ignored',
        rawTarget: plan.rawTarget,
        target: plan.target,
        reason: 'min-delta',
        timestamp,
      });
      return this.toResult(plan, false);
    }

    const command = this.toRuntimeCommand(plan, config, options);
    this.emit({ type: 'runtime-command', command, timestamp });
    const applied = this.applyRuntime(command, config);
    if (applied) {
      Effect.runSync(Ref.set(this.lastAppliedTargetRef, plan.target));
      this.store.setLastAppliedTarget(plan.target, true);
      this.emit({ type: 'runtime-applied', command, timestamp });
    } else {
      this.setState({ ...this.store.snapshot, isApplied: false });
      this.emit({ type: 'runtime-skipped', command, timestamp });
    }
    this.setState(this.store.snapshot);

    return this.toResult(plan, applied);
  }

  reset(durationMs = 300, options: GazeRuntimeResetOptions = {}): boolean {
    const config = Effect.runSync(Ref.get(this.configRef));
    const runtime = config.runtime ?? createEngineGazeRuntime(config.engine);
    const resetEyes = options.eyes ?? true;
    const resetHead = options.head ?? true;
    const shouldMarkNeutral = resetEyes && resetHead;
    const applied = runtime?.reset?.(durationMs, { eyes: resetEyes, head: resetHead }) ?? false;
    if (typeof (applied as Promise<boolean>)?.then === 'function') {
      void (applied as Promise<boolean>)
        .then((wasApplied) => {
          if (wasApplied && shouldMarkNeutral) {
            this.markResetApplied();
          }
        })
        .catch((error) => {
          this.emit({ type: 'error', error, timestamp: this.now() });
        });
      return true;
    }

    if (applied === true && shouldMarkNeutral) {
      this.markResetApplied();
    }

    return applied === true;
  }

  dispose() {
    const config = Effect.runSync(Ref.get(this.configRef));
    const disposed = Effect.runSync(Ref.get(this.disposedRef));
    if (disposed) {
      return;
    }

    Effect.runSync(Ref.set(this.disposedRef, true));
    const timestamp = this.now(config);
    this.emit({ type: 'disposed', timestamp });
    this.eventSink.end(timestamp);
    config.runtime?.dispose?.();
    this.transport.dispose();
    this.store.dispose();
  }

  private applyRuntime(command: GazeRuntimeCommand, config: GazeResolvedConfig): boolean {
    try {
      const runtime = config.runtime ?? createEngineGazeRuntime(config.engine);
      if (runtime) {
        const applied = runtime.apply(command);
        if (typeof (applied as Promise<boolean>)?.then === 'function') {
          void (applied as Promise<boolean>).catch((error) => {
            this.emit({ type: 'error', error, timestamp: this.now() });
          });
          return true;
        }
        return applied === true;
      }

      if (config.useTransport) {
        void this.transport.sendTarget(command.target).catch((error) => {
          this.emit({ type: 'error', error, timestamp: this.now() });
        });
        return true;
      }
    } catch (error) {
      this.emit({ type: 'error', error, timestamp: this.now(config) });
    }

    return false;
  }

  private toRuntimeCommand(
    plan: GazePlan,
    config: GazeResolvedConfig,
    options: GazeApplyOptions
  ): GazeRuntimeCommand {
    return {
      target: plan.target,
      rawTarget: plan.rawTarget,
      mode: this.store.snapshot.mode,
      eyeEnabled: options.eyeEnabled ?? config.eyesEnabled,
      headEnabled: options.headEnabled ?? config.headEnabled,
      headFollowEyes: options.headFollowEyes ?? config.headFollowEyes,
      eyeIntensity: config.eyeIntensity,
      headIntensity: config.headIntensity,
      eyeDuration: plan.eyeDuration,
      headDuration: plan.headDuration,
    };
  }

  private toResult(plan: GazePlan, applied: boolean): GazeSetTargetResult {
    return {
      accepted: plan.accepted,
      applied,
      rawTarget: plan.rawTarget,
      target: plan.target,
      eyeDuration: plan.eyeDuration,
      headDuration: plan.headDuration,
    };
  }

  private isEnabled(config: GazeResolvedConfig, options: GazeApplyOptions): boolean {
    const eyesEnabled = options.eyeEnabled ?? config.eyesEnabled;
    const headEnabled = options.headEnabled ?? config.headEnabled;
    return eyesEnabled || headEnabled;
  }

  private setState(state: GazeState) {
    Effect.runSync(Ref.set(this.stateRef, state));
  }

  private markResetApplied() {
    const neutral = { x: 0, y: 0, z: 0 };
    Effect.runSync(Ref.set(this.lastAppliedTargetRef, neutral));
    this.store.setTarget(neutral);
    this.store.setLastAppliedTarget(neutral, true);
    this.setState(this.store.snapshot);
  }

  private emit(event: GazeEvent) {
    this.eventSink.event(event.timestamp, event);
  }

  private now(config?: GazeResolvedConfig): number {
    const activeConfig = config ?? Effect.runSync(Ref.get(this.configRef));
    return activeConfig.clock?.now() ?? Date.now();
  }
}
