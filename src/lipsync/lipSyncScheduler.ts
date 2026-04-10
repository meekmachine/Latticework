/**
 * LipSync Scheduler
 * Handles viseme timeline processing, curve building, and animation scheduling
 * Follows the Animation Agency pattern
 *
 * Simple direct viseme mapping (no coarticulation):
 * - Each viseme gets a simple on/off curve matching reference snippets
 * - Intensity of 0.9 matches the working phrase_viseme_snippet.json (0-1 scale)
 */

import type { LipSyncSnippet } from './lipSyncMachine';
import type { VisemeEvent, AzureVisemeEvent } from './types';
import { phonemeExtractor } from './PhonemeExtractor';
import { visemeMapper } from './VisemeMapper';

export interface LipSyncHostCaps {
  scheduleSnippet: (snippet: any) => string | null;
  removeSnippet: (name: string) => void;
}

export interface LipSyncSchedulerConfig {
  lipsyncIntensity: number;
  speechRate: number;
  jawScale: number;
}

function sanitizeWordForSnippetName(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export function buildWordLipSyncSnippetName(word: string, timestamp = Date.now()): string {
  return `lipsync_${sanitizeWordForSnippetName(word)}_${timestamp}`;
}

function buildAzureLipSyncSnippetName(timestamp = Date.now()): string {
  return `azure_lipsync_${timestamp}`;
}

export class LipSyncScheduler {
  private machine: any;
  private host: LipSyncHostCaps;
  private config: LipSyncSchedulerConfig;

  constructor(
    machine: any,
    host: LipSyncHostCaps,
    config: Partial<LipSyncSchedulerConfig> & Pick<LipSyncSchedulerConfig, 'lipsyncIntensity' | 'speechRate'>
  ) {
    this.machine = machine;
    this.host = host;
    this.config = {
      lipsyncIntensity: config.lipsyncIntensity,
      speechRate: config.speechRate,
      jawScale: config.jawScale ?? 1.0,
    };
  }

  /**
   * Process a word and schedule its animation
   * @param word - The word to animate
   * @param wordIndex - Index of the word in the sentence
   * @param actualDurationMs - Optional actual duration from TTS word boundary event.
   *                           When provided, phoneme timings are scaled to fit this duration.
   */
  public processWord(
    word: string,
    wordIndex: number,
    actualDurationMs?: number,
    snippetName = buildWordLipSyncSnippetName(word)
  ): string | null {
    // Extract viseme timeline (with estimated durations)
    let visemeTimeline = this.extractVisemeTimeline(word);

    // If TTS provides actual word duration, scale phoneme timings to match
    if (actualDurationMs && actualDurationMs > 0 && visemeTimeline.length > 0) {
      visemeTimeline = this.scaleTimelineToFit(visemeTimeline, actualDurationMs);
    }

    // Build animation curves with coarticulation and jaw coordination
    const curves = this.buildCurves(visemeTimeline);

    // Calculate max time
    const maxTime = this.calculateMaxTime(visemeTimeline);

    // Create snippet
    const snippet = {
      name: snippetName,
      curves,
      maxTime,
      loop: false,
      snippetCategory: 'visemeSnippet', // Viseme morphs only - no AUs
      snippetPriority: 50, // High priority (overrides emotions)
      // Durations are already scaled by speechRate; keep playbackRate at 1 to avoid double-speed.
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
      snippetJawScale: this.config.jawScale, // Jaw bone activation multiplier
    };

    // Schedule to animation service
    const scheduledName = this.host.scheduleSnippet(snippet);

    if (!scheduledName) {
      this.machine.send({
        type: 'SNIPPET_COMPLETED',
        snippetName,
      });
      return null;
    }

    // Notify machine
    this.machine.send({
      type: 'SNIPPET_SCHEDULED',
      snippetName,
      scheduledName,
    });

    // Auto-remove after completion
    setTimeout(() => {
      this.host.removeSnippet(scheduledName);
      this.machine.send({
        type: 'SNIPPET_COMPLETED',
        snippetName,
      });
    }, maxTime * 1000 + 100); // Add 100ms buffer

    return scheduledName;
  }

  /**
   * Process Azure viseme events (from LiveKit/Azure TTS)
   * Converts Azure viseme format to internal timeline and schedules animation
   */
  public processAzureVisemes(
    events: AzureVisemeEvent[],
    totalDurationMs?: number,
    snippetName = buildAzureLipSyncSnippetName()
  ): string | null {
    if (!events || events.length === 0) return null;

    // Convert Azure format to internal VisemeEvent format
    const visemeTimeline: VisemeEvent[] = events.map((evt, i) => {
      const nextEvt = events[i + 1];
      const durationMs = nextEvt
        ? Math.round((nextEvt.time - evt.time) * 1000)
        : 100; // Default 100ms for last viseme

      return {
        visemeId: evt.visemeId,
        offsetMs: Math.round(evt.time * 1000),
        durationMs: Math.max(durationMs, 50), // Minimum 50ms
      };
    });

    // Build animation curves
    const curves = this.buildCurves(visemeTimeline);
    const maxTime = this.calculateMaxTime(visemeTimeline);

    // Create snippet
    const snippet = {
      name: snippetName,
      curves,
      maxTime,
      loop: false,
      snippetCategory: 'visemeSnippet',
      snippetPriority: 50,
      // External viseme timing already matches audio; keep playbackRate neutral.
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: this.config.lipsyncIntensity,
      snippetJawScale: this.config.jawScale,
    };

    // Schedule to animation service
    const scheduledName = this.host.scheduleSnippet(snippet);

    if (!scheduledName) {
      this.machine.send({
        type: 'SNIPPET_COMPLETED',
        snippetName,
      });
      return null;
    }

    this.machine.send({
      type: 'SNIPPET_SCHEDULED',
      snippetName,
      scheduledName,
    });

    // Auto-remove after completion
    const autoRemoveMs = (totalDurationMs ?? maxTime * 1000) + 200;
    setTimeout(() => {
      this.host.removeSnippet(scheduledName);
      this.machine.send({
        type: 'SNIPPET_COMPLETED',
        snippetName,
      });
    }, autoRemoveMs);

    return scheduledName;
  }

  /**
   * Scale a viseme timeline to fit an actual duration from TTS
   * Preserves relative timing proportions while matching actual speech timing
   */
  private scaleTimelineToFit(timeline: VisemeEvent[], targetDurationMs: number): VisemeEvent[] {
    // Calculate current estimated total duration
    const estimatedDuration = timeline.reduce((sum, v) => sum + v.durationMs, 0);

    if (estimatedDuration <= 0) return timeline;

    // Calculate scale factor
    const scaleFactor = targetDurationMs / estimatedDuration;

    // Scale each viseme's duration while maintaining proportions
    const scaledTimeline: VisemeEvent[] = [];
    let newOffset = 0;

    for (const event of timeline) {
      const scaledDuration = Math.round(event.durationMs * scaleFactor);
      scaledTimeline.push({
        visemeId: event.visemeId,
        offsetMs: newOffset,
        durationMs: scaledDuration,
      });
      newOffset += scaledDuration;
    }

    return scaledTimeline;
  }

  /**
   * Extract viseme timeline from word
   */
  private extractVisemeTimeline(word: string): VisemeEvent[] {
    const phonemes = phonemeExtractor.extractPhonemes(word);
    const visemeEvents: VisemeEvent[] = [];
    let offsetMs = 0;

    for (const phoneme of phonemes) {
      const mapping = visemeMapper.getVisemeAndDuration(phoneme);
      // Adjust for speech rate
      const durationMs = visemeMapper.adjustDuration(mapping.duration, this.config.speechRate);

      visemeEvents.push({
        visemeId: mapping.viseme,
        offsetMs,
        durationMs,
      });

      offsetMs += durationMs;
    }

    return visemeEvents;
  }

  /**
   * Build animation curves - simple direct mapping like reference snippets
   * Each viseme gets intensity 0.9 at start, 0 at end (matching phrase_viseme_snippet.json)
   */
  private buildCurves(
    visemeTimeline: VisemeEvent[]
  ): Record<string, Array<{ time: number; intensity: number }>> {
    const filteredTimeline = visemeTimeline;

    if (filteredTimeline.length === 0) {
      return {};
    }

    // Group keyframes by viseme ID
    const curves: Record<string, Array<{ time: number; intensity: number }>> = {};

    // Use intensity 0.9 to match reference snippets (phrase_viseme_snippet.json)
    // lipsyncIntensity is a 0-1 multiplier (default 1.0)
    const peakIntensity = 0.9;
    const rampSec = 0.008; // short ramp for crisp articulation (8ms)

    for (const event of filteredTimeline) {
      const visemeKey = event.visemeId.toString();
      if (!curves[visemeKey]) {
        curves[visemeKey] = [];
      }

      const startTime = event.offsetMs / 1000;
      const endTime = (event.offsetMs + event.durationMs) / 1000;
      const durationSec = Math.max(0, endTime - startTime);
      const ramp = Math.min(rampSec, durationSec / 2);
      const rampUpEnd = startTime + ramp;
      const rampDownStart = Math.max(rampUpEnd, endTime - ramp);

      // Trapezoid envelope: 0 -> peak -> hold -> 0
      curves[visemeKey].push(
        { time: startTime, intensity: 0 },
        { time: rampUpEnd, intensity: peakIntensity },
        { time: rampDownStart, intensity: peakIntensity },
        { time: endTime, intensity: 0 }
      );
    }

    // Sort each curve by time
    for (const key of Object.keys(curves)) {
      curves[key].sort((a, b) => a.time - b.time);
    }

    return curves;
  }

  /**
   * Calculate maximum time from viseme timeline
   */
  private calculateMaxTime(visemeTimeline: VisemeEvent[]): number {
    if (visemeTimeline.length === 0) return 0;

    const lastViseme = visemeTimeline[visemeTimeline.length - 1];
    const lastEndTime = (lastViseme.offsetMs + lastViseme.durationMs) / 1000;

    // Small buffer for animation system
    return lastEndTime + 0.02;
  }

  /**
   * Schedule neutral return snippet
   * Quickly transitions all active visemes back to closed/neutral
   */
  public scheduleNeutralReturn(): void {
    const neutralSnippet = {
      name: `neutral_${Date.now()}`,
      curves: this.buildNeutralCurves(),
      maxTime: 0.08, // Very fast return to neutral (80ms)
      loop: false,
      snippetCategory: 'visemeSnippet', // Viseme morphs only
      snippetPriority: 60, // Higher priority than lipsync (50) to ensure closure
      snippetPlaybackRate: 1.0,
      snippetIntensityScale: 1.0,
      snippetJawScale: this.config.jawScale, // Jaw bone activation multiplier
    };

    const scheduledName = this.host.scheduleSnippet(neutralSnippet);

    if (scheduledName) {
      // Auto-remove after completion
      setTimeout(() => {
        this.host.removeSnippet(scheduledName);
      }, 120);
    }
  }

  /**
   * Build neutral curves (all visemes to 0)
   * Uses 'inherit' flag so the animation system starts from current values
   */
  private buildNeutralCurves(): Record<string, Array<{ time: number; intensity: number; inherit?: boolean }>> {
    const neutralCurves: Record<string, Array<{ time: number; intensity: number; inherit?: boolean }>> = {};
    const closeDuration = 0.08; // 80ms to close mouth (fast)

    // Add neutral curves for all 15 ARKit viseme indices (0-14)
    // Start from current value (inherit) and transition to 0
    for (let i = 0; i < 15; i++) {
      neutralCurves[i.toString()] = [
        { time: 0.0, intensity: 0, inherit: true }, // Start from current value
        { time: closeDuration, intensity: 0 },      // End at 0
      ];
    }

    return neutralCurves;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<LipSyncSchedulerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Remove any scheduled snippets
    const snapshot = this.machine.getSnapshot();
    const context = snapshot?.context;

    if (context?.snippets) {
      context.snippets.forEach((snippet: any) => {
        if (snippet.scheduledName) {
          this.host.removeSnippet(snippet.scheduledName);
        }
      });
    }
  }
}
