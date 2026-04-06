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

import type { VocalConfig, VocalSnippet, VisemeEvent, WordTiming } from './types';
import { DEFAULT_VOCAL_CONFIG } from './types';
import { VocalStateStore } from './state';
import { textToVisemes, wordToVisemes } from './phonemes';
import { buildVocalSnippet, buildTextSnippet } from './snippetBuilder';

/** Tracks a sentence being spoken */
interface SentenceContext {
  name: string;
  text: string;
  startTime: number;
  maxTime: number;
  wordIndex: number;
  wordTimings: Array<{ word: string; startSec: number; endSec: number }>;
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
   * Start speaking a sentence - creates one clip for the entire utterance
   *
   * @param text - The full sentence/utterance to speak
   * @returns The snippet name (for tracking/cancellation)
   */
  startSentence(text: string): string | null {
    if (!text.trim()) return null;

    // Stop any previous sentence
    if (this.currentSentence) {
      this.stopSentence();
    }

    console.log(`[Vocal] startSentence: "${text}"`);

    // Generate visemes for entire sentence
    const events = textToVisemes(text, this.config.speechRate ?? 1.0);
    if (events.length === 0) {
      console.warn(`[Vocal] No viseme events for sentence: "${text}"`);
      return null;
    }

    // Build snippet for full sentence
    const snippet = buildTextSnippet(text, events, this.config);
    console.log(`[Vocal] Built sentence snippet: maxTime=${snippet.maxTime.toFixed(3)}s, curves=${Object.keys(snippet.curves).length}`);

    // Schedule the snippet
    const name = this.scheduleSnippet(snippet, events);
    if (!name) return null;

    // Build word timings for sync
    const wordTimings = this.buildWordTimings(text, this.config.speechRate ?? 1.0);

    // Track sentence context
    this.currentSentence = {
      name,
      text,
      startTime: performance.now(),
      maxTime: snippet.maxTime,
      wordIndex: 0,
      wordTimings,
    };

    return name;
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
    if (events.length === 0) return null;

    // Stop any current sentence first
    if (this.currentSentence) {
      this.stopSentence();
    }

    // External viseme timings already include speech rate; keep playback rate at 1.0.
    const snippet = buildVocalSnippet(events, { ...this.config, speechRate: 1.0 }, name);
    const scheduledName = this.scheduleSnippet(snippet, events);

    if (scheduledName) {
      // Track as sentence context
      this.currentSentence = {
        name: scheduledName,
        text: name || 'viseme_events',
        startTime: performance.now(),
        maxTime: snippet.maxTime,
        wordIndex: 0,
        wordTimings: [],
      };
    }

    return scheduledName;
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
  ): Array<{ word: string; startSec: number; endSec: number }> {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const timings: Array<{ word: string; startSec: number; endSec: number }> = [];

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
