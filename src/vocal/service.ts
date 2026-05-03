/**
 * Vocal Service
 *
 * Main service for lip sync / vocal animation.
 * Processes text/sentences into viseme sequences and schedules animation snippets.
 *
 * Architecture (sentence-level):
 * - One clip per sentence/utterance (not per word)
 * - Word boundaries used for sync verification, not clip creation
 * - Clean transitions without clip accumulation
 *
 * Follows the same pattern as the gaze service with:
 * - Most.js reactive state (via VocalStateStore)
 * - Engine-first approach with optional animation agency scheduling
 * - Clean, minimal API
 */

import type {
  VocalConfig,
  VocalSnippet,
  VocalTimeline,
  VocalWordTiming,
  VisemeEvent,
  WordTiming,
} from './types';
import { DEFAULT_VOCAL_CONFIG } from './types';
import { VocalStateStore } from './state';
import { textToVisemes, wordToVisemes } from './phonemes';
import { buildVocalSnippet } from './snippetBuilder';

/** Tracks a sentence being spoken */
interface SentenceContext {
  name: string;
  text: string;
  startTime: number;
  maxTime: number;
  wordIndex: number;
  wordTimings: VocalWordTiming[];
}

const WORD_SYNC_DRIFT_THRESHOLD_SEC = 0.06;

export class VocalService {
  private config: VocalConfig;
  private store = new VocalStateStore();
  private activeSnippets = new Set<string>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Sentence-level tracking
  private currentSentence: SentenceContext | null = null;

  constructor(config?: Partial<VocalConfig>) {
    this.config = {
      ...DEFAULT_VOCAL_CONFIG,
      ...config,
    };
  }

  /** Reactive state stream */
  get state$() {
    return this.store.state$;
  }

  /** Current state snapshot */
  get snapshot() {
    return this.store.snapshot;
  }

  /** Update configuration */
  updateConfig(config: Partial<VocalConfig>) {
    this.config = { ...this.config, ...config };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sentence-Level API (Preferred)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Start a precomputed utterance timeline.
   *
   * Provider timelines are already time-scaled, so snippet playback stays neutral.
   * Word timings are kept with the sentence context for drift correction.
   */
  startTimeline(timeline: VocalTimeline): string | null {
    if (timeline.visemes.length === 0) return null;

    if (this.currentSentence) {
      this.stopSentence();
    }

    const snippetName = timeline.name ?? this.buildTimelineName(timeline);
    const snippet = buildVocalSnippet(
      timeline.visemes,
      { ...this.config, speechRate: 1.0 },
      snippetName
    );

    if (typeof timeline.durationSec === 'number' && Number.isFinite(timeline.durationSec)) {
      snippet.maxTime = Math.max(snippet.maxTime, Math.max(0, timeline.durationSec));
    }

    console.log(
      `[Vocal] Built timeline snippet: source=${timeline.source ?? 'unknown'}, maxTime=${snippet.maxTime.toFixed(3)}s, curves=${Object.keys(snippet.curves).length}`
    );

    const name = this.scheduleSnippet(snippet, timeline.visemes);
    if (!name) return null;

    this.currentSentence = {
      name,
      text: timeline.text ?? timeline.name ?? `${timeline.source ?? 'external'}_visemes`,
      startTime: performance.now(),
      maxTime: snippet.maxTime,
      wordIndex: 0,
      wordTimings: this.normalizeWordTimings(timeline.wordTimings),
    };

    return name;
  }

  /**
   * Start speaking a sentence - creates one clip for the entire utterance
   *
   * @param text - The full sentence/utterance to speak
   * @returns The snippet name (for tracking/cancellation)
   */
  startSentence(text: string): string | null {
    if (!text.trim()) return null;

    console.log(`[Vocal] startSentence: "${text}"`);

    const speechRate = this.config.speechRate ?? 1.0;
    const events = textToVisemes(text, speechRate);
    if (events.length === 0) {
      console.warn(`[Vocal] No viseme events for sentence: "${text}"`);
      return null;
    }

    return this.startTimeline({
      name: this.buildTextSnippetName(text),
      text,
      visemes: events,
      wordTimings: this.buildWordTimings(text, speechRate),
      source: 'text',
    });
  }

  /**
   * Notify that a word boundary was reached (from TTS)
   * Used for sync verification - the clip continues playing
   *
   * @param word - The word that was reached
   * @param wordIndex - Optional word index for verification
   */
  onWordBoundary(word: string, wordIndex?: number, observedElapsedSec?: number): void {
    if (!this.currentSentence) {
      console.warn(`[Vocal] onWordBoundary called but no sentence active`);
      return;
    }

    const ctx = this.currentSentence;
    const expectedIndex = wordIndex ?? ctx.wordIndex;

    console.log(`[Vocal] onWordBoundary: "${word}" (index ${expectedIndex})`);

    // Optional: sync verification
    if (expectedIndex < ctx.wordTimings.length) {
      const expected = ctx.wordTimings[expectedIndex];
      const elapsedSec = typeof observedElapsedSec === 'number'
        ? Math.max(0, observedElapsedSec)
        : (performance.now() - ctx.startTime) / 1000;
      const drift = elapsedSec - expected.startSec;

      if (Math.abs(drift) > WORD_SYNC_DRIFT_THRESHOLD_SEC) {
        const targetTime = Math.min(ctx.maxTime, Math.max(0, elapsedSec));
        console.log(
          `[Vocal] Sync drift: ${(drift * 1000).toFixed(0)}ms at word "${word}", seeking "${ctx.name}" to ${targetTime.toFixed(3)}s`
        );
        this.config.animationAgency?.seek?.(ctx.name, targetTime);
      }
    }

    ctx.wordIndex = expectedIndex + 1;
    this.store.setCurrentWord(word);
  }

  /**
   * Update word timings for the active timeline when timing metadata arrives
   * after the viseme timeline has already started.
   */
  updateWordTimings(wordTimings: VocalWordTiming[]): void {
    if (!this.currentSentence) return;
    this.currentSentence.wordTimings = this.normalizeWordTimings(wordTimings);
    this.currentSentence.wordIndex = 0;
  }

  /**
   * Stop the current sentence
   */
  stopSentence(): void {
    if (!this.currentSentence) return;

    console.log(`[Vocal] stopSentence: ${this.currentSentence.name}`);
    this.removeSnippet(this.currentSentence.name);

    // Clear cleanup timer
    const timer = this.cleanupTimers.get(this.currentSentence.name);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(this.currentSentence.name);
    }

    this.currentSentence = null;
    this.store.stopSpeaking();
  }

