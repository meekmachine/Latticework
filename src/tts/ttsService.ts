/**
 * TTS Service
 * Main Text-to-Speech service facade
 *
 * Handles speech synthesis and coordinates lip sync internally.
 * Uses the Vocal service as the only active lip-sync runtime.
 */

import type {
  TTSConfig,
  TTSVoice,
  TTSCallbacks,
  TTSState,
  TimelineEvent,
  SAPIResponse,
  VisemeID,
  SpeakResult,
  PlaybackReferenceStatus,
} from './types';
import {
  parseTokens,
  buildLocalTimeline,
  buildSAPITimeline,
  decodeBase64Audio,
  getTimelineDuration
} from './utils';
import { azureVisemesToTimeline, type AzureVisemeLike } from '../lipsync/azureVisemeMapping';
import { createVocalService, type VocalService, type VocalTimeline } from '../vocal';
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

// Human speech animation reads best when the mouth shape anticipates the sound
// slightly; keep this visual-only so word-boundary/audio clocks stay exact.
const AZURE_VOCAL_VISUAL_LEAD_MS = 35;

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
  private playbackReferenceDestination: MediaStreamAudioDestinationNode | null = null;
  private displayMediaReferenceStream: MediaStream | null = null;
  private displayMediaReferenceTrack: MediaStreamTrack | null = null;

  // Timeline execution
  private timelineTimeouts: number[] = [];
  private timelineStartTime: number = 0;
  private speechToken: number = 0;
  private currentSpeechResolve: ((result: SpeakResult) => void) | null = null;
  private currentSpeechPromise: Promise<SpeakResult> | null = null;
  private currentSpeechSettled = false;
  private playbackStartListeners = new Set<() => void>();
  private playbackReferenceTrackListeners = new Set<(track: MediaStreamTrack | null) => void>();

  // Lip sync service (managed internally)
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
      lang: config.lang ?? '',
      backendUrl: config.backendUrl ?? requireBackendBaseUrl(),
      azureApiKey: config.azureApiKey ?? '',
      azureRegion: config.azureRegion ?? '',
      azureStyle: config.azureStyle ?? '',
      azureStyleDegree: config.azureStyleDegree ?? null,
      webSpeechReferenceMode: config.webSpeechReferenceMode ?? 'none',
      lipsyncIntensity: config.lipsyncIntensity ?? 1.0,
      jawScale: config.jawScale ?? 1.0,
      animationAgency: config.animationAgency ?? undefined,
    };

    this.callbacks = callbacks;

    this.state = {
      status: 'idle',
      playbackReferenceStatus: 'unavailable',
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
   * Initialize the only active lip-sync runtime.
   */
  private initLipSync(): void {
    if (!this.config.animationAgency) {
      console.log('[TTS] No animation agency provided, lip sync disabled');
      return;
    }

    console.log('[TTS] Using Vocal service for lip sync');
    this.vocalService = createVocalService({
      intensity: this.config.lipsyncIntensity,
      speechRate: this.config.rate,
      jawScale: this.config.jawScale,
      animationAgency: this.config.animationAgency,
    });
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
    this.ensureAudioContext();
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
  public async speak(text: string): Promise<SpeakResult> {
    // Stop current speech
    this.stop();

    // Update state
    this.setState({ status: 'loading', currentText: text });

    // Parse tokens
    const { text: sanitizedText, emojis } = parseTokens(text);

    if (!sanitizedText) {
      console.warn('No text to speak after parsing');
      this.setState({ status: 'idle' });
      return { interrupted: false };
    }

    const speechCompletion = this.beginSpeechLifecycle();

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
      return await speechCompletion;
    } catch (error) {
      this.finishSpeechLifecycle({ interrupted: false });
      console.error('TTS error:', error);
      this.setState({ status: 'error', error: (error as Error).message });
      this.callbacks.onError?.(error as Error);
      throw error;
    }
  }

  private beginSpeechLifecycle(): Promise<SpeakResult> {
    this.currentSpeechSettled = false;
    this.currentSpeechPromise = new Promise<SpeakResult>((resolve) => {
      this.currentSpeechResolve = resolve;
    });
    return this.currentSpeechPromise;
  }

  private finishSpeechLifecycle(result: SpeakResult): void {
    if (this.currentSpeechSettled) return;
    this.currentSpeechSettled = true;
    const resolve = this.currentSpeechResolve;
    this.currentSpeechResolve = null;
    this.currentSpeechPromise = null;
    resolve?.(result);
  }

  public getPlaybackReferenceTrack(): MediaStreamTrack | null {
    if (this.displayMediaReferenceTrack?.readyState === 'live') {
      return this.displayMediaReferenceTrack;
    }

    return this.playbackReferenceDestination?.stream.getAudioTracks()[0] ?? null;
  }

  public getPlaybackReferenceStatus(): PlaybackReferenceStatus {
    return this.state.playbackReferenceStatus ?? 'unavailable';
  }

  public async preparePlaybackReference(): Promise<PlaybackReferenceStatus> {
    if (this.config.engine === 'webSpeech' && this.config.webSpeechReferenceMode === 'displayMedia') {
      await this.ensureWebSpeechDisplayMediaReference();
    }

    return this.getPlaybackReferenceStatus();
  }

  public onPlaybackReferenceTrackChange(listener: (track: MediaStreamTrack | null) => void): () => void {
    this.playbackReferenceTrackListeners.add(listener);
    listener(this.getPlaybackReferenceTrack());
    return () => {
      this.playbackReferenceTrackListeners.delete(listener);
    };
  }

  public onPlaybackStart(listener: () => void): () => void {
    this.playbackStartListeners.add(listener);
    return () => {
      this.playbackStartListeners.delete(listener);
    };
  }

  private emitPlaybackStart(): void {
    this.callbacks.onStart?.();
    this.playbackStartListeners.forEach((listener) => listener());
  }

  private emitPlaybackReferenceTrackChange(): void {
    const track = this.getPlaybackReferenceTrack();
    this.playbackReferenceTrackListeners.forEach((listener) => listener(track));
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.playbackReferenceDestination = this.audioContext.createMediaStreamDestination();
    } else if (!this.playbackReferenceDestination) {
      this.playbackReferenceDestination = this.audioContext.createMediaStreamDestination();
    }

    return this.audioContext;
  }

  private setPlaybackReferenceStatus(status: PlaybackReferenceStatus): void {
    this.setState({ playbackReferenceStatus: status });
    this.callbacks.onPlaybackReferenceStatusChange?.(status);
  }

  private clearDisplayMediaReference(status: PlaybackReferenceStatus = 'unavailable'): void {
    const stream = this.displayMediaReferenceStream;
    this.displayMediaReferenceTrack = null;
    this.displayMediaReferenceStream = null;

    stream?.getTracks().forEach((track) => {
      track.onended = null;
      if (track.readyState === 'live') {
        track.stop();
      }
    });

    this.emitPlaybackReferenceTrackChange();
    this.setPlaybackReferenceStatus(status);
  }

  private async ensureWebSpeechDisplayMediaReference(): Promise<void> {
    if (this.config.engine !== 'webSpeech') return;
    if (this.config.webSpeechReferenceMode !== 'displayMedia') return;
    if (this.displayMediaReferenceTrack?.readyState === 'live') return;

    if (this.displayMediaReferenceStream) {
      this.clearDisplayMediaReference();
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      console.warn('[TTS] Display media capture is not supported; Web Speech playback reference unavailable');
      this.setPlaybackReferenceStatus('unavailable');
      return;
    }

    this.setPlaybackReferenceStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        systemAudio: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions & {
        preferCurrentTab?: boolean;
        selfBrowserSurface?: 'include' | 'exclude';
        systemAudio?: 'include' | 'exclude';
        surfaceSwitching?: 'include' | 'exclude';
      });

      const audioTrack = stream.getAudioTracks()[0] ?? null;
      if (!audioTrack) {
        stream.getTracks().forEach((track) => track.stop());
        console.warn('[TTS] Display capture did not include audio; Web Speech playback reference unavailable');
        this.setPlaybackReferenceStatus('no-audio');
        return;
      }

      this.displayMediaReferenceStream = stream;
      this.displayMediaReferenceTrack = audioTrack;
      stream.getTracks().forEach((track) => {
        track.onended = () => this.clearDisplayMediaReference('ended');
      });
      this.emitPlaybackReferenceTrackChange();
      this.setPlaybackReferenceStatus('available');
      console.info('[TTS] Using display media audio as experimental Web Speech playback reference');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      const status: PlaybackReferenceStatus = name === 'NotAllowedError' ? 'denied' : 'failed';
      this.setPlaybackReferenceStatus(status);
      console.warn('[TTS] Display media reference capture failed; continuing without Web Speech playback reference:', error);
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
    const speechToken = this.speechToken;

    // Create utterance
    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this.config.rate;
    this.utterance.pitch = this.config.pitch;
    this.utterance.volume = this.config.volume;
    if (this.config.lang) {
      this.utterance.lang = this.config.lang;
    }

    // Set voice
    if (this.config.voiceName) {
      const voice = this.voices.find(v => v.name === this.config.voiceName);
      if (voice) {
        this.utterance.voice = voice;
      } else {
        console.warn('[TTS] Web Speech voice not found; browser will use its default voice', {
          requestedVoice: this.config.voiceName,
          requestedLang: this.config.lang,
          availableVoices: this.voices.map((availableVoice) => ({
            name: availableVoice.name,
            lang: availableVoice.lang,
          })),
        });
      }
    }

    // Reset word index
    this.wordIndex = 0;

    // Set up event handlers
    this.utterance.onstart = () => {
      if (speechToken !== this.speechToken) return;
      this.setState({ status: 'speaking' });
      this.emitPlaybackStart();
      this.executeTimeline(timeline);

      console.log(`[TTS] Starting Vocal lip sync for: "${text}"`);
      this.vocalService?.startSentence(text);
    };

    this.utterance.onend = () => {
      if (speechToken !== this.speechToken) return;
      this.setState({ status: 'idle' });
      this.callbacks.onEnd?.();
      this.clearTimelineTimeouts();
      this.utterance = null;
      this.finishSpeechLifecycle({ interrupted: false });

      this.vocalService?.stop();
    };

    this.utterance.onerror = (event) => {
      if (speechToken !== this.speechToken) return;
      console.error('Speech synthesis error:', event);
      this.setState({ status: 'error', error: event.error });
      this.callbacks.onError?.(new Error(event.error));
      this.clearTimelineTimeouts();
      this.utterance = null;
      this.finishSpeechLifecycle({ interrupted: false });

      this.vocalService?.stop();
    };

    this.utterance.onboundary = (event) => {
      if (speechToken !== this.speechToken) return;
      if (event.name === 'word') {
        const word = text.substring(event.charIndex, event.charIndex + event.charLength);

        console.log(`[TTS] onboundary word: "${word}", hasVocal: ${!!this.vocalService}`);

        // Notify lip sync of word boundary (for sync verification, not clip creation)
        if (word) {
          this.vocalService?.onWordBoundary(
            word,
            this.wordIndex,
            typeof event.elapsedTime === 'number' ? event.elapsedTime : undefined
          );
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

    const outputGain = this.audioContext.createGain();
    outputGain.gain.value = this.config.volume;
    this.audioSource.connect(outputGain);
    outputGain.connect(this.audioContext.destination);
    if (this.playbackReferenceDestination) {
      outputGain.connect(this.playbackReferenceDestination);
    }

    // Reset word index
    this.wordIndex = 0;

    // Set up event handlers
    this.audioSource.onended = () => {
      this.setState({ status: 'idle' });
      this.callbacks.onEnd?.();
      this.clearTimelineTimeouts();
      this.finishSpeechLifecycle({ interrupted: false });

      this.vocalService?.stop();
    };

    // Start playback
    this.setState({ status: 'speaking' });
    this.audioSource.start();
    this.emitPlaybackStart();
    console.log(`[TTS SAPI] Starting Vocal lip sync for: "${text}"`);
    this.vocalService?.startSentence(text);
    this.executeTimeline(timeline);
  }

  /**
   * Speak using Azure TTS (backend)
   */
  private async speakAzure(
    text: string,
    emojis: Array<{ emoji: string; index: number }>
  ): Promise<void> {
    const audioContext = this.ensureAudioContext();

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

    const audioBuffer = await decodeBase64Audio(result.audio_base64, audioContext);
    if (speechToken !== this.speechToken) return;

    const durationSec = Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0
      ? audioBuffer.duration
      : result.duration;
    const timeline = this.buildAzureTimeline(text, emojis, result, durationSec);
    this.setState({ currentTimeline: timeline });

    // Create audio source
    this.audioSource = audioContext.createBufferSource();
    this.audioSource.buffer = audioBuffer;

    // Apply volume via gain node
    const gainNode = audioContext.createGain();
    gainNode.gain.value = this.config.volume;
    this.audioSource.connect(gainNode);
    gainNode.connect(audioContext.destination);
    if (this.playbackReferenceDestination) {
      gainNode.connect(this.playbackReferenceDestination);
    }

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
      this.finishSpeechLifecycle({ interrupted: false });
    };

    // Start playback
    this.setState({ status: 'speaking' });

    this.clearTimelineTimeouts();

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Start playback
    this.audioSource.start();
    this.emitPlaybackStart();

    const snippetName = this.startExternalTimeline(this.buildAzureVocalTimeline(text, result, durationSec))
      ?? this.vocalService?.startSentence(text)
      ?? null;

    if (snippetName && this.config.animationAgency?.setSnippetTime) {
      this.config.animationAgency.setSnippetTime(snippetName, 0);
    }
    this.executeTimeline(timeline);
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

    const visemeTimeline = azureVisemesToTimeline(result.visemes || [], totalDurationMs, {
      wordTimings: result.word_boundaries || [],
    });
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

  private buildAzureVocalTimeline(
    text: string,
    result: AzureTTSSynthesizeResponse,
    durationSec: number
  ): VocalTimeline {
    const totalDurationMs = Math.max(0, Math.round(durationSec * 1000));
    return {
      name: `azure_vocal_${Date.now()}`,
      text,
      visemes: azureVisemesToTimeline(result.visemes || [], totalDurationMs, {
        wordTimings: result.word_boundaries || [],
        visualLeadMs: AZURE_VOCAL_VISUAL_LEAD_MS,
      }),
      wordTimings: (result.word_boundaries || []).map((boundary) => ({
        word: boundary.word,
        startSec: boundary.start_time,
        endSec: boundary.end_time,
      })),
      durationSec,
      source: 'azure',
    };
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
    this.timelineStartTime = this.audioContext
      ? this.audioContext.currentTime
      : performance.now() / 1000;

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
          this.vocalService?.onWordBoundary(event.word, this.wordIndex, this.getTimelineElapsedSec(event));
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

  private getTimelineElapsedSec(event: TimelineEvent): number {
    if (this.audioContext) {
      return Math.max(0, this.audioContext.currentTime - this.timelineStartTime);
    }

    return event.offsetMs / 1000;
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
    const hadActiveSpeech = this.state.status === 'speaking' || this.state.status === 'loading' || !!this.audioSource || !!this.utterance;

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

    this.vocalService?.stop();

    this.clearTimelineTimeouts();
    this.setState({ status: 'idle' });
    if (hadActiveSpeech) {
      this.finishSpeechLifecycle({ interrupted: true });
    }
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
    const prevWebSpeechReferenceMode = this.config.webSpeechReferenceMode;
    this.config = { ...this.config, ...config };

    if (config.webSpeechReferenceMode !== undefined && config.webSpeechReferenceMode !== prevWebSpeechReferenceMode) {
      this.clearDisplayMediaReference();
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
    this.vocalService?.stop();
  }

  /**
   * Start external sentence-level lip sync
   * Call this with the full text when external audio playback begins
   */
  public startExternalSentence(text: string): void {
    this.wordIndex = 0;
    console.log(`[TTS External] Starting Vocal lip sync for: "${text}"`);
    this.vocalService?.startSentence(text);
  }

  /**
   * Process a word for lip sync from external audio
   * Call this for each word boundary from external TTS engines
   */
  public processExternalWord(word: string, elapsedSec?: number): void {
    this.vocalService?.onWordBoundary(word, this.wordIndex, elapsedSec);
    this.callbacks.onBoundary?.({
      word,
      charIndex: this.wordIndex,
    });
    this.wordIndex++;
  }

  /**
   * Process external viseme events (e.g., Azure TTS visemes)
   * @returns Scheduled snippet name if available (useful for debug), otherwise null.
   */
  public processExternalVisemes(visemes: AzureVisemeLike[], totalDurationSec?: number): string | null {
    if (!visemes || visemes.length === 0) return null;

    const totalDurationMs = typeof totalDurationSec === 'number'
      ? Math.max(0, Math.round(totalDurationSec * 1000))
      : undefined;

    return this.startExternalTimeline({
      name: `azure_visemes_${Date.now()}`,
      visemes: azureVisemesToTimeline(visemes, totalDurationMs),
      durationSec: totalDurationSec,
      source: 'azure',
    });
  }

  /**
   * Start an externally timed vocal timeline.
   */
  public startExternalTimeline(timeline: VocalTimeline): string | null {
    this.wordIndex = 0;
    return this.vocalService?.startTimeline(timeline) ?? null;
  }

  /**
   * End lip sync for external audio
   * Call this when external audio playback ends
   */
  public endExternalSpeech(): void {
    this.vocalService?.stop();
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this.stop();
    this.disposeLipSync();
    this.clearDisplayMediaReference();
    this.playbackStartListeners.clear();
    this.playbackReferenceTrackListeners.clear();

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
