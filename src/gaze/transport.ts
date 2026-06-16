import { create } from 'most-subject';
import type { GazeClock, GazeTarget } from './types';

export interface GazeTransport {
  sendTarget(target: GazeTarget): Promise<void>;
  events$: { stream: any };
  dispose(): void;
}

export class NoopTransport implements GazeTransport {
  private sink;
  public events$;
  private clock?: GazeClock;
  constructor(clock?: GazeClock) {
    const [sink, stream] = create<{ type: string; payload?: any }>();
    this.sink = sink;
    this.events$ = { stream };
    this.clock = clock;
  }
  async sendTarget(_target: GazeTarget): Promise<void> {
    this.sink.event(this.clock?.now() ?? Date.now(), { type: 'noop', payload: _target });
  }
  dispose(): void {
    this.sink.end(this.clock?.now() ?? Date.now());
  }
}
