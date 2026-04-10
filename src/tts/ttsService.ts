/**
 * TTS Service
 * Main Text-to-Speech service facade
 *
 * Handles speech synthesis and coordinates lip sync internally.
 * Supports both legacy LipSync service and experimental Vocal service.
 */

import type {
  TTSConfig,
  TTSVoice,
  TTSCallbacks,
  TTSState,
  TimelineEvent,
  SAPIResponse,
  VisemeID
} from './types';
import {
  parseTokens,
  buildLocalTimeline,
  buildSAPITimeline,
  decodeBase64Audio,
  getTimelineDuration
} from './utils';
import { createLipSyncService, type LipSyncServiceAPI } from '../lipsync';
import { azureVisemesToTimeline, normalizeAzureVisemes, type AzureVisemeLike } from '../lipsync/azureVisemeMapping';
import { createVocalService, type VocalService } from '../vocal';
import { requireBackendBaseUrl } from '../config/backendUrl';

interface AzureViseme {
  viseme_id: number;
  audio_offset: number;
  animation?: Record<string, number> | null;
}

interface AzureWordBoundary {
  word: string;
  start_time: number;
  end_time: number;
}

interface AzureTTSSynthesizeResponse {
  audio_base64: string;
  audio_format?: string;
  visemes: AzureViseme[];
  word_boundaries: AzureWordBoundary[];
  duration: number;
}
export class TTSService {
  private config: Required<TTSConfig>;
  private state: TTSState;
  private callbacks: TTSCallbacks;

  // Web Speech API
  private synthesis: SpeechSynthesis | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  // Audio playback
  private audioContext: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;

  // Timeline execution
  private timelineTimeouts: number[] = [];
  private timelineStartTime: number = 0;
  private speechToken: number = 0;

  // Lip sync services (managed internally)
  private lipSyncService: LipSyncServiceAPI | null = null;
  private vocalService: VocalService | null = null;
  private wordIndex: number = 0;

  // SAPI endpoint
  private sapiEndpoint = 'https://new-emotion.cis.fiu.edu/HapGL/HapGLService.svc';

  constructor(config: TTSConfig = {}, callbacks: TTSCallbacks = {}) {
    this.config = {
      engine: config.engine ?? 'webSpeech',
      rate: config.rate ?? 1.0,
      pitch: config.pitch ?? 1.0,
      volume: config.volume ?? 1.0,
      voiceName: config.voiceName ?? '',
      backendUrl: config.backendUrl ?? requireBackendBaseUrl(),
      azureApiKey: config.azureApiKey ?? '',
      azureRegion: config.azureRegion ?? '',
      azureStyle: config.azureStyle ?? '',
      azureStyleDegree: config.azureStyleDegree ?? null,
      useExperimentalVocal: config.useExperimentalVocal ?? false,
      lipsyncIntensity: config.lipsyncIntensity ?? 1.0,
      jawScale: config.jawScale ?? 1.0,
      animationAgency: config.animationAgency ?? undefined,
    };

    this.callbacks = callbacks;

    this.state = {
      status: 'idle'
    };

    this.initialize();
  }

  /**
   * Initialize TTS service
   */
  private async initialize(): Promise<void> {
    if (typeof window === 'undefined') return;

    if (this.config.engine === 'webSpeech') {
      await this.initWebSpeech();
    } else if (this.config.engine === 'sapi' || this.config.engine === 'azure') {
      await this.initSAPI();
    }

    // Initialize lip sync service if animation agency is provided
    this.initLipSync();
  }

  /**
   * Initialize lip sync service based on config
   */
  private initLipSync(): void {
    if (!this.config.animationAgency) {
      console.log('[TTS] No animation agency provided, lip sync disabled');
      return;
    }

    if (this.config.useExperimentalVocal) {
      // Use experimental Vocal service (Effect/MostJS based)
      console.log('[TTS] Using experimental Vocal service for lip sync');
      console.log('[TTS] Vocal config:', {
        intensity: this.config.lipsyncIntensity,
        speechRate: this.config.rate,
        jawScale: this.config.jawScale,
        hasAnimationAgency: !!this.config.animationAgency,
      });
      this.vocalService = createVocalService({
        intensity: this.config.lipsyncIntensity,
        speechRate: this.config.rate,
        jawScale: this.config.jawScale,
        animationAgency: this.config.animationAgency,
      });
      console.log('[TTS] Vocal service created:', !!this.vocalService);
    } else {
      // Use legacy LipSync service (XState based)
      console.log('[TTS] Using legacy LipSync service for lip sync');
      this.lipSyncService = createLipSyncService(
        {
          lipsyncIntensity: this.config.lipsyncIntensity,
          speechRate: this.config.rate,
          jawScale: this.config.jawScale,
        },
        {},
        {
          scheduleSnippet: (snippet) => this.config.animationAgency!.schedule(snippet),
          removeSnippet: (name) => this.config.animationAgency!.remove(name),
        }
      );
    }
  }

