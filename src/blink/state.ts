import { create } from 'most-subject';
import type { BlinkState } from './types';
import { DEFAULT_BLINK_STATE } from './types';

interface Sink<T> {
  event(time: number, value: T): void;
  end(time: number): void;
}

export class BlinkStateStore {
  private sink: Sink<BlinkState>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stream$: any;
  private current: BlinkState = { ...DEFAULT_BLINK_STATE };
  private _lastBlinkTime: number | null = null;
  private _scheduledBlinkCount = 0;
  private listeners = new Set<(state: BlinkState) => void>();

  constructor() {
    const [sink, stream] = create<BlinkState>();
    this.sink = sink;
    this.stream$ = stream;
  }

  get state$() {
    return this.stream$;
  }

  get snapshot(): BlinkState {
    return this.current;
  }

  get lastBlinkTime(): number | null {
    return this._lastBlinkTime;
  }

  get scheduledBlinkCount(): number {
    return this._scheduledBlinkCount;
  }

  subscribe(listener: (state: BlinkState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enable() {
    this.setState({ ...this.current, enabled: true });
  }

  disable() {
    this.setState({ ...this.current, enabled: false });
  }

  setFrequency(frequency: number) {
    this.setState({
      ...this.current,
      frequency: Math.max(0, Math.min(60, frequency)),
    });
  }

  setDuration(duration: number) {
    this.setState({
      ...this.current,
      duration: Math.max(0.05, Math.min(1.0, duration)),
    });
  }

  setIntensity(intensity: number) {
    this.setState({
      ...this.current,
      intensity: Math.max(0, Math.min(1, intensity)),
    });
  }

  setRandomness(randomness: number) {
    this.setState({
      ...this.current,
      randomness: Math.max(0, Math.min(1, randomness)),
    });
  }

  setLeftEyeIntensity(intensity: number | null) {
    this.setState({
      ...this.current,
      leftEyeIntensity: intensity === null ? null : Math.max(0, Math.min(1, intensity)),
    });
  }

  setRightEyeIntensity(intensity: number | null) {
    this.setState({
      ...this.current,
      rightEyeIntensity: intensity === null ? null : Math.max(0, Math.min(1, intensity)),
    });
  }

  recordBlink() {
    this._lastBlinkTime = Date.now();
    this._scheduledBlinkCount++;
  }

  resetToDefault() {
    this._lastBlinkTime = null;
    this._scheduledBlinkCount = 0;
    this.setState({ ...DEFAULT_BLINK_STATE });
  }

  private setState(next: BlinkState) {
    this.current = next;
    this.sink.event(Date.now(), next);
    this.listeners.forEach((listener) => {
      listener(next);
    });
  }

  dispose() {
    this.listeners.clear();
    this.sink.end(Date.now());
  }
}
