import { create } from 'most-subject';
import type { GazeTarget } from './types';

export interface GazeTransport {
  sendTarget(target: GazeTarget): Promise<void>;
  events$: { stream: any };
  dispose(): void;
}

export class NoopTransport implements GazeTransport {
  private sink;
  public events$;
  constructor() {
    const [sink, stream] = create<{ type: string; payload?: any }>();
    this.sink = sink;
    this.events$ = { stream };
  }
  async sendTarget(_target: GazeTarget): Promise<void> {
    this.sink.event(Date.now(), { type: 'noop', payload: _target });
  }
  dispose(): void {
    this.sink.end(Date.now());
  }
}
