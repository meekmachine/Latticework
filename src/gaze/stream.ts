// Minimal push-based stream to avoid RxJS dependency in the experimental gaze agency.
// Provides subscribe/next/complete similar to a very small Subject.

export type Listener<T> = (value: T) => void;

export class PushStream<T> {
  private listeners = new Set<Listener<T>>();

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  next(value: T) {
    for (const fn of this.listeners) {
      try {
        fn(value);
      } catch {
        // swallow subscriber errors to avoid breaking other listeners
      }
    }
  }

  complete() {
    this.listeners.clear();
  }
}
