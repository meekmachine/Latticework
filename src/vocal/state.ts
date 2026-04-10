/**
 * Vocal State Store
 *
 * Reactive state management using most-subject for the vocal agency.
 * Follows the same pattern as the gaze agency state store.
 */

import { create } from 'most-subject';
import type { VocalState, VisemeId } from './types';

const DEFAULT_STATE: VocalState = {
  isSpeaking: false,
  currentWord: null,
  currentViseme: null,
  snippetName: null,
  startTime: null,
};

interface Sink<T> {
  event(time: number, value: T): void;
  end(time: number): void;
}

export class VocalStateStore {
  private sink: Sink<VocalState>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stream$: any;
  private current: VocalState = DEFAULT_STATE;

  constructor() {
    const [sink, stream] = create<VocalState>();
    this.sink = sink;
    this.stream$ = stream;
  }

  get state$() {
    return this.stream$;
  }

  get snapshot(): VocalState {
    return this.current;
  }

  setSpeaking(isSpeaking: boolean) {
    this.setState({ ...this.current, isSpeaking });
  }

  setCurrentWord(word: string | null) {
    this.setState({ ...this.current, currentWord: word });
  }

  setCurrentViseme(visemeId: VisemeId | null) {
    this.setState({ ...this.current, currentViseme: visemeId });
  }

  setSnippetName(name: string | null) {
    this.setState({ ...this.current, snippetName: name });
  }

  startSpeaking(snippetName: string) {
    this.setState({
      ...this.current,
      isSpeaking: true,
      snippetName,
      startTime: Date.now(),
    });
  }

  stopSpeaking() {
    this.setState({
      ...this.current,
      isSpeaking: false,
      currentWord: null,
      currentViseme: null,
      snippetName: null,
      startTime: null,
    });
  }

  private setState(next: VocalState) {
    this.current = next;
    this.sink.event(Date.now(), next);
  }

  dispose() {
    this.sink.end(Date.now());
  }
}
