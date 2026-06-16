import { create } from 'most-subject';
import type { GazeResolvedConfig, GazeState, GazeTarget, GazeMode } from './types';

export const DEFAULT_GAZE_CONFIG: GazeResolvedConfig = {
  eyesEnabled: true,
  headEnabled: true,
  headFollowEyes: true,
  mirrored: false,
  smoothFactor: 0.25,
  minDelta: 0.01,
  transitionDurationMs: 300,
  eyeIntensity: 1.0,
  headIntensity: 0.5,
  useTransport: false,
  runtime: null,
  engine: undefined,
  clock: undefined,
};

const DEFAULT_STATE: GazeState = {
  rawTarget: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  lastAppliedTarget: { x: 0, y: 0, z: 0 },
  mode: 'manual',
  isActive: false,
  isApplied: false,
  config: DEFAULT_GAZE_CONFIG,
};

interface Sink<T> {
  event(time: number, value: T): void;
  end(time: number): void;
}

export class GazeStateStore {
  private sink: Sink<GazeState>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stream$: any;
  private current: GazeState = DEFAULT_STATE;

  constructor() {
    const [sink, stream] = create<GazeState>();
    this.sink = sink;
    this.stream$ = stream;
  }

  get state$() {
    return this.stream$;
  }

  get snapshot(): GazeState {
    return this.current;
  }

  setTarget(target: GazeTarget, rawTarget = target) {
    this.setState({ ...this.current, rawTarget, target });
  }

  setLastAppliedTarget(lastAppliedTarget: GazeTarget, isApplied = true) {
    this.setState({ ...this.current, lastAppliedTarget, isApplied });
  }

  setMode(mode: GazeMode) {
    this.setState({ ...this.current, mode });
  }

  setActive(isActive: boolean) {
    this.setState({ ...this.current, isActive });
  }

  setConfig(config: GazeResolvedConfig) {
    this.setState({ ...this.current, config });
  }

  setState(next: GazeState) {
    this.current = next;
    this.sink.event(next.config.clock?.now() ?? Date.now(), next);
  }

  dispose() {
    this.sink.end(this.current.config.clock?.now() ?? Date.now());
  }
}
