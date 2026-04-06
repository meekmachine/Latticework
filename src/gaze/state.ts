import { create } from 'most-subject';
import type { GazeState, GazeTarget, GazeMode } from './types';

const DEFAULT_STATE: GazeState = {
  target: { x: 0, y: 0, z: 0 },
  mode: 'manual',
  isActive: false,
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

  setTarget(target: GazeTarget) {
    this.setState({ ...this.current, target });
  }

  setMode(mode: GazeMode) {
    this.setState({ ...this.current, mode });
  }

  setActive(isActive: boolean) {
    this.setState({ ...this.current, isActive });
  }

  private setState(next: GazeState) {
    this.current = next;
    this.sink.event(Date.now(), next);
  }

  dispose() {
    this.sink.end(Date.now());
  }
}