  /**
   * Initialize Web Speech API
   */
  private async initWebSpeech(): Promise<void> {
    if (!window.speechSynthesis) {
      console.error('Web Speech API not supported');
      return;
    }

    this.synthesis = window.speechSynthesis;

    // Load voices
    await this.loadVoices();

    // Set default voice
    if (this.config.voiceName) {
      this.setVoice(this.config.voiceName);
    }
  }

  /**
   * Initialize SAPI
   */
  private async initSAPI(): Promise<void> {
    // Create audio context for playback
    this.audioContext = new AudioContext();
  }

  /**
   * Load available voices
   */
  private async loadVoices(): Promise<void> {
    if (!this.synthesis) return;

    return new Promise((resolve) => {
      const loadVoicesImpl = () => {
        this.voices = this.synthesis!.getVoices();
        resolve();
      };

      // Voices might load async
      if (this.synthesis.getVoices().length > 0) {
        loadVoicesImpl();
      } else {
        this.synthesis.addEventListener('voiceschanged', loadVoicesImpl, { once: true });
      }
    });
  }

  /**
   * Get available voices
   */
  public getVoices(): TTSVoice[] {
    if (this.config.engine === 'webSpeech') {
      return this.voices.map(v => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        default: v.default
      }));
    }

    return [];
  }

  /**
   * Set voice by name
   */
  public setVoice(voiceName: string): boolean {
    if (this.config.engine === 'webSpeech') {
      const voice = this.voices.find(v => v.name === voiceName);
      if (voice) {
        this.config.voiceName = voiceName;
        return true;
      }
    } else if (this.config.engine === 'sapi' || this.config.engine === 'azure') {
      this.config.voiceName = voiceName;
      return true;
    }

    return false;
  }

  /**
   * Speak text
   */
  public async speak(text: string): Promise<void> {
    // Stop current speech
    this.stop();

    // Update state
    this.setState({ status: 'loading', currentText: text });

    // Parse tokens
    const { text: sanitizedText, emojis } = parseTokens(text);

    if (!sanitizedText) {
      console.warn('No text to speak after parsing');
      this.setState({ status: 'idle' });
      return;
    }

    try {
      if (this.config.engine === 'webSpeech') {
        await this.speakWebSpeech(sanitizedText, emojis);
      } else if (this.config.engine === 'sapi') {
        await this.speakSAPI(sanitizedText, emojis);
      } else if (this.config.engine === 'azure') {
        await this.speakAzure(sanitizedText, emojis);
      } else {
        throw new Error(`Unsupported TTS engine: ${this.config.engine}`);
      }
    } catch (error) {
      console.error('TTS error:', error);
      this.setState({ status: 'error', error: (error as Error).message });
      this.callbacks.onError?.(error as Error);
    }
  }

  /**
   * Speak using Web Speech API
   */
  private async speakWebSpeech(
    text: string,
    emojis: Array<{ emoji: string; index: number }>
  ): Promise<void> {
    if (!this.synthesis) {
      throw new Error('Web Speech API not initialized');
    }

    // Build timeline
    const timeline = buildLocalTimeline(text, emojis, this.config.rate);
    this.setState({ currentTimeline: timeline });

    // Create utterance
    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this.config.rate;
    this.utterance.pitch = this.config.pitch;
    this.utterance.volume = this.config.volume;

    // Set voice
    if (this.config.voiceName) {
      const voice = this.voices.find(v => v.name === this.config.voiceName);
      if (voice) {
        this.utterance.voice = voice;
      }
    }

    // Reset word index
    this.wordIndex = 0;

    // Set up event handlers
    this.utterance.onstart = () => {
      this.setState({ status: 'speaking' });
      this.callbacks.onStart?.();
      this.executeTimeline(timeline);

      // Start lip sync - sentence-level for experimental vocal, legacy for lipSyncService
      if (this.config.useExperimentalVocal && this.vocalService) {
        console.log(`[TTS] Starting sentence-level lip sync for: "${text}"`);
        this.vocalService.startSentence(text);
      } else if (this.lipSyncService) {
        this.lipSyncService.startSpeech();
      }
    };

    this.utterance.onend = () => {
      this.setState({ status: 'idle' });
      this.callbacks.onEnd?.();
      this.clearTimelineTimeouts();

      // End lip sync
      if (this.config.useExperimentalVocal && this.vocalService) {
        this.vocalService.stop();
      } else if (this.lipSyncService) {
        this.lipSyncService.endSpeech();
      }
    };

    this.utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      this.setState({ status: 'error', error: event.error });
      this.callbacks.onError?.(new Error(event.error));
      this.clearTimelineTimeouts();

      // Stop lip sync on error
      if (this.config.useExperimentalVocal && this.vocalService) {
        this.vocalService.stop();
      } else if (this.lipSyncService) {
        this.lipSyncService.stop();
      }
    };

    this.utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const word = text.substring(event.charIndex, event.charIndex + event.charLength);

        console.log(`[TTS] onboundary word: "${word}", useExperimental: ${this.config.useExperimentalVocal}, hasVocal: ${!!this.vocalService}, hasLipSync: ${!!this.lipSyncService}`);

        // Notify lip sync of word boundary (for sync verification, not clip creation)
        if (word) {
          if (this.config.useExperimentalVocal && this.vocalService) {
            // Sentence-level: just notify word boundary, clip already playing
            console.log(`[TTS] Notifying vocalService.onWordBoundary("${word}", ${this.wordIndex})`);
            this.vocalService.onWordBoundary(
              word,
              this.wordIndex,
              typeof event.elapsedTime === 'number' ? event.elapsedTime : undefined
            );
          } else if (this.lipSyncService) {
            // Legacy: process word creates per-word snippets
            console.log(`[TTS] Calling lipSyncService.processWord("${word}", ${this.wordIndex})`);
            this.lipSyncService.processWord(word, this.wordIndex);
          } else {
            console.warn(`[TTS] No lip sync service available for word: "${word}"`);
          }
        }

        // Fire callback for external use (prosodic gestures, etc.)
        this.callbacks.onBoundary?.({ word, charIndex: event.charIndex });
        this.wordIndex++;
      }
    };

    // Speak
    this.synthesis.speak(this.utterance);
  }

  /**
   * Speak using SAPI
   */
  private async speakSAPI(
    text: string,
    emojis: Array<{ emoji: string; index: number }>
  ): Promise<void> {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    // Request audio from SAPI
    const response = await this.fetchSAPIAudio(text);

    // Build timeline
    const timeline = buildSAPITimeline(text, emojis, response.visemes, response.duration);
    this.setState({ currentTimeline: timeline });

    // Decode audio
    const audioBuffer = await decodeBase64Audio(response.audio, this.audioContext);

    // Create audio source
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = audioBuffer;
    this.audioSource.connect(this.audioContext.destination);

    // Reset word index
    this.wordIndex = 0;

    // Set up event handlers
    this.audioSource.onended = () => {
      this.setState({ status: 'idle' });
      this.callbacks.onEnd?.();
      this.clearTimelineTimeouts();

      // End lip sync
      if (this.config.useExperimentalVocal && this.vocalService) {
        this.vocalService.stop();
      } else if (this.lipSyncService) {
        this.lipSyncService.endSpeech();
      }
    };

    // Start playback
    this.setState({ status: 'speaking' });
    this.callbacks.onStart?.();
    this.executeTimeline(timeline);

    // Start lip sync - sentence-level for experimental vocal, legacy for lipSyncService
    if (this.config.useExperimentalVocal && this.vocalService) {
      console.log(`[TTS SAPI] Starting sentence-level lip sync for: "${text}"`);
      this.vocalService.startSentence(text);
    } else if (this.lipSyncService) {
      this.lipSyncService.startSpeech();
    }

    this.audioSource.start();
  }

  /**
   * Speak using Azure TTS (backend)
   */
  private async speakAzure(
    text: string,
    emojis: Array<{ emoji: string; index: number }>
  ): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
    }

    const speechToken = this.speechToken;
    const backendUrl = this.config.backendUrl || requireBackendBaseUrl();
    const azureRate = `${Math.round((this.config.rate - 1) * 100)}%`;
    const azurePitch = `${Math.round((this.config.pitch - 1) * 50)}%`;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.config.azureApiKey && this.config.azureRegion) {
      headers['X-Azure-Speech-Key'] = this.config.azureApiKey;
      headers['X-Azure-Speech-Region'] = this.config.azureRegion;
    }

    const body: Record<string, unknown> = {
      text,
      voice_name: this.config.voiceName || 'en-US-JennyNeural',
      rate: azureRate,
      pitch: azurePitch,
    };
    if (this.config.azureStyle) {
      body.style = this.config.azureStyle;
    }
    if (this.config.azureStyleDegree != null) {
      body.style_degree = this.config.azureStyleDegree;
    }

    const response = await fetch(`${backendUrl}/api/azure-tts/synthesize`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const errorData = await response.json();
        message = errorData.detail || message;
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(`Azure TTS request failed: ${message}`);
    }

    const result: AzureTTSSynthesizeResponse = await response.json();
    if (speechToken !== this.speechToken) return;

    const audioBuffer = await decodeBase64Audio(result.audio_base64, this.audioContext);
    if (speechToken !== this.speechToken) return;

    const durationSec = Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0
      ? audioBuffer.duration
      : result.duration;
    const timeline = this.buildAzureTimeline(text, emojis, result, durationSec);
    this.setState({ currentTimeline: timeline });

    // Create audio source
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = audioBuffer;

    // Apply volume via gain node
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = this.config.volume;
    this.audioSource.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // Reset word index
    this.wordIndex = 0;

    // Set up event handlers
    this.audioSource.onended = () => {
      if (speechToken !== this.speechToken) return;
      this.setState({ status: 'idle' });
      this.callbacks.onEnd?.();
      this.clearTimelineTimeouts();
      this.endExternalSpeech();
      this.audioSource = null;
    };

    // Start playback
    this.setState({ status: 'speaking' });
    this.callbacks.onStart?.();

    // Start experimental Azure lip sync from Azure visemes when available.
    // Fall back to text-derived sentence timing so the new Vocal path still animates
    // if the external viseme schedule fails for any utterance.
    let snippetName: string | null;
    if (this.config.useExperimentalVocal && this.vocalService) {
      snippetName = this.processExternalVisemes(result.visemes, durationSec);
      if (!snippetName) {
        console.warn('[TTS Azure] Azure visemes did not schedule; falling back to sentence-derived Vocal timing');
        snippetName = this.vocalService.startSentence(text);
      }
    } else {
      this.startExternalSpeech();
      snippetName = this.processExternalVisemes(result.visemes, durationSec);
    }

    if (snippetName && this.config.animationAgency?.setSnippetTime) {
      this.config.animationAgency.setSnippetTime(snippetName, 0);
    }

    this.clearTimelineTimeouts();
    this.executeTimeline(timeline);

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.audioSource.start();
  }

  private buildAzureTimeline(
    text: string,
    emojis: Array<{ emoji: string; index: number }>,
    result: AzureTTSSynthesizeResponse,
    durationSec: number
  ): TimelineEvent[] {
    const timeline: TimelineEvent[] = [];
    const totalDurationMs = Math.max(0, Math.round(durationSec * 1000));

    if (result.word_boundaries && result.word_boundaries.length > 0) {
      result.word_boundaries.forEach((boundary, index) => {
        const offsetMs = Math.max(0, Math.round(boundary.start_time * 1000));
        timeline.push({
          type: 'WORD',
          word: boundary.word,
          index,
          offsetMs,
        });
      });
    }

    const visemeTimeline = azureVisemesToTimeline(result.visemes || [], totalDurationMs);
    for (const viseme of visemeTimeline) {
      timeline.push({
        type: 'VISEME',
        visemeId: viseme.visemeId,
        offsetMs: viseme.offsetMs,
        durMs: viseme.durationMs,
      });
    }

    if (emojis.length > 0 && totalDurationMs > 0) {
      const textLength = text.length || 1;
      emojis.forEach(({ emoji, index }) => {
        const proportion = index / textLength;
        const emojiOffset = totalDurationMs * proportion;
        timeline.push({
          type: 'EMOJI',
          emoji,
          offsetMs: emojiOffset,
        });
      });
    }

    timeline.sort((a, b) => a.offsetMs - b.offsetMs);
    return timeline;
  }

  /**
   * Fetch audio from SAPI endpoint
   */
  private async fetchSAPIAudio(text: string): Promise<SAPIResponse> {
    const response = await fetch(this.sapiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice: this.config.voiceName || 'default',
        rate: this.config.rate
      })
    });

    if (!response.ok) {
      throw new Error(`SAPI request failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Execute timeline events
   */
  private executeTimeline(timeline: TimelineEvent[]): void {
    this.clearTimelineTimeouts();
    this.timelineStartTime = Date.now();

    for (const event of timeline) {
      const timeout = window.setTimeout(() => {
        this.handleTimelineEvent(event);
      }, event.offsetMs);

      this.timelineTimeouts.push(timeout);
    }
  }

  /**
   * Handle timeline event
   */
  private handleTimelineEvent(event: TimelineEvent): void {
    switch (event.type) {
      case 'WORD':
        // For Web Speech API, lip sync is handled by onboundary (accurate timing).
        // Only process WORD events from timeline for SAPI mode where onboundary doesn't fire.
        if (this.config.engine === 'sapi' || this.config.engine === 'azure') {
          if (this.config.useExperimentalVocal && this.vocalService) {
            // Sentence-level: just notify word boundary (sentence started in speakSAPI)
            this.vocalService.onWordBoundary(event.word, this.wordIndex, event.offsetMs / 1000);
          } else if (this.lipSyncService) {
            this.lipSyncService.processWord(event.word, this.wordIndex);
          }
          this.callbacks.onBoundary?.({
            word: event.word,
            charIndex: event.index
          });
          this.wordIndex++;
        }
        // For Web Speech, onboundary handles this - don't duplicate
        break;

      case 'VISEME':
        this.callbacks.onViseme?.(event.visemeId, event.durMs);
        break;

      case 'EMOJI':
        // Emoji events can be used for emotive expressions
        console.log('Emoji event:', event.emoji);
        break;

      case 'PHONEME':
        // Phoneme events for advanced lip-sync
        break;
    }
  }

  /**
   * Clear timeline timeouts
   */
  private clearTimelineTimeouts(): void {
    for (const timeout of this.timelineTimeouts) {
      clearTimeout(timeout);
    }
    this.timelineTimeouts = [];
  }

  /**
   * Stop current speech
   */
  public stop(): void {
    this.speechToken += 1;

    if (this.config.engine === 'webSpeech' && this.synthesis) {
      this.synthesis.cancel();
    }

    if (this.audioSource) {
      try {
        this.audioSource.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      this.audioSource = null;
    }

    // Stop lip sync
    if (this.config.useExperimentalVocal && this.vocalService) {
      this.vocalService.stop();
    } else if (this.lipSyncService) {
      this.lipSyncService.stop();
    }

    this.clearTimelineTimeouts();
    this.setState({ status: 'idle' });
  }

  /**
   * Pause speech
   */
  public pause(): void {
    if (this.config.engine === 'webSpeech' && this.synthesis) {
      this.synthesis.pause();
      this.setState({ status: 'paused' });
      this.callbacks.onPause?.();
    }

    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
      this.setState({ status: 'paused' });
      this.callbacks.onPause?.();
    }
  }

  /**
   * Resume speech
   */
  public resume(): void {
    if (this.config.engine === 'webSpeech' && this.synthesis) {
      this.synthesis.resume();
      this.setState({ status: 'speaking' });
      this.callbacks.onResume?.();
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
      this.setState({ status: 'speaking' });
      this.callbacks.onResume?.();
    }
  }

  /**
   * Get current state
   */
  public getState(): TTSState {
    return { ...this.state };
  }

  /**
   * Update state
   */
  private setState(update: Partial<TTSState>): void {
    this.state = { ...this.state, ...update };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<TTSConfig>): void {
    const prevUseExperimental = this.config.useExperimentalVocal;
    this.config = { ...this.config, ...config };

    // If useExperimentalVocal changed, reinitialize lip sync
    if (config.useExperimentalVocal !== undefined && config.useExperimentalVocal !== prevUseExperimental) {
      this.disposeLipSync();
      this.initLipSync();
    }

    // Update lip sync config
    if (this.lipSyncService) {
      this.lipSyncService.updateConfig({
        speechRate: this.config.rate,
        lipsyncIntensity: this.config.lipsyncIntensity,
        jawScale: this.config.jawScale,
      });
    }
    if (this.vocalService) {
      this.vocalService.updateConfig({
        speechRate: this.config.rate,
        intensity: this.config.lipsyncIntensity,
        jawScale: this.config.jawScale,
      });
    }
  }

  /**
   * Dispose lip sync services
   */
  private disposeLipSync(): void {
    if (this.lipSyncService) {
      this.lipSyncService.dispose();
      this.lipSyncService = null;
    }
    if (this.vocalService) {
      this.vocalService.dispose();
      this.vocalService = null;
    }
  }

  /**
   * Start lip sync for external audio (Azure TTS, LiveKit TTS, etc.)
   * Call this when external audio playback begins
   */
  public startExternalSpeech(): void {
    this.wordIndex = 0;
    if (this.lipSyncService) {
      this.lipSyncService.startSpeech();
    }
  }

  /**
   * Start external sentence-level lip sync
   * Call this with the full text when external audio playback begins
   */
  public startExternalSentence(text: string): void {
    this.wordIndex = 0;
    if (this.config.useExperimentalVocal && this.vocalService) {
      console.log(`[TTS External] Starting sentence-level lip sync for: "${text}"`);
      this.vocalService.startSentence(text);
    } else if (this.lipSyncService) {
      this.lipSyncService.startSpeech();
    }
  }

  /**
   * Process a word for lip sync from external audio
   * Call this for each word boundary from external TTS engines
   */
  public processExternalWord(word: string, elapsedSec?: number): void {
    if (this.config.useExperimentalVocal && this.vocalService) {
      // Sentence-level: just notify word boundary
      this.vocalService.onWordBoundary(word, this.wordIndex, elapsedSec);
    } else if (this.lipSyncService) {
      this.lipSyncService.processWord(word, this.wordIndex);
    }
    this.callbacks.onBoundary?.({
      word,
      charIndex: this.wordIndex,
    });
    this.wordIndex++;
  }

  /**
   * Process external viseme events (e.g., Azure TTS visemes)
   * Uses experimental Vocal service when enabled, otherwise legacy LipSync scheduler.
   * @returns Scheduled snippet name if available (useful for debug), otherwise null.
   */
  public processExternalVisemes(visemes: AzureVisemeLike[], totalDurationSec?: number): string | null {
    if (!visemes || visemes.length === 0) return null;

    const totalDurationMs = typeof totalDurationSec === 'number'
      ? Math.max(0, Math.round(totalDurationSec * 1000))
      : undefined;

    if (this.config.useExperimentalVocal && this.vocalService) {
      const timeline = azureVisemesToTimeline(visemes, totalDurationMs);
      if (timeline.length === 0) return null;
      // Vocal service expects ARKit/CC4 viseme IDs (0-14) with timing.
      return this.vocalService.processVisemeEvents(timeline as any, `azure_visemes_${Date.now()}`);
    }

    if (this.lipSyncService) {
      const normalized = normalizeAzureVisemes(visemes);
      if (normalized.length === 0) return null;
      return this.lipSyncService.processAzureVisemes?.(normalized, totalDurationMs) ?? null;
    }

    return null;
  }

  /**
   * End lip sync for external audio
   * Call this when external audio playback ends
   */
  public endExternalSpeech(): void {
    if (this.config.useExperimentalVocal && this.vocalService) {
      this.vocalService.stop();
    } else if (this.lipSyncService) {
      this.lipSyncService.endSpeech();
    }
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this.stop();
    this.disposeLipSync();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

/**
 * Create TTS service instance
 */
export function createTTSService(
  config?: TTSConfig,
  callbacks?: TTSCallbacks
): TTSService {
  return new TTSService(config, callbacks);
}