  /**
   * Pause the current sentence
   */
  pauseSentence(): void {
    if (!this.currentSentence) return;

    const agency = this.config.animationAgency;
    if (agency?.pauseSnippet) {
      agency.pauseSnippet(this.currentSentence.name);
    }
  }

  /**
   * Resume the current sentence
   */
  resumeSentence(): void {
    if (!this.currentSentence) return;

    const agency = this.config.animationAgency;
    if (agency?.resumeSnippet) {
      agency.resumeSnippet(this.currentSentence.name);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Legacy Word-Level API (Deprecated - use sentence-level instead)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Speak text - converts text to visemes and schedules animation
   * @deprecated Use startSentence() instead
   */
  speak(text: string): string | null {
    // Delegate to sentence-level API
    return this.startSentence(text);
  }

  /**
   * Speak a single word - now just notifies the sentence context
   * @deprecated Use startSentence() + onWordBoundary() instead
   */
  speakWord(word: string, _startMs: number = 0, _durationMs?: number): string | null {
    // If we have an active sentence, just notify word boundary
    if (this.currentSentence) {
      this.onWordBoundary(word);
      return this.currentSentence.name;
    }

    // Fallback: create a sentence from just this word
    console.warn(`[Vocal] speakWord called without active sentence - creating mini-sentence`);
    return this.startSentence(word);
  }

  /**
   * Process word boundary event from TTS
   * @deprecated Use onWordBoundary() instead
   */
  processWordBoundary(timing: WordTiming): string | null {
    if (this.currentSentence) {
      this.onWordBoundary(timing.word, undefined, timing.startMs / 1000);
      return this.currentSentence.name;
    }
    return this.startSentence(timing.word);
  }

  /**
   * Process pre-computed viseme events (e.g., from Azure TTS)
   *
   * @param events - Array of viseme events with timing
   * @param name - Optional snippet name
   * @returns The snippet name
   */
  processVisemeEvents(events: VisemeEvent[], name?: string): string | null {
    return this.startTimeline({
      name,
      visemes: events,
      source: 'azure',
    });
  }

  /**
   * Stop speaking and clear active animations
   */
  stop(): void {
    // Stop current sentence
    this.stopSentence();

    // Remove any other active snippets
    for (const name of this.activeSnippets) {
      this.removeSnippet(name);
    }
    this.activeSnippets.clear();

    // Clear all cleanup timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    this.store.stopSpeaking();
  }

  /**
   * Cleanup and release resources
   */
  dispose(): void {
    this.stop();
    this.store.dispose();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Build word timings from text for sync verification
   */
  private buildWordTimings(
    text: string,
    speechRate: number
  ): VocalWordTiming[] {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const timings: VocalWordTiming[] = [];

    let currentTime = 0;
    for (const word of words) {
      const events = wordToVisemes(word, 0, speechRate);
      const duration = events.length > 0
        ? events.reduce((max, e) => Math.max(max, e.offsetMs + e.durationMs), 0) / 1000
        : 0.2; // Default 200ms for unknown words

      timings.push({
        word,
        startSec: currentTime,
        endSec: currentTime + duration,
      });

      currentTime += duration;
    }

    return timings;
  }

  private normalizeWordTimings(wordTimings?: VocalWordTiming[]): VocalWordTiming[] {
    if (!wordTimings) return [];

    return wordTimings
      .filter((timing) =>
        timing.word.length > 0 &&
        Number.isFinite(timing.startSec) &&
        Number.isFinite(timing.endSec)
      )
      .map((timing) => ({
        word: timing.word,
        startSec: Math.max(0, timing.startSec),
        endSec: Math.max(Math.max(0, timing.startSec), timing.endSec),
      }));
  }

  private buildTimelineName(timeline: VocalTimeline): string {
    if (timeline.text?.trim()) {
      return this.buildTextSnippetName(timeline.text);
    }

    const source = timeline.source ?? 'external';
    return `vocal_${source}_${Date.now()}`;
  }

  private buildTextSnippetName(text: string): string {
    const words = text
      .split(/\s+/)
      .slice(0, 3)
      .join('_')
      .toLowerCase()
      .replace(/[^a-z_]/g, '');
    return `vocal_${words || 'text'}_${Date.now()}`;
  }

  private scheduleSnippet(snippet: VocalSnippet, events: VisemeEvent[]): string | null {
    const agency = this.config.animationAgency;

    console.log(`[Vocal] scheduleSnippet: ${snippet.name}`);
    console.log(`[Vocal] snippet maxTime:`, snippet.maxTime);

    if (agency?.schedule) {
      const name = agency.schedule(snippet);
      if (name) {
        console.log(`[Vocal] Snippet scheduled successfully: ${name}`);
        this.activeSnippets.add(name);
        this.store.startSpeaking(name);
        this.scheduleCleanup(name, snippet.maxTime);
        return name;
      } else {
        console.warn(`[Vocal] agency.schedule returned null for: ${snippet.name}`);
      }
    } else {
      console.warn('[Vocal] No animationAgency.schedule available');
    }

    // Fallback: direct engine control (for simpler setups)
    const engine = this.config.engine;
    if (engine?.transitionAU) {
      this.playDirect(events);
      const name = snippet.name;
      this.activeSnippets.add(name);
      this.store.startSpeaking(name);
      this.scheduleCleanup(name, snippet.maxTime);
      return name;
    }

    return null;
  }

  private removeSnippet(name: string): void {
    const agency = this.config.animationAgency;
    if (agency?.remove) {
      agency.remove(name);
    }
    this.activeSnippets.delete(name);
  }

  private scheduleCleanup(name: string, maxTime: number): void {
    // Clear existing timer for this snippet
    const existing = this.cleanupTimers.get(name);
    if (existing) clearTimeout(existing);

    // Schedule cleanup after snippet completes (add 100ms buffer)
    const cleanupMs = (maxTime * 1000) + 100;
    const timer = globalThis.setTimeout(() => {
      // Remove snippet from animation system
      this.removeSnippet(name);
      this.cleanupTimers.delete(name);

      // Clear sentence context if this was it
      if (this.currentSentence?.name === name) {
        this.currentSentence = null;
      }

      // Update state if this was the last snippet
      if (this.activeSnippets.size === 0) {
        this.store.stopSpeaking();
      }
    }, cleanupMs);

    this.cleanupTimers.set(name, timer);
  }

  /**
   * Play viseme events directly through the engine (no snippet scheduling)
   * Used as fallback when no animation agency is available
   */
  private playDirect(events: VisemeEvent[]): void {
    const engine = this.config.engine;
    if (!engine?.transitionAU) return;

    const intensity = this.config.intensity ?? 1.0;
    const rampMs = this.config.rampMs ?? 15;

    for (const event of events) {
      const delay = event.offsetMs;
      const auId = event.visemeId;

      setTimeout(() => {
        engine.transitionAU?.(auId, intensity, rampMs);
        setTimeout(() => {
          engine.transitionAU?.(auId, 0, rampMs);
        }, event.durationMs);
      }, delay);
    }
  }
}

/**
 * Factory function to create a Vocal service
 */
export function createVocalService(config?: Partial<VocalConfig>): VocalService {
  return new VocalService(config);
}
